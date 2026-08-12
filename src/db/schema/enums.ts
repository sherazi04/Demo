import { pgEnum } from "drizzle-orm/pg-core";

/** Shared Postgres enums. Kept in one module so no two tables drift apart. */

export const userRole = pgEnum("user_role", ["student", "teacher", "admin"]);
export const userStatus = pgEnum("user_status", ["invited", "active", "suspended"]);

export const materialStatus = pgEnum("material_status", [
  "uploaded",
  "parsing",
  "chunking",
  "tagging",
  "embedding",
  "indexed",
  "failed",
]);

/** The six ordered ingestion stages (FR-INT-013). */
export const ingestStage = pgEnum("ingest_stage", [
  "parse",
  "chunk",
  "tag",
  "embed",
  "index",
  "kg_link",
]);

export const ingestStatus = pgEnum("ingest_status", ["queued", "running", "done", "failed"]);

/** IEEE LOM format vocabulary (design.md §4.3). */
export const lomFormat = pgEnum("lom_format", [
  "definition",
  "worked_example",
  "proof",
  "exercise",
  "figure",
  "code",
  "narrative",
]);

export const questionType = pgEnum("question_type", ["mcq", "saq", "numeric", "code"]);

export const questionStatus = pgEnum("question_status", [
  "draft",
  "rejected",
  "pending",
  "approved",
  "retired",
]);

export const attemptMode = pgEnum("attempt_mode", ["adaptive", "assessment", "practice"]);

export const auditOutcome = pgEnum("audit_outcome", ["ok", "refusal", "error"]);
