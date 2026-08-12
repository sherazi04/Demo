import type { RetrievalFilter } from "@/intelligence/retrieval/types";

/**
 * Vector store interface (NFR-MNT-003).
 *
 * The system uses pgvector because filtered ANN in the same query as the
 * metadata predicates is the whole premise — see design.md §1.2 for why FAISS
 * was rejected. This interface exists so that claim stays honest: an
 * alternative implementation must satisfy `filter`, not merely `topK`.
 */
export interface VectorHit {
  id: string;
  /** Cosine distance in [0, 2]; lower is nearer. */
  distance: number;
}

export interface LexicalHit {
  id: string;
  /** pg_trgm similarity in [0, 1]; higher is nearer. */
  similarity: number;
}

export interface VectorStore {
  readonly id: string;

  /** Dense ANN search with the metadata filter applied in the same statement. */
  searchDense(
    embedding: readonly number[],
    filter: RetrievalFilter,
    limit: number,
  ): Promise<VectorHit[]>;

  /** Lexical search over the same filtered set. */
  searchLexical(
    query: string,
    filter: RetrievalFilter,
    limit: number,
  ): Promise<LexicalHit[]>;

  /** Chunk ids restricted to a topic set — the graph-expansion candidate pull. */
  searchByTopics(
    topicIds: string[],
    filter: RetrievalFilter,
    limit: number,
  ): Promise<string[]>;
}
