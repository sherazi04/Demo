import { z } from "zod";

/**
 * Single validated entry point for every environment variable.
 *
 * Values here are *fallbacks*. Anything the admin panel can change at runtime
 * (NFR-CFG-001..005) is resolved from `system_config` first and only falls back
 * to these — see `src/lib/config.ts`.
 */

const bool = (dflt: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : v === "true" || v === "1"));

const num = (dflt: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : Number(v)))
    .pipe(z.number().finite());

const int = (dflt: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : Number(v)))
    .pipe(z.number().int());

const str = (dflt: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : v));

export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof effortSchema>;

export const embeddingProviderSchema = z.enum(["voyage", "openai", "local"]);
export type EmbeddingProviderId = z.infer<typeof embeddingProviderSchema>;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: str("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: int(10),

  NEO4J_URI: str("bolt://localhost:7687"),
  NEO4J_USER: str("neo4j"),
  NEO4J_PASSWORD: str("dualengine"),

  REDIS_URL: str("redis://localhost:6379"),
  INGEST_CONCURRENCY: int(2),
  /**
   * How uploads are processed. `auto` probes Redis once and falls back to
   * running the six stages in-process, so the pipeline is demonstrable without
   * Redis; `queue` refuses to fall back, which is what a deployment wants.
   */
  INGEST_MODE: z.enum(["auto", "queue", "inline"]).default("auto"),

  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  BCRYPT_ROUNDS: int(12),
  BOOTSTRAP_ADMIN_EMAIL: str("admin@example.edu"),
  BOOTSTRAP_ADMIN_PASSWORD: str("ChangeMe!2025"),
  BOOTSTRAP_ADMIN_NAME: str("System Administrator"),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  LLM_MODEL_GENERATION: str("claude-opus-5"),
  LLM_MODEL_JUDGE: str("claude-opus-5"),
  LLM_MODEL_BULK: str("claude-opus-5"),
  LLM_EFFORT_GENERATION: effortSchema.default("high"),
  LLM_EFFORT_JUDGE: effortSchema.default("high"),
  LLM_EFFORT_BULK: effortSchema.default("low"),
  LLM_MAX_TOKENS: int(16_000),
  LLM_MAX_TOKENS_STREAMING: int(64_000),
  LLM_SCHEMA_RETRIES: int(2),
  LLM_TIMEOUT_MS: int(180_000),
  LLM_MAX_RETRIES: int(3),

  EMBEDDING_PROVIDER: embeddingProviderSchema.default("local"),
  EMBEDDING_DIMENSIONS: int(1024),
  VOYAGE_API_KEY: z.string().optional().default(""),
  VOYAGE_MODEL: str("voyage-3"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_BASE_URL: str("https://api.openai.com/v1"),
  OPENAI_EMBEDDING_MODEL: str("text-embedding-3-small"),

  CHUNK_TARGET_TOKENS: int(400),
  CHUNK_OVERLAP_TOKENS: int(60),
  CHUNK_MIN_TOKENS: int(80),

  RETRIEVAL_VECTOR_K: int(40),
  RETRIEVAL_LEXICAL_K: int(25),
  RETRIEVAL_GRAPH_HOPS: int(1),
  RETRIEVAL_GRAPH_K: int(15),
  RETRIEVAL_FINAL_K: int(8),
  RRF_K: int(60),
  RRF_GRAPH_RANK_PENALTY: int(8),
  RERANK_ENABLED: bool(false),

  ENFORCE_VALIDATION: bool(true),
  CLO_ALIGN_THRESHOLD: num(0.75),
  GROUNDEDNESS_THRESHOLD: num(0.8),
  DISTRACTOR_THRESHOLD: num(0.7),

  BKT_P_INIT: num(0.15),
  BKT_P_TRANSIT: num(0.12),
  BKT_P_SLIP: num(0.1),
  BKT_SAQ_P_GUESS: num(0.05),
  MASTERY_THRESHOLD: num(0.7),
  MASTERY_HIGH: num(0.85),
  ELO_K_EARLY: num(0.03),
  ELO_K_LATE: num(0.01),
  ELO_SERVED_SWITCH: int(30),

  AUDIT_CHAIN_SEED: str("dual-engine-genesis"),
  BIAS_DEVIATION_THRESHOLD: num(0.15),

  UPLOAD_DIR: str("./data/uploads"),
  MAX_UPLOAD_BYTES: int(104_857_600),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/** Lazily validated so importing this module in a test never explodes. */
export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    cached ??= load();
    return cached[prop as keyof Env];
  },
});

/** Explicit accessor for scripts that want a hard failure at startup. */
export function requireEnv(): Env {
  cached ??= load();
  return cached;
}
