import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { embedQuery, getEmbeddingProvider } from "@/intelligence/embeddings";
import { getVectorStore } from "@/intelligence/vector/pgvector";
import { getConfig } from "@/lib/config";
import { pgArray } from "@/lib/pg-array";
import { logger } from "@/lib/logger";
import { assemble } from "./assemble";
import { reciprocalRankFusion, type RankedList } from "./fuse";
import { expandViaGraph } from "./graph-expand";
import { rerank } from "./rerank";
import type {
  RetrievalFilter,
  RetrievalOptions,
  RetrievalResponse,
  RetrievalResult,
} from "./types";

export * from "./types";
export { reciprocalRankFusion } from "./fuse";
export { renderContext } from "./assemble";

/**
 * The retrieval pipeline (design.md §6.4):
 *
 *   filter → dense (pgvector HNSW) + lexical (pg_trgm)
 *          → graph expansion over PREREQ_OF / ASSESSED_BY
 *          → Reciprocal Rank Fusion (k = 60)
 *          → optional rerank
 *          → assemble with chunk ids, LOM metadata and source locators
 *
 * The metadata filter is applied inside the dense and lexical queries, never
 * after them — see `filter.ts` for why that is load-bearing rather than an
 * optimisation.
 */
export async function retrieve(
  query: string,
  filter: RetrievalFilter,
  options: RetrievalOptions = {},
): Promise<RetrievalResponse> {
  const startedAt = Date.now();
  const config = await getConfig();
  const store = getVectorStore();

  const vectorK = options.vectorK ?? config["retrieval.vectorK"];
  const lexicalK = options.lexicalK ?? config["retrieval.lexicalK"];
  const graphHops = options.graphHops ?? config["retrieval.graphHops"];
  const graphK = options.graphK ?? config["retrieval.graphK"];
  const finalK = options.finalK ?? config["retrieval.finalK"];
  const rrfK = options.rrfK ?? config["retrieval.rrfK"];
  const graphPenalty = config["retrieval.graphRankPenalty"];
  const shouldRerank = options.rerank ?? config["retrieval.rerankEnabled"];

  const provider = await getEmbeddingProvider();

  // 1–2. Embed, then dense and lexical search over the same filtered set.
  const embedStart = Date.now();
  const queryVector = await embedQuery(query);
  const embedMs = Date.now() - embedStart;

  const denseStart = Date.now();
  const dense = await store.searchDense(queryVector, filter, vectorK);
  const denseMs = Date.now() - denseStart;

  const lexicalStart = Date.now();
  const lexical = await store.searchLexical(query, filter, lexicalK);
  const lexicalMs = Date.now() - lexicalStart;

  // 3–4. Seed graph expansion from the topics the first two channels surfaced.
  const graphStart = Date.now();
  const seedIds = [...new Set([...dense.map((d) => d.id), ...lexical.map((l) => l.id)])];
  const seedTopicIds = await topicsForChunks(seedIds);

  const expansion = options.disableGraph
    ? { chunkIds: [], expandedTopicIds: [] }
    : await expandViaGraph(seedTopicIds, filter, graphHops, graphK);
  const graphMs = Date.now() - graphStart;

  // 5. Fuse. Graph-only hits enter behind the ranked channels via the penalty.
  const lists: RankedList[] = [
    { channel: "dense", ids: dense.map((d) => d.id) },
    { channel: "lexical", ids: lexical.map((l) => l.id) },
    { channel: "graph", ids: expansion.chunkIds, rankPenalty: graphPenalty },
  ];
  const fused = reciprocalRankFusion(lists, rrfK);

  // 6–7. Assemble, then optionally re-score.
  const assembleStart = Date.now();
  let results: RetrievalResult[] = await assemble(fused, finalK);
  if (shouldRerank && results.length > 1) {
    results = await rerank(query, results, {
      preferBloom: filter.bloomBand ? filter.bloomBand[0] : null,
    });
  }
  const assembleMs = Date.now() - assembleStart;

  const totalMs = Date.now() - startedAt;
  if (totalMs > 1500) {
    // NFR-PRF-001 targets p95 under 1.5s on a 5,000-chunk corpus.
    logger.warn("retrieval exceeded the 1.5s target", { totalMs, denseMs, lexicalMs, graphMs });
  }

  return {
    results,
    diagnostics: {
      query,
      filter,
      embeddingProvider: provider.id,
      embeddingModel: provider.model,
      denseCount: dense.length,
      lexicalCount: lexical.length,
      graphCount: expansion.chunkIds.length,
      graphExpandedTopicIds: expansion.expandedTopicIds,
      fusedCount: fused.length,
      returnedCount: results.length,
      reranked: shouldRerank && results.length > 1,
      timings: { embedMs, denseMs, lexicalMs, graphMs, assembleMs, totalMs },
    },
  };
}

/** Distinct topic ids for a set of chunks — the graph-expansion seed set. */
async function topicsForChunks(chunkIds: readonly string[]): Promise<string[]> {
  if (chunkIds.length === 0) return [];
  const rows = await db.execute<{ topic_id: string }>(sql`
    SELECT DISTINCT c.topic_id
    FROM chunks c
    WHERE c.id = ANY(${pgArray(chunkIds)}::uuid[]) AND c.topic_id IS NOT NULL
  `);
  return [...rows].map((row) => row.topic_id);
}
