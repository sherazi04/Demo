import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { toVectorLiteral } from "@/intelligence/embeddings";
import { pgArray } from "@/lib/pg-array";
import { buildFilterConditions, combineConditions } from "@/intelligence/retrieval/filter";
import type { RetrievalFilter } from "@/intelligence/retrieval/types";
import type { LexicalHit, VectorHit, VectorStore } from "./store";

/**
 * pgvector-backed store. Raw SQL here rather than Drizzle's query builder
 * because the `<=>` cosine operator, the trigram `%`/`similarity()` pair, and
 * the array casts are Postgres features the builder does not model — one of the
 * few places the conventions permit raw SQL. Every value is still parameterised
 * (NFR-SEC-005); nothing is string-interpolated.
 */
export class PgVectorStore implements VectorStore {
  readonly id = "pgvector";

  async searchDense(
    embedding: readonly number[],
    filter: RetrievalFilter,
    limit: number,
  ): Promise<VectorHit[]> {
    const literal = toVectorLiteral(embedding);
    const where = combineConditions(buildFilterConditions(filter));

    /*
     * The filter and the ORDER BY live in one statement, so the planner applies
     * the predicates during the index scan rather than after it. This is the
     * filter-first guarantee in its concrete form.
     */
    const rows = await db.execute<{ id: string; distance: number }>(sql`
      SELECT c.id, (c.embedding <=> ${literal}::vector) AS distance
      FROM chunks c
      WHERE ${where}
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${limit}
    `);

    return [...rows].map((row) => ({ id: row.id, distance: Number(row.distance) }));
  }

  async searchLexical(
    query: string,
    filter: RetrievalFilter,
    limit: number,
  ): Promise<LexicalHit[]> {
    const where = combineConditions(buildFilterConditions(filter));

    // `similarity()` is used rather than the `%` operator so a threshold can be
    // applied explicitly instead of depending on the session's
    // pg_trgm.similarity_threshold GUC, which is per-connection state.
    const rows = await db.execute<{ id: string; similarity: number }>(sql`
      SELECT c.id, similarity(c.text, ${query}) AS similarity
      FROM chunks c
      WHERE ${where}
        AND similarity(c.text, ${query}) > 0.05
      ORDER BY similarity(c.text, ${query}) DESC
      LIMIT ${limit}
    `);

    return [...rows].map((row) => ({ id: row.id, similarity: Number(row.similarity) }));
  }

  async searchByTopics(
    topicIds: string[],
    filter: RetrievalFilter,
    limit: number,
  ): Promise<string[]> {
    if (topicIds.length === 0) return [];
    const where = combineConditions(buildFilterConditions(filter));

    // Ordered by tag confidence so graph expansion pulls the best-tagged
    // material for a neighbouring topic rather than an arbitrary row.
    const rows = await db.execute<{ id: string }>(sql`
      SELECT c.id
      FROM chunks c
      WHERE ${where}
        AND c.topic_id = ANY(${pgArray(topicIds)}::uuid[])
      ORDER BY c.tag_confidence DESC NULLS LAST, c.ordinal ASC
      LIMIT ${limit}
    `);

    return [...rows].map((row) => row.id);
  }
}

let cached: PgVectorStore | null = null;

export function getVectorStore(): VectorStore {
  cached ??= new PgVectorStore();
  return cached;
}
