import { expandTopics } from "@/intelligence/kg/queries";
import { isReachable } from "@/intelligence/kg/driver";
import { getVectorStore } from "@/intelligence/vector/pgvector";
import { logger } from "@/lib/logger";
import type { RetrievalFilter } from "./types";

/**
 * Graph expansion (design.md §6.4 step 4, FR-INT-042).
 *
 * Seeds from the topics of the dense and lexical hits, walks PREREQ_OF and
 * ASSESSED_BY, then pulls chunks about the neighbouring topics. This is what
 * makes the retrieval "Graph RAG" rather than plain hybrid search: a question
 * about quicksort can reach partitioning and recursion material that shares no
 * vocabulary with the query.
 */

export interface GraphExpansion {
  chunkIds: string[];
  expandedTopicIds: string[];
}

export async function expandViaGraph(
  seedTopicIds: readonly string[],
  filter: RetrievalFilter,
  hops: number,
  limit: number,
): Promise<GraphExpansion> {
  if (seedTopicIds.length === 0 || hops <= 0 || limit <= 0) {
    return { chunkIds: [], expandedTopicIds: [] };
  }

  // Neo4j is a derived read model. If it is unreachable the pipeline degrades
  // to dense + lexical fusion rather than failing the request outright — a
  // graph outage should cost recall, not availability.
  if (!(await isReachable())) {
    logger.warn("neo4j unreachable — retrieval continuing without graph expansion");
    return { chunkIds: [], expandedTopicIds: [] };
  }

  let expandedTopicIds: string[];
  try {
    expandedTopicIds = await expandTopics([...seedTopicIds], hops);
  } catch (error: unknown) {
    logger.warn("graph expansion failed — continuing without it", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { chunkIds: [], expandedTopicIds: [] };
  }

  // Topics already covered by the dense/lexical hits contribute nothing new.
  const seeds = new Set(seedTopicIds);
  const novelTopics = expandedTopicIds.filter((id) => !seeds.has(id));
  if (novelTopics.length === 0) return { chunkIds: [], expandedTopicIds };

  // The same metadata filter applies here. Graph expansion widens *topic*
  // reach; it must not become a way for Bloom-inappropriate content to enter.
  const chunkIds = await getVectorStore().searchByTopics(novelTopics, filter, limit);

  return { chunkIds, expandedTopicIds };
}
