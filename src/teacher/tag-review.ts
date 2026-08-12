import { and, asc, eq, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { chunkClos, chunks, clos, topics } from "@/db/schema";
import { append } from "@/governance/audit";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { pgArray } from "@/lib/pg-array";
import { syncKnowledgeGraph } from "@/intelligence/kg/sync";
import type { AuthedUser } from "@/auth/guard";

/**
 * Human-in-the-loop tag review (FR-INT-023, FR-INT-024).
 *
 * The queue is ordered by ascending tagger confidence, so the chunks the model
 * was least sure about — and every drift failure, which is forced to zero —
 * reach a human first. Treating this as a first-class feature rather than a
 * cleanup chore is the mitigation for R1: auto-tagger accuracy is what every
 * downstream metadata filter depends on.
 */

export interface QueueItem {
  chunkId: string;
  text: string;
  materialTitle: string;
  sectionPath: string | null;
  pageFrom: number | null;
  pageTo: number | null;

  topicId: string | null;
  topicCode: string | null;
  topicTitle: string | null;
  bloomLevel: number | null;
  difficulty: number | null;
  lomFormat: string | null;
  resourceType: string | null;
  tagConfidence: number | null;
  cloIds: string[];

  /** The tagger's own justification, shown beside the chunk. */
  reasoning: string | null;
  keywords: string[];
  /** Non-empty when the tagger named something outside the curriculum. */
  driftReasons: string[];

  verified: boolean;
  verifiedAt: Date | null;
}

interface QueueRow extends Record<string, unknown> {
  id: string;
  text: string;
  material_title: string;
  section_path: string | null;
  page_from: number | null;
  page_to: number | null;
  topic_id: string | null;
  topic_code: string | null;
  topic_title: string | null;
  bloom_level: number | null;
  difficulty: number | null;
  lom_format: string | null;
  resource_type: string | null;
  tag_confidence: number | null;
  clo_ids: string[] | null;
  lom: { reasoning?: string; keywords?: string[]; driftReasons?: string[] } | null;
  verified_by: string | null;
  verified_at: Date | null;
}

export async function getReviewQueue(
  courseId: string,
  options: { limit?: number; includeVerified?: boolean } = {},
): Promise<QueueItem[]> {
  const limit = Math.min(options.limit ?? 50, 200);

  const rows = await db.execute<QueueRow>(raw`
    SELECT
      c.id, c.text, m.title AS material_title,
      c.section_path, c.page_from, c.page_to,
      c.topic_id, t.code AS topic_code, t.title AS topic_title,
      c.bloom_level, c.difficulty, c.lom_format::text AS lom_format,
      c.resource_type, c.tag_confidence, c.lom,
      c.verified_by, c.verified_at,
      COALESCE(
        (SELECT array_agg(cc.clo_id) FROM chunk_clos cc WHERE cc.chunk_id = c.id),
        ARRAY[]::uuid[]
      ) AS clo_ids
    FROM chunks c
    JOIN materials m ON m.id = c.material_id
    LEFT JOIN topics t ON t.id = c.topic_id
    WHERE c.course_id = ${courseId}
      ${options.includeVerified ? raw`` : raw`AND c.verified_by IS NULL`}
    ORDER BY
      -- Untagged chunks are the most urgent: they are invisible to every
      -- metadata-filtered query until a human assigns a topic.
      (c.topic_id IS NULL) DESC,
      c.tag_confidence ASC NULLS FIRST,
      c.ordinal ASC
    LIMIT ${limit}
  `);

  return [...rows].map((row) => ({
    chunkId: row.id,
    text: row.text,
    materialTitle: row.material_title,
    sectionPath: row.section_path,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    topicId: row.topic_id,
    topicCode: row.topic_code,
    topicTitle: row.topic_title,
    bloomLevel: row.bloom_level,
    difficulty: row.difficulty === null ? null : Number(row.difficulty),
    lomFormat: row.lom_format,
    resourceType: row.resource_type,
    tagConfidence: row.tag_confidence === null ? null : Number(row.tag_confidence),
    cloIds: row.clo_ids ?? [],
    reasoning: row.lom?.reasoning ?? null,
    keywords: row.lom?.keywords ?? [],
    driftReasons: row.lom?.driftReasons ?? [],
    verified: row.verified_by !== null,
    verifiedAt: row.verified_at,
  }));
}

export const tagCorrectionSchema = z.object({
  topicId: z.string().uuid().nullable(),
  bloomLevel: z.number().int().min(1).max(6).nullable(),
  difficulty: z.number().min(0).max(1).nullable(),
  lomFormat: z
    .enum(["definition", "worked_example", "proof", "exercise", "figure", "code", "narrative"])
    .nullable(),
  resourceType: z.string().max(120).nullable().optional(),
  cloIds: z.array(z.string().uuid()),
});

export type TagCorrection = z.infer<typeof tagCorrectionSchema>;

/**
 * Applies a teacher's correction (FR-INT-024).
 *
 * Sets `verified_by`/`verified_at`, which every retrieval filter treats as
 * overriding the tagger's confidence entirely — a human-verified tag is trusted
 * regardless of what the model originally scored it.
 */
export async function applyCorrection(
  actor: AuthedUser,
  chunkId: string,
  correction: TagCorrection,
): Promise<{ topicChanged: boolean }> {
  const [before] = await db
    .select({
      id: chunks.id,
      courseId: chunks.courseId,
      topicId: chunks.topicId,
      bloomLevel: chunks.bloomLevel,
      lom: chunks.lom,
    })
    .from(chunks)
    .where(eq(chunks.id, chunkId))
    .limit(1);
  if (!before) throw new NotFoundError("Chunk");

  // Reject a topic or CLO from another course outright: accepting one would
  // create exactly the cross-curriculum drift the validation engine exists to
  // catch, but written by a human and therefore trusted downstream.
  if (correction.topicId) {
    const [topic] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.id, correction.topicId), eq(topics.courseId, before.courseId)))
      .limit(1);
    if (!topic) throw new NotFoundError("Topic in this course");
  }
  if (correction.cloIds.length > 0) {
    const valid = await db
      .select({ id: clos.id })
      .from(clos)
      .where(and(eq(clos.courseId, before.courseId), inArrayUuid(clos.id, correction.cloIds)));
    if (valid.length !== correction.cloIds.length) {
      throw new NotFoundError("One or more CLOs in this course");
    }
  }

  const existingLom = (before.lom ?? {}) as Record<string, unknown>;

  await db
    .update(chunks)
    .set({
      topicId: correction.topicId,
      bloomLevel: correction.bloomLevel,
      difficulty: correction.difficulty,
      lomFormat: correction.lomFormat as never,
      resourceType: correction.resourceType ?? null,
      // Confidence becomes 1: a verified tag is certain by definition, and
      // leaving the model's score would keep re-surfacing it in the queue.
      tagConfidence: 1,
      verifiedBy: actor.id,
      verifiedAt: new Date(),
      lom: {
        ...existingLom,
        // The original machine tag is preserved, not overwritten — it is the
        // evidence the bloom-accuracy metric is measured against.
        machineTag: existingLom["machineTag"] ?? {
          topicId: before.topicId,
          bloomLevel: before.bloomLevel,
          reasoning: existingLom["reasoning"] ?? null,
        },
        driftReasons: [],
        verifiedAt: new Date().toISOString(),
      },
    })
    .where(eq(chunks.id, chunkId));

  await db.delete(chunkClos).where(eq(chunkClos.chunkId, chunkId));
  if (correction.cloIds.length > 0) {
    await db
      .insert(chunkClos)
      .values(correction.cloIds.map((cloId) => ({ chunkId, cloId, relevance: 1 })))
      .onConflictDoNothing();
  }

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "chunk.tag.verify",
    resourceType: "chunk",
    resourceId: chunkId,
    payload: {
      topicBefore: before.topicId,
      topicAfter: correction.topicId,
      bloomBefore: before.bloomLevel,
      bloomAfter: correction.bloomLevel,
      cloCount: correction.cloIds.length,
    },
  });

  const topicChanged = before.topicId !== correction.topicId;
  if (topicChanged) {
    // The graph carries ABOUT and EVIDENCE_FOR edges derived from this row, so
    // a correction that does not re-sync leaves the graph disagreeing with
    // Postgres — and graph expansion would keep using the wrong topic.
    try {
      await syncKnowledgeGraph();
    } catch (error: unknown) {
      logger.warn("tag correction saved but graph re-sync failed; run npm run sync:kg", {
        chunkId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { topicChanged };
}

/** Queue health, shown above the list so progress is visible. */
export async function queueStats(courseId: string): Promise<{
  total: number;
  unverified: number;
  untagged: number;
  drifted: number;
  lowConfidence: number;
}> {
  const [row] = await db.execute<{
    total: number;
    unverified: number;
    untagged: number;
    drifted: number;
    low_confidence: number;
  }>(raw`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE verified_by IS NULL)::int AS unverified,
      count(*) FILTER (WHERE topic_id IS NULL)::int AS untagged,
      count(*) FILTER (WHERE jsonb_array_length(COALESCE(lom->'driftReasons', '[]'::jsonb)) > 0)::int AS drifted,
      count(*) FILTER (WHERE verified_by IS NULL AND tag_confidence < 0.6)::int AS low_confidence
    FROM chunks
    WHERE course_id = ${courseId}
  `);

  return {
    total: Number(row?.total ?? 0),
    unverified: Number(row?.unverified ?? 0),
    untagged: Number(row?.untagged ?? 0),
    drifted: Number(row?.drifted ?? 0),
    lowConfidence: Number(row?.low_confidence ?? 0),
  };
}

/** Curriculum options for the correction form. */
export async function correctionOptions(courseId: string) {
  const [topicRows, cloRows] = await Promise.all([
    db
      .select({ id: topics.id, code: topics.code, title: topics.title, week: topics.week })
      .from(topics)
      .where(eq(topics.courseId, courseId))
      .orderBy(asc(topics.ordinal)),
    db
      .select({ id: clos.id, code: clos.code, statement: clos.statement, bloomLevel: clos.bloomLevel })
      .from(clos)
      .where(eq(clos.courseId, courseId))
      .orderBy(asc(clos.ordinal)),
  ]);
  return { topics: topicRows, clos: cloRows };
}

/** Small helper so the CLO membership check stays readable. */
function inArrayUuid(column: typeof clos.id, values: string[]) {
  return raw`${column} = ANY(${pgArray(values)}::uuid[])`;
}
