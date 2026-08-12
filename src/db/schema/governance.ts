import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { auditOutcome, userRole } from "./enums";
import { users } from "./auth";

/**
 * Append-only, hash-chained audit log (FR-GOV-001..006).
 *
 * Immutability is enforced by a BEFORE UPDATE OR DELETE trigger created in the
 * migration — Drizzle cannot express a trigger, so it lives in SQL alongside
 * this definition. Never log raw prompts or student PII here (NFR-SEC-006);
 * `promptHash` and `outputHash` exist precisely so the content need not be kept.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Monotonic ordering for chain verification. */
    seq: bigserial("seq", { mode: "number" }).notNull(),

    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: userRole("actor_role"),

    /** e.g. `question.generate`, `question.approve`, `chunk.tag`, `config.update`, `rbac.denied`. */
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),

    model: text("model"),
    effort: text("effort"),
    promptHash: text("prompt_hash"),
    /** Exactly which context the call saw — what makes groundedness auditable. */
    retrievedChunkIds: jsonb("retrieved_chunk_ids").$type<string[]>(),
    outputHash: text("output_hash"),

    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    latencyMs: integer("latency_ms"),

    outcome: auditOutcome("outcome").notNull().default("ok"),
    /** Small structured detail — never raw prompts, never PII. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    /** Links a user action to every downstream AI call (NFR-OBS-003). */
    correlationId: text("correlation_id"),

    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_seq_idx").on(t.seq),
    index("audit_log_actor_idx").on(t.actorId),
    index("audit_log_action_idx").on(t.action),
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_correlation_idx").on(t.correlationId),
  ],
);

/**
 * Runtime configuration (NFR-CFG-001..005). Reads fall back to `.env`; writes
 * emit an audit record carrying before/after values (FR-ADM-007).
 */
export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-slice fairness metrics over time (FR-GOV-010, FR-GOV-011). */
export const biasSnapshots = pgTable(
  "bias_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    /** The `cohort_tag` value this row summarises. */
    sliceKey: text("slice_key").notNull(),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    cohortMean: real("cohort_mean").notNull(),
    deviation: real("deviation").notNull(),
    flagged: boolean("flagged").notNull().default(false),
    /** Sample size — printed with every figure (honesty rule 5). */
    sampleSize: integer("sample_size").notNull().default(0),
  },
  (t) => [
    index("bias_snapshots_computed_idx").on(t.computedAt),
    index("bias_snapshots_slice_idx").on(t.sliceKey, t.metric),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type SystemConfigRow = typeof systemConfig.$inferSelect;
export type BiasSnapshot = typeof biasSnapshots.$inferSelect;
