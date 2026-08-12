import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { chunks, materials } from "@/db/schema";
import { append } from "@/governance/audit";
import { env } from "@/lib/env";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { sha256 } from "@/lib/hash";
import { newCorrelationId, newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { ensureJobRows } from "@/intelligence/ingest/jobs";
import { dispatchIngest, dispatchStage } from "@/intelligence/ingest/dispatch";
import { type IngestStageName } from "@/worker/queues";
import type { AuthedUser } from "@/auth/guard";

/**
 * Course material upload and its ingestion trigger (FR-INT-010..019).
 */

const sqlCount = sql<number>`count(*)::int`;

const ALLOWED = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
]);

export const uploadMetaSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(300),
  /**
   * Mandatory (FR-INT-012). Only openly-licensed or institution-owned content
   * belongs in the corpus, and an unattributed upload is the risk R6 names.
   */
  licenseNote: z.string().min(3).max(1000),
  kind: z.string().max(64).optional(),
  /** Marks this upload as a revision of an existing material (FR-INT-019). */
  supersedesId: z.string().uuid().optional(),
});

export type UploadMeta = z.infer<typeof uploadMetaSchema>;

export interface UploadResult {
  materialId: string;
  correlationId: string;
  chunkCountExpected: null;
}

export async function uploadMaterial(
  actor: AuthedUser,
  rawMeta: UploadMeta,
  file: { filename: string; bytes: Buffer; mimeType: string },
): Promise<UploadResult> {
  /*
   * Re-validated here, not only at the route boundary.
   *
   * The route parses its form and then calls this; a script, a seeder or a
   * future route that forgets to would otherwise write an unattributed
   * material into the corpus — the risk R6 names, and the one thing FR-INT-012
   * exists to prevent. The database carries the same rule as a check
   * constraint, so the invariant holds at all three levels.
   */
  const meta = uploadMetaSchema.parse(rawMeta);

  const extension = extname(file.filename).toLowerCase();
  const expectedMime = ALLOWED.get(extension);
  if (!expectedMime) {
    throw new BadRequestError(
      `Unsupported file type "${extension}". Accepted: ${[...ALLOWED.keys()].join(", ")}.`,
    );
  }
  if (file.bytes.byteLength === 0) {
    throw new BadRequestError("The uploaded file is empty.");
  }
  if (file.bytes.byteLength > env.MAX_UPLOAD_BYTES) {
    throw new BadRequestError(
      `File is ${(file.bytes.byteLength / 1_048_576).toFixed(1)} MB; the limit is ${(env.MAX_UPLOAD_BYTES / 1_048_576).toFixed(0)} MB.`,
    );
  }

  // FR-INT-011: an exact duplicate within the same course is rejected. The same
  // file in a different course is legitimate, so the hash is scoped, not global.
  const contentHash = sha256(file.bytes);
  const [duplicate] = await db
    .select({ id: materials.id, title: materials.title })
    .from(materials)
    .where(and(eq(materials.courseId, meta.courseId), eq(materials.contentHash, contentHash)))
    .limit(1);
  if (duplicate) {
    throw new ConflictError(
      `This exact file is already in the course as "${duplicate.title}". Upload a revised version, or delete the existing one first.`,
    );
  }

  // Stored outside the web root under UPLOAD_DIR (NFR-SEC-003). The stored name
  // is a generated id, never the client-supplied filename — that is what makes
  // a "../" in the upload name harmless.
  const uploadRoot = resolve(env.UPLOAD_DIR);
  const courseDir = join(uploadRoot, meta.courseId);
  await mkdir(courseDir, { recursive: true });

  const storedName = `${newId()}${extension}`;
  const storagePath = join(courseDir, storedName);
  await writeFile(storagePath, file.bytes);

  const correlationId = newCorrelationId();

  const [row] = await db
    .insert(materials)
    .values({
      courseId: meta.courseId,
      uploadedBy: actor.id,
      title: meta.title,
      kind: meta.kind ?? "supplement",
      filename: file.filename,
      mimeType: expectedMime,
      sizeBytes: file.bytes.byteLength,
      storagePath,
      contentHash,
      licenseNote: meta.licenseNote,
      status: "uploaded",
      supersedesId: meta.supersedesId ?? null,
    })
    .returning();
  if (!row) throw new Error("failed to record the uploaded material");

  await ensureJobRows(row.id);

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "material.upload",
    resourceType: "material",
    resourceId: row.id,
    correlationId,
    payload: {
      filename: file.filename,
      sizeBytes: file.bytes.byteLength,
      contentHash,
      supersedes: meta.supersedesId ?? null,
    },
  });

  const mode = await dispatchIngest({
    materialId: row.id,
    courseId: meta.courseId,
    correlationId,
    actorId: actor.id,
  });

  logger.info(
    mode === "queue" ? "material uploaded, ingestion queued" : "material uploaded and ingested inline",
    {
      correlationId,
      materialId: row.id,
      courseId: meta.courseId,
      mode,
    },
  );

  return { materialId: row.id, correlationId, chunkCountExpected: null };
}

/**
 * Re-runs one stage without re-uploading (FR-INT-015, NFR-REL-001).
 */
export async function retryStage(
  actor: AuthedUser,
  materialId: string,
  stage: IngestStageName,
): Promise<void> {
  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.id, materialId))
    .limit(1);
  if (!material) throw new NotFoundError("Material");

  const correlationId = newCorrelationId();
  await db
    .update(materials)
    .set({ error: null, status: "uploaded" })
    .where(eq(materials.id, materialId));

  const mode = await dispatchStage(stage, {
    materialId,
    courseId: material.courseId,
    correlationId,
    actorId: actor.id,
  });

  logger.info("stage retry dispatched", { correlationId, materialId, stage, mode });
}

export async function listMaterials(courseId: string) {
  return db
    .select({
      id: materials.id,
      title: materials.title,
      filename: materials.filename,
      mimeType: materials.mimeType,
      sizeBytes: materials.sizeBytes,
      status: materials.status,
      progress: materials.progress,
      error: materials.error,
      pageCount: materials.pageCount,
      chunkCount: materials.chunkCount,
      licenseNote: materials.licenseNote,
      supersedesId: materials.supersedesId,
      createdAt: materials.createdAt,
      indexedAt: materials.indexedAt,
    })
    .from(materials)
    .where(eq(materials.courseId, courseId))
    .orderBy(desc(materials.createdAt));
}

export async function getMaterial(materialId: string) {
  const [row] = await db.select().from(materials).where(eq(materials.id, materialId)).limit(1);
  if (!row) throw new NotFoundError("Material");
  return row;
}

/**
 * Deletes a material and its chunks. Kept as a hard delete because a corpus
 * that silently still answers queries after a licensing takedown would be
 * worse than losing the audit convenience — the audit record of the upload and
 * the deletion both survive regardless.
 */
export async function deleteMaterial(actor: AuthedUser, materialId: string): Promise<void> {
  const material = await getMaterial(materialId);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sqlCount })
    .from(chunks)
    .where(eq(chunks.materialId, materialId));

  // Chunks and chunk_clos cascade from the material row.
  await db.delete(materials).where(eq(materials.id, materialId));
  await unlink(material.storagePath).catch((error: unknown) => {
    // The row is gone either way; a missing file is not worth failing on.
    logger.warn("could not remove material file from disk", {
      materialId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "material.delete",
    resourceType: "material",
    resourceId: materialId,
    payload: { title: material.title, contentHash: material.contentHash, hadChunks: count },
  });
}
