import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { ingestStage, ingestStatus, lomFormat, materialStatus } from "./enums";
import { users } from "./auth";
import { clos, courses, topics } from "./curriculum";

/** Uploaded course material and its ingestion state (FR-INT-010..019). */
export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("supplement"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Path under UPLOAD_DIR — outside the web root (NFR-SEC-003). */
    storagePath: text("storage_path").notNull(),
    contentHash: text("content_hash").notNull(),
    /** Mandatory: only openly-licensed or institution-owned content (FR-INT-012, R6). */
    licenseNote: text("license_note").notNull(),
    status: materialStatus("status").notNull().default("uploaded"),
    progress: real("progress").notNull().default(0),
    error: text("error"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count").notNull().default(0),
    /** A revision supersedes rather than deletes its predecessor (FR-INT-019). */
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => materials.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
  },
  (t) => [
    // FR-INT-011: an exact duplicate is rejected within the same course, but the
    // same file may legitimately exist in another course.
    uniqueIndex("materials_course_hash_unique").on(t.courseId, t.contentHash),
    index("materials_course_idx").on(t.courseId),
    index("materials_status_idx").on(t.status),
    /**
     * FR-INT-012 enforced at the last line, not only at the route boundary.
     * NOT NULL alone accepts "", which is exactly the unattributed upload that
     * risk R6 names — the column needs to reject an empty note as well as a
     * missing one, so no caller (route, script or seeder) can bypass it.
     */
    check("materials_license_note_required", sql`length(btrim(${t.licenseNote})) >= 3`),
  ],
);

/**
 * The central table. Every retrievable unit of content carries its IEEE LOM
 * metadata, its source locator, and its embedding in one row — which is what
 * lets metadata filtering and vector search happen in a single query (§6.4).
 */
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),

    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull().default(0),

    // Locator — sufficient to render a citation (FR-INT-017).
    pageFrom: integer("page_from"),
    pageTo: integer("page_to"),
    sectionPath: text("section_path"),

    // IEEE LOM (FR-INT-020, FR-INT-021).
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    bloomLevel: integer("bloom_level"),
    difficulty: real("difficulty"),
    lomFormat: lomFormat("lom_format"),
    resourceType: text("resource_type"),
    tagConfidence: real("tag_confidence"),
    /** Full LOM record as structured JSON alongside the indexed columns (FR-INT-025). */
    lom: jsonb("lom").$type<Record<string, unknown>>(),

    // Human review (FR-INT-024).
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    // Retrieval.
    embedding: vector("embedding", { dimensions: 1024 }),
    /** Makes rows stale against a provider/dimension change detectable (§6.3). */
    embeddingModel: text("embedding_model"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Dense half of hybrid retrieval — HNSW over cosine distance (design.md §4.3).
    index("chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
    // Lexical half — trigram GIN so `similarity(text, $q)` is indexable (§6.4 step 3).
    index("chunks_text_trgm").using("gin", t.text.op("gin_trgm_ops")),
    index("chunks_material_idx").on(t.materialId),
    index("chunks_topic_idx").on(t.topicId),
    index("chunks_course_bloom_idx").on(t.courseId, t.bloomLevel),
    index("chunks_confidence_idx").on(t.tagConfidence),
    check("chunks_bloom_range", sql`${t.bloomLevel} IS NULL OR ${t.bloomLevel} BETWEEN 1 AND 6`),
    check(
      "chunks_difficulty_range",
      sql`${t.difficulty} IS NULL OR ${t.difficulty} BETWEEN 0 AND 1`,
    ),
    check(
      "chunks_confidence_range",
      sql`${t.tagConfidence} IS NULL OR ${t.tagConfidence} BETWEEN 0 AND 1`,
    ),
  ],
);

/** Candidate CLOs per chunk with a relevance weight (FR-INT-020). */
export const chunkClos = pgTable(
  "chunk_clos",
  {
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    cloId: uuid("clo_id")
      .notNull()
      .references(() => clos.id, { onDelete: "cascade" }),
    relevance: real("relevance").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.chunkId, t.cloId] }),
    index("chunk_clos_clo_idx").on(t.cloId),
  ],
);

/** One row per (material, stage) — drives the progress UI (FR-INT-014, FR-INT-015). */
export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    stage: ingestStage("stage").notNull(),
    status: ingestStatus("status").notNull().default("queued"),
    message: text("message"),
    itemsTotal: integer("items_total").notNull().default(0),
    itemsDone: integer("items_done").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per (material, stage) so a retry updates rather than duplicates.
    uniqueIndex("ingest_jobs_material_stage_unique").on(t.materialId, t.stage),
    index("ingest_jobs_material_idx").on(t.materialId),
  ],
);

export const materialsRelations = relations(materials, ({ one, many }) => ({
  course: one(courses, { fields: [materials.courseId], references: [courses.id] }),
  uploader: one(users, { fields: [materials.uploadedBy], references: [users.id] }),
  chunks: many(chunks),
  jobs: many(ingestJobs),
}));

export const chunksRelations = relations(chunks, ({ one, many }) => ({
  material: one(materials, { fields: [chunks.materialId], references: [materials.id] }),
  topic: one(topics, { fields: [chunks.topicId], references: [topics.id] }),
  cloLinks: many(chunkClos),
}));

export type Material = typeof materials.$inferSelect;
export type NewMaterial = typeof materials.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type IngestJob = typeof ingestJobs.$inferSelect;
