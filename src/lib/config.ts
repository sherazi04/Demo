import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { systemConfig } from "@/db/schema";
import { append } from "@/governance/audit";
import { effortSchema, embeddingProviderSchema, env } from "./env";
import { logger } from "./logger";
import type { AuthedUser } from "@/auth/guard";

/**
 * Runtime configuration resolved from `system_config`, falling back to `.env`
 * (NFR-CFG-001..005).
 *
 * Cached briefly rather than read per call: the retrieval pipeline touches
 * several of these per request, and a config read per parameter would add a
 * round trip to every LLM call. The TTL is short enough that an admin change is
 * visible within seconds, which is what "no redeploy" requires.
 */

const CACHE_TTL_MS = 5_000;

export const configSchema = z.object({
  "llm.generation.model": z.string(),
  "llm.generation.effort": effortSchema,
  "llm.judge.model": z.string(),
  "llm.judge.effort": effortSchema,
  "llm.bulk.model": z.string(),
  "llm.bulk.effort": effortSchema,

  "embedding.provider": embeddingProviderSchema,
  "embedding.dimensions": z.number().int().positive(),

  "retrieval.vectorK": z.number().int().positive(),
  "retrieval.lexicalK": z.number().int().positive(),
  "retrieval.graphHops": z.number().int().min(0).max(5),
  "retrieval.graphK": z.number().int().min(0),
  "retrieval.finalK": z.number().int().positive(),
  "retrieval.rrfK": z.number().int().positive(),
  "retrieval.graphRankPenalty": z.number().int().min(0),
  "retrieval.rerankEnabled": z.boolean(),

  "validation.enforce": z.boolean(),
  "validation.cloAlignThreshold": z.number().min(0).max(1),
  "validation.groundednessThreshold": z.number().min(0).max(1),
  "validation.distractorThreshold": z.number().min(0).max(1),

  "chunk.targetTokens": z.number().int().positive(),
  "chunk.overlapTokens": z.number().int().min(0),
  "chunk.minTokens": z.number().int().min(0),
});

export type ConfigShape = z.infer<typeof configSchema>;
export type ConfigKey = keyof ConfigShape;

/** Values from `.env`, used whenever `system_config` has no row for a key. */
function envDefaults(): ConfigShape {
  return {
    "llm.generation.model": env.LLM_MODEL_GENERATION,
    "llm.generation.effort": env.LLM_EFFORT_GENERATION,
    "llm.judge.model": env.LLM_MODEL_JUDGE,
    "llm.judge.effort": env.LLM_EFFORT_JUDGE,
    "llm.bulk.model": env.LLM_MODEL_BULK,
    "llm.bulk.effort": env.LLM_EFFORT_BULK,

    "embedding.provider": env.EMBEDDING_PROVIDER,
    "embedding.dimensions": env.EMBEDDING_DIMENSIONS,

    "retrieval.vectorK": env.RETRIEVAL_VECTOR_K,
    "retrieval.lexicalK": env.RETRIEVAL_LEXICAL_K,
    "retrieval.graphHops": env.RETRIEVAL_GRAPH_HOPS,
    "retrieval.graphK": env.RETRIEVAL_GRAPH_K,
    "retrieval.finalK": env.RETRIEVAL_FINAL_K,
    "retrieval.rrfK": env.RRF_K,
    "retrieval.graphRankPenalty": env.RRF_GRAPH_RANK_PENALTY,
    "retrieval.rerankEnabled": env.RERANK_ENABLED,

    "validation.enforce": env.ENFORCE_VALIDATION,
    "validation.cloAlignThreshold": env.CLO_ALIGN_THRESHOLD,
    "validation.groundednessThreshold": env.GROUNDEDNESS_THRESHOLD,
    "validation.distractorThreshold": env.DISTRACTOR_THRESHOLD,

    "chunk.targetTokens": env.CHUNK_TARGET_TOKENS,
    "chunk.overlapTokens": env.CHUNK_OVERLAP_TOKENS,
    "chunk.minTokens": env.CHUNK_MIN_TOKENS,
  };
}

let cache: { value: ConfigShape; expiresAt: number } | null = null;

export async function getConfig(): Promise<ConfigShape> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const defaults = envDefaults();
  let merged = defaults;

  try {
    const rows = await db.select().from(systemConfig);
    const overrides: Record<string, unknown> = {};
    for (const row of rows) {
      if (row.key in defaults) overrides[row.key] = row.value;
    }
    const parsed = configSchema.safeParse({ ...defaults, ...overrides });
    if (parsed.success) {
      merged = parsed.data;
    } else {
      // A malformed override must not take the system down — fall back to env
      // and say loudly which key is bad.
      logger.error("system_config contains invalid values; falling back to env", {
        issues: parsed.error.issues.map((i) => i.path.join(".")),
      });
    }
  } catch (error: unknown) {
    // Scripts and tests may run with no database; env-only is a valid mode.
    logger.debug("system_config unavailable, using env defaults", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  cache = { value: merged, expiresAt: Date.now() + CACHE_TTL_MS };
  return merged;
}

export async function getConfigValue<K extends ConfigKey>(key: K): Promise<ConfigShape[K]> {
  return (await getConfig())[key];
}

/** Drops the cache so a write is visible immediately to the writing process. */
export function invalidateConfigCache(): void {
  cache = null;
}

/**
 * Writes an override and records before/after in the audit log (FR-ADM-007).
 */
export async function setConfigValues(
  actor: AuthedUser,
  updates: Partial<ConfigShape>,
): Promise<ConfigShape> {
  const before = await getConfig();
  const candidate = configSchema.parse({ ...before, ...updates });

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    await db
      .insert(systemConfig)
      .values({ key, value, updatedBy: actor.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value, updatedBy: actor.id, updatedAt: new Date() },
      });
  }

  const changedKeys = Object.keys(updates) as ConfigKey[];
  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "config.update",
    resourceType: "system_config",
    resourceId: changedKeys.join(","),
    payload: {
      before: Object.fromEntries(changedKeys.map((k) => [k, before[k]])),
      after: Object.fromEntries(changedKeys.map((k) => [k, candidate[k]])),
    },
  });

  invalidateConfigCache();
  return candidate;
}
