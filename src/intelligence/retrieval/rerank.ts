import { cosineSimilarity } from "@/intelligence/embeddings/types";
import { embedQuery } from "@/intelligence/embeddings";
import type { RetrievalResult } from "./types";

/**
 * Optional re-ranking stage (FR-INT-043, design.md §6.4 step 6).
 *
 * A cross-encoder would be the strong option, but it needs a model this demo
 * does not ship. What is implemented instead is an honest, deterministic
 * re-scorer: embedding similarity between the query and each chunk's own text,
 * blended with the fusion score and small metadata affinities.
 *
 * It is labelled `embedding-blend` rather than "reranker" so no reader mistakes
 * it for cross-encoder relevance. Off by default.
 */

export type RerankStrategy = "embedding-blend";

export interface RerankOptions {
  /** Preferred Bloom level; chunks at that level get a small boost. */
  preferBloom?: number | null;
  /** Weight given to the re-score versus the original fusion rank. */
  blend?: number;
}

export async function rerank(
  query: string,
  results: RetrievalResult[],
  options: RerankOptions = {},
): Promise<RetrievalResult[]> {
  if (results.length <= 1) return results;

  const blend = options.blend ?? 0.5;
  const queryVector = await embedQuery(query);

  // Re-embedding chunk text rather than reading the stored vector, because the
  // stored one may have been written by a different provider or dimension —
  // `embedding_model` exists precisely to make that mismatch detectable.
  const { getEmbeddingProvider } = await import("@/intelligence/embeddings");
  const provider = await getEmbeddingProvider();
  const chunkVectors = await provider.embed(
    results.map((r) => r.text),
    "document",
  );

  // Fusion scores are tiny reciprocals; normalise both signals to [0,1] so the
  // blend weight means what it says.
  const maxFusion = Math.max(...results.map((r) => r.score), Number.EPSILON);

  const scored = results.map((result, index) => {
    const vector = chunkVectors[index];
    const similarity = vector ? cosineSimilarity(queryVector, vector) : 0;
    const normalisedFusion = result.score / maxFusion;

    let score = (1 - blend) * normalisedFusion + blend * Math.max(0, similarity);

    if (options.preferBloom && result.bloomLevel === options.preferBloom) {
      score += 0.05;
    }
    // A human-verified tag is a stronger guarantee than a confident tagger.
    if (result.verified) score += 0.03;

    return { result, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.result.id.localeCompare(b.result.id);
  });

  return scored.map((s) => ({ ...s.result, score: s.score }));
}
