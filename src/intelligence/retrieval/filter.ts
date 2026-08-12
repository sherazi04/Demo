import { sql, type SQL } from "drizzle-orm";
import { pgArray } from "@/lib/pg-array";
import type { RetrievalFilter } from "./types";

/**
 * Builds the metadata predicate applied *inside* the retrieval query.
 *
 * FILTER-FIRST IS NON-NEGOTIABLE (design.md §6.4). These predicates go into the
 * same statement as the vector search so Postgres applies them during the ANN
 * scan. Retrieving top-k by vector distance and filtering afterwards would
 * silently return fewer than k results — or none — and, worse, would let
 * Bloom-inappropriate content through whenever the filtered set is sparse. The
 * entire CLO-alignment claim rests on retrieved context actually matching the
 * requested cognitive level, so there is no fallback to unfiltered ANN anywhere
 * in this codebase.
 */
export function buildFilterConditions(filter: RetrievalFilter): SQL[] {
  const conditions: SQL[] = [sql`c.course_id = ${filter.courseId}`];

  // Only embedded chunks are retrievable; an un-embedded row cannot participate
  // in dense search and would skew the lexical channel's rank positions.
  conditions.push(sql`c.embedding IS NOT NULL`);

  if (filter.topicIds && filter.topicIds.length > 0) {
    conditions.push(sql`c.topic_id = ANY(${pgArray(filter.topicIds)}::uuid[])`);
  }

  if (filter.cloIds && filter.cloIds.length > 0) {
    // EXISTS rather than a join: a chunk mapped to several of the requested
    // CLOs must appear once, not once per matching mapping row.
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM chunk_clos cc
        WHERE cc.chunk_id = c.id AND cc.clo_id = ANY(${pgArray(filter.cloIds)}::uuid[])
      )`,
    );
  }

  if (filter.bloomBand) {
    const [low, high] = filter.bloomBand;
    conditions.push(sql`c.bloom_level BETWEEN ${low} AND ${high}`);
  }

  if (filter.difficultyBand) {
    const [low, high] = filter.difficultyBand;
    conditions.push(sql`c.difficulty BETWEEN ${low} AND ${high}`);
  }

  if (filter.lomFormats && filter.lomFormats.length > 0) {
    conditions.push(sql`c.lom_format = ANY(${pgArray(filter.lomFormats)}::lom_format[])`);
  }

  if (filter.materialIds && filter.materialIds.length > 0) {
    conditions.push(sql`c.material_id = ANY(${pgArray(filter.materialIds)}::uuid[])`);
  }

  if (filter.excludeChunkIds && filter.excludeChunkIds.length > 0) {
    conditions.push(sql`c.id <> ALL(${pgArray(filter.excludeChunkIds)}::uuid[])`);
  }

  if (filter.verifiedOnly) {
    conditions.push(sql`c.verified_by IS NOT NULL`);
  }

  if (filter.minTagConfidence !== undefined) {
    // A human-verified tag passes regardless of what the tagger originally
    // scored it — the whole point of review is to override low confidence.
    conditions.push(
      sql`(c.verified_by IS NOT NULL OR c.tag_confidence >= ${filter.minTagConfidence})`,
    );
  }

  return conditions;
}

/** ANDs the conditions into a single WHERE fragment. */
export function combineConditions(conditions: SQL[]): SQL {
  return sql.join(conditions, sql` AND `);
}
