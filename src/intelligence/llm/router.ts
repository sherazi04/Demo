import type { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Anthropic, getAnthropic } from "./client";
import { resolveTier, type Tier } from "./tiers";
import { env } from "@/lib/env";
import { sha256 } from "@/lib/hash";
import { logger } from "@/lib/logger";
import { SchemaViolationError } from "@/lib/errors";
import { append } from "@/governance/audit";

/**
 * The tiered LLM router (design.md §6.1).
 *
 * Hard API rules this module exists to keep in one place — every one of them is
 * a 400 or a silent empty result if broken:
 *   · model ids are exact strings, never date-suffixed
 *   · `thinking: { type: "adaptive" }` — set explicitly for clarity
 *   · effort lives in `output_config.effort`, never top-level
 *   · `temperature` / `top_p` / `top_k` are never sent
 *   · `budget_tokens` is never sent
 *   · `messages` never ends on an assistant turn (no prefill)
 *   · `stop_reason` is checked before `content` is read
 *
 * Every call emits an audit record (FR-INT-056, FR-GOV-001).
 */

export interface SystemBlock {
  text: string;
  /**
   * Marks the last stable block. Everything after the breakpoint must be
   * volatile-free — a timestamp or request id above it invalidates the whole
   * prefix and the cache silently never hits.
   */
  cache?: boolean;
}

export interface CallOptions {
  tier: Tier;
  system: SystemBlock[];
  user: string;
  maxTokens?: number;
  /** Forces streaming; otherwise chosen automatically from maxTokens. */
  stream?: boolean;
  correlationId?: string;
  actorId?: string | null;
  actorRole?: "student" | "teacher" | "admin" | null;
  /** Recorded on the audit row so a generation traces to its context. */
  retrievedChunkIds?: string[];
  auditAction?: Parameters<typeof append>[0]["action"];
  resourceType?: string;
  resourceId?: string;
}

export interface CallResult<T> {
  /** Null when the model refused — always check `refused` before using this. */
  data: T | null;
  refused: boolean;
  refusalReason?: string;
  model: string;
  effort: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  stopReason: string | null;
}

/** Streaming is required above roughly this many output tokens to dodge HTTP timeouts. */
const STREAMING_THRESHOLD = 16_000;

function buildSystem(blocks: SystemBlock[]): Anthropic.TextBlockParam[] {
  return blocks.map((block) => ({
    type: "text" as const,
    text: block.text,
    ...(block.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

/**
 * Structured-output call. Retries only on schema violation, up to
 * LLM_SCHEMA_RETRIES, then throws a typed error (FR-INT-053).
 */
export async function callStructured<S extends z.ZodType>(
  schema: S,
  options: CallOptions,
): Promise<CallResult<z.infer<S>>> {
  const settings = await resolveTier(options.tier);
  const client = getAnthropic();
  const maxTokens = options.maxTokens ?? env.LLM_MAX_TOKENS;

  const system = buildSystem(options.system);
  // Hashed over the rendered prompt so an audit row identifies the exact
  // prompt without ever storing it (NFR-SEC-006).
  const promptHash = sha256(
    JSON.stringify({ system: options.system.map((b) => b.text), user: options.user }),
  );

  const maxAttempts = env.LLM_SCHEMA_RETRIES + 1;
  let lastSchemaError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await client.messages.parse({
        model: settings.model,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: {
          effort: settings.effort,
          format: zodOutputFormat(schema),
        },
        system,
        // Never ends on an assistant turn: prefill is rejected with a 400 and
        // structured output is the supported replacement.
        messages: [{ role: "user", content: options.user }],
      });

      const latencyMs = Date.now() - startedAt;
      const usage = response.usage;

      const result: CallResult<z.infer<S>> = {
        data: null,
        refused: false,
        model: settings.model,
        effort: settings.effort,
        promptHash,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
        latencyMs,
        stopReason: response.stop_reason ?? null,
      };

      // A refusal is HTTP 200 with empty or partial content. It is an outcome,
      // not an exception: log it, surface it, do not throw (FR-INT-055).
      if (response.stop_reason === "refusal") {
        result.refused = true;
        result.refusalReason = response.stop_details?.explanation ?? "model declined";
        await recordCall(options, result, "refusal");
        logger.warn("model refused", {
          correlationId: options.correlationId,
          tier: options.tier,
          category: response.stop_details?.category ?? null,
        });
        return result;
      }

      const parsed = response.parsed_output as z.infer<S> | null | undefined;
      if (parsed === null || parsed === undefined) {
        // Truncation is the usual cause and is worth naming, because the fix
        // (raise max_tokens) differs from a genuine schema disagreement.
        const reason =
          response.stop_reason === "max_tokens"
            ? `output hit max_tokens (${maxTokens}) before the schema was complete`
            : "model returned no parseable structured output";
        lastSchemaError = new Error(reason);
        logger.warn("structured output missing", {
          correlationId: options.correlationId,
          attempt,
          stopReason: response.stop_reason,
        });
        await recordCall(options, result, "error");
        continue;
      }

      result.data = parsed;
      await recordCall(options, result, "ok");
      return result;
    } catch (error: unknown) {
      // Transport failures are already retried inside the SDK; reaching here
      // means they are exhausted, so only schema problems are worth another try.
      if (error instanceof Anthropic.APIError) throw error;
      lastSchemaError = error;
      logger.warn("structured call attempt failed", {
        correlationId: options.correlationId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new SchemaViolationError(
    `Model output failed schema validation after ${maxAttempts} attempts`,
    { tier: options.tier, model: settings.model, cause: String(lastSchemaError) },
  );
}

/**
 * Free-text call. Streams whenever `max_tokens` is large, because a long
 * non-streaming generation will hit the HTTP timeout (NFR-REL-004).
 */
export async function callText(options: CallOptions): Promise<CallResult<string>> {
  const settings = await resolveTier(options.tier);
  const client = getAnthropic();
  const maxTokens = options.maxTokens ?? env.LLM_MAX_TOKENS;
  const shouldStream = options.stream ?? maxTokens > STREAMING_THRESHOLD;

  const system = buildSystem(options.system);
  const promptHash = sha256(
    JSON.stringify({ system: options.system.map((b) => b.text), user: options.user }),
  );

  const params = {
    model: settings.model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" as const },
    output_config: { effort: settings.effort },
    system,
    messages: [{ role: "user" as const, content: options.user }],
  };

  const startedAt = Date.now();
  const response = shouldStream
    ? await client.messages.stream(params).finalMessage()
    : await client.messages.create(params);
  const latencyMs = Date.now() - startedAt;

  const usage = response.usage;
  const result: CallResult<string> = {
    data: null,
    refused: false,
    model: settings.model,
    effort: settings.effort,
    promptHash,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    latencyMs,
    stopReason: response.stop_reason ?? null,
  };

  if (response.stop_reason === "refusal") {
    result.refused = true;
    result.refusalReason = response.stop_details?.explanation ?? "model declined";
    await recordCall(options, result, "refusal");
    return result;
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  result.data = text;
  await recordCall(options, result, "ok");
  return result;
}

async function recordCall<T>(
  options: CallOptions,
  result: CallResult<T>,
  outcome: "ok" | "refusal" | "error",
): Promise<void> {
  try {
    await append({
      actorId: options.actorId ?? null,
      actorRole: options.actorRole ?? null,
      action: options.auditAction ?? "llm.call",
      resourceType: options.resourceType ?? "llm",
      resourceId: options.resourceId ?? null,
      model: result.model,
      effort: result.effort,
      promptHash: result.promptHash,
      retrievedChunkIds: options.retrievedChunkIds ?? null,
      outputHash: result.data === null ? null : sha256(JSON.stringify(result.data)),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      latencyMs: result.latencyMs,
      outcome,
      payload: { tier: options.tier, stopReason: result.stopReason },
      correlationId: options.correlationId ?? null,
    });
  } catch (error: unknown) {
    // A failed audit write must not discard a successful generation, but it is
    // a governance failure and is logged as an error, not a warning.
    logger.error("failed to record LLM call in audit log", {
      correlationId: options.correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cache-hit diagnostics. `cache_read_input_tokens` staying at zero across
 * repeated calls means something time-varying sits in the cached prefix.
 */
export function reportCacheEffectiveness(result: CallResult<unknown>): void {
  if (result.cacheReadTokens === 0 && result.cacheWriteTokens > 0) {
    logger.debug("prompt cache written but not yet read", {
      written: result.cacheWriteTokens,
    });
  }
}
