import { and, eq, isNull, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  chunkClos,
  chunks,
  clos,
  courses,
  materials,
  topics,
} from "@/db/schema";
import { getConfig } from "@/lib/config";
import { IngestStageError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { embedDocuments, getEmbeddingProvider } from "@/intelligence/embeddings";
import { syncKnowledgeGraph } from "@/intelligence/kg/sync";
import type { CourseContext } from "@/intelligence/llm/prompts/shared";
import { chunkBlocks } from "./chunk";
import { parseFile, type TextBlock } from "./parse";
import { finishStage, markIndexed, reportProgress, startStage } from "./jobs";
import { TAG_BATCH_SIZE, tagBatch } from "./tag";
import type { StageJobData } from "@/worker/queues";

/**
 * The six ingestion stages (design.md §6.5).
 *
 * Each is idempotent and independently retryable without re-uploading
 * (NFR-REL-001): re-running `chunk` replaces this material's chunks, re-running
 * `embed` only touches rows whose embedding is missing or stale.
 */

/** Parsed blocks are held in memory between `parse` and `chunk` within a run. */
const parseCache = new Map<string, TextBlock[]>();

export async function runParse(job: StageJobData): Promise<void> {
  await startStage(job.materialId, "parse");

  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.id, job.materialId))
    .limit(1);
  if (!material) throw new IngestStageError("parse", "material row is missing");

  const result = await parseFile(material.storagePath, material.filename, material.mimeType);
  if (result.blocks.length === 0) {
    throw new IngestStageError(
      "parse",
      "No extractable text. If this is a scanned PDF it needs OCR before upload.",
    );
  }

  parseCache.set(job.materialId, result.blocks);
  await db
    .update(materials)
    .set({ pageCount: result.pageCount })
    .where(eq(materials.id, job.materialId));

  await reportProgress(job.materialId, "parse", result.blocks.length, result.blocks.length);
  await finishStage(job.materialId, "parse", result.blocks.length);
  logger.info("parse complete", {
    correlationId: job.correlationId,
    materialId: job.materialId,
    blocks: result.blocks.length,
    pages: result.pageCount,
  });
}

export async function runChunk(job: StageJobData): Promise<void> {
  await startStage(job.materialId, "chunk");

  let blocks = parseCache.get(job.materialId);
  if (!blocks) {
    // A retry in a fresh worker process has no cache — re-parse rather than
    // forcing the teacher to re-upload (NFR-REL-001).
    const [material] = await db
      .select()
      .from(materials)
      .where(eq(materials.id, job.materialId))
      .limit(1);
    if (!material) throw new IngestStageError("chunk", "material row is missing");
    blocks = (await parseFile(material.storagePath, material.filename, material.mimeType)).blocks;
  }

  const config = await getConfig();
  const produced = chunkBlocks(blocks, {
    targetTokens: config["chunk.targetTokens"],
    overlapTokens: config["chunk.overlapTokens"],
    minTokens: config["chunk.minTokens"],
  });

  if (produced.length === 0) {
    throw new IngestStageError("chunk", "chunking produced no chunks from the parsed text");
  }

  // Replace rather than append: re-running the stage must converge, not double
  // the corpus. The cascade clears chunk_clos with it.
  await db.delete(chunks).where(eq(chunks.materialId, job.materialId));

  await db.insert(chunks).values(
    produced.map((chunk) => ({
      materialId: job.materialId,
      courseId: job.courseId,
      ordinal: chunk.ordinal,
      text: chunk.text,
      tokenCount: chunk.tokenCount,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
      sectionPath: chunk.sectionPath,
    })),
  );

  parseCache.delete(job.materialId);
  await db
    .update(materials)
    .set({ chunkCount: produced.length })
    .where(eq(materials.id, job.materialId));

  await finishStage(job.materialId, "chunk", produced.length);
  logger.info("chunk complete", {
    correlationId: job.correlationId,
    materialId: job.materialId,
    chunks: produced.length,
  });
}

export async function runTag(job: StageJobData): Promise<void> {
  const rows = await db
    .select({ id: chunks.id, text: chunks.text })
    .from(chunks)
    .where(eq(chunks.materialId, job.materialId))
    .orderBy(chunks.ordinal);

  await startStage(job.materialId, "tag", rows.length);
  if (rows.length === 0) {
    await finishStage(job.materialId, "tag", 0);
    return;
  }

  const context = await loadCourseContext(job.courseId);
  const topicIdByCode = await loadTopicIds(job.courseId);
  const cloIdByCode = await loadCloIds(job.courseId);

  let done = 0;
  let driftCount = 0;

  for (let i = 0; i < rows.length; i += TAG_BATCH_SIZE) {
    const batch = rows.slice(i, i + TAG_BATCH_SIZE);
    const outcomes = await tagBatch(
      batch.map((r) => ({ chunkId: r.id, text: r.text })),
      context,
      { correlationId: job.correlationId, actorId: job.actorId },
    );

    for (const outcome of outcomes) {
      const topicId = outcome.topicCode ? (topicIdByCode.get(outcome.topicCode) ?? null) : null;
      if (outcome.driftReasons.length > 0) driftCount += 1;

      await db
        .update(chunks)
        .set({
          topicId,
          bloomLevel: outcome.bloomLevel,
          difficulty: outcome.difficulty,
          lomFormat: outcome.lomFormat as never,
          resourceType: outcome.resourceType,
          tagConfidence: outcome.confidence,
          // The full LOM record alongside the indexed columns (FR-INT-025).
          // The tagger's own reasoning is kept because the review UI shows it.
          lom: {
            keywords: outcome.keywords,
            reasoning: outcome.reasoning,
            cloCodes: outcome.cloCodes,
            driftReasons: outcome.driftReasons,
            taggedAt: new Date().toISOString(),
          },
        })
        .where(eq(chunks.id, outcome.chunkId));

      await db.delete(chunkClos).where(eq(chunkClos.chunkId, outcome.chunkId));
      const cloIds = outcome.cloCodes
        .map((code) => cloIdByCode.get(code))
        .filter((id): id is string => id !== undefined);
      if (cloIds.length > 0) {
        await db
          .insert(chunkClos)
          .values(cloIds.map((cloId) => ({ chunkId: outcome.chunkId, cloId, relevance: 1 })))
          .onConflictDoNothing();
      }
    }

    done += batch.length;
    await reportProgress(job.materialId, "tag", done, rows.length);
  }

  await finishStage(job.materialId, "tag", done);
  logger.info("tag complete", {
    correlationId: job.correlationId,
    materialId: job.materialId,
    tagged: done,
    driftFailures: driftCount,
  });
}

export async function runEmbed(job: StageJobData): Promise<void> {
  const provider = await getEmbeddingProvider();

  // Only rows that are missing an embedding or were embedded by a different
  // model — that is what makes a re-run cheap and a provider switch correct.
  const rows = await db
    .select({ id: chunks.id, text: chunks.text })
    .from(chunks)
    .where(
      raw`${chunks.materialId} = ${job.materialId}
          AND (${chunks.embedding} IS NULL OR ${chunks.embeddingModel} IS DISTINCT FROM ${provider.model})`,
    )
    .orderBy(chunks.ordinal);

  await startStage(job.materialId, "embed", rows.length);
  if (rows.length === 0) {
    await finishStage(job.materialId, "embed", 0);
    return;
  }

  const BATCH = 64;
  let done = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vectors = await embedDocuments(batch.map((r) => r.text));

    for (const [index, row] of batch.entries()) {
      const vector = vectors[index];
      if (!vector) continue;
      await db
        .update(chunks)
        .set({ embedding: vector, embeddingModel: provider.model })
        .where(eq(chunks.id, row.id));
    }

    done += batch.length;
    await reportProgress(job.materialId, "embed", done, rows.length);
  }

  await finishStage(job.materialId, "embed", done);
  logger.info("embed complete", {
    correlationId: job.correlationId,
    materialId: job.materialId,
    embedded: done,
    provider: provider.id,
    model: provider.model,
  });
}

/**
 * Index stage. The HNSW and GIN indexes are created by the migration, so this
 * refreshes planner statistics rather than building them — after a bulk insert
 * the planner's estimates are stale and it may ignore the vector index
 * entirely, which quietly turns filtered ANN into a sequential scan.
 */
export async function runIndex(job: StageJobData): Promise<void> {
  await startStage(job.materialId, "index", 1);
  await db.execute(raw`ANALYZE chunks`);
  await reportProgress(job.materialId, "index", 1, 1);
  await finishStage(job.materialId, "index", 1);
}

export async function runKgLink(job: StageJobData): Promise<void> {
  await startStage(job.materialId, "kg_link", 1);

  const [course] = await db
    .select({ code: courses.code })
    .from(courses)
    .where(eq(courses.id, job.courseId))
    .limit(1);

  await syncKnowledgeGraph(course?.code);

  const [{ count } = { count: 0 }] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(chunks)
    .where(eq(chunks.materialId, job.materialId));

  await reportProgress(job.materialId, "kg_link", 1, 1);
  await finishStage(job.materialId, "kg_link", 1);

  // Newly indexed material is retrievable from this moment with no restart
  // (FR-INT-018) — nothing is cached in-process that would need invalidating.
  await markIndexed(job.materialId, count);
  logger.info("ingestion complete", {
    correlationId: job.correlationId,
    materialId: job.materialId,
    chunks: count,
  });
}

/** Untagged chunks after a tag stage — surfaced in the review queue. */
export async function countUntagged(materialId: string): Promise<number> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(chunks)
    .where(raw`${chunks.materialId} = ${materialId} AND ${chunks.topicId} IS NULL`);
  return count;
}

export async function loadCourseContext(courseId: string): Promise<CourseContext> {
  const [course] = await db
    .select({ code: courses.code, title: courses.title })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  if (!course) throw new Error(`course ${courseId} not found`);

  const cloRows = await db
    .select({ code: clos.code, statement: clos.statement, bloomLevel: clos.bloomLevel })
    .from(clos)
    .where(eq(clos.courseId, courseId))
    .orderBy(clos.ordinal);

  const topicRows = await db
    .select({ code: topics.code, title: topics.title, week: topics.week })
    .from(topics)
    .where(eq(topics.courseId, courseId))
    .orderBy(topics.ordinal);

  return {
    courseCode: course.code,
    courseTitle: course.title,
    clos: cloRows,
    topics: topicRows,
  };
}

async function loadTopicIds(courseId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: topics.id, code: topics.code })
    .from(topics)
    .where(eq(topics.courseId, courseId));
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function loadCloIds(courseId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: clos.id, code: clos.code })
    .from(clos)
    .where(eq(clos.courseId, courseId));
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Used by the tag-review queue to find chunks that never got a topic. */
export async function untaggedChunkIds(courseId: string): Promise<string[]> {
  const rows = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(eq(chunks.courseId, courseId), isNull(chunks.topicId)));
  return rows.map((r) => r.id);
}
