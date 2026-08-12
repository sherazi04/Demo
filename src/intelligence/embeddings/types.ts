/**
 * Provider-agnostic embedding interface (design.md §6.3, NFR-MNT-003).
 *
 * Anthropic serves no embeddings endpoint, so this is where the system talks to
 * a different vendor — or to nothing at all, in the `local` case.
 */
export interface EmbeddingProvider {
  readonly id: "voyage" | "openai" | "local";
  readonly model: string;
  readonly dimensions: number;
  /**
   * `kind` matters: several providers embed a search query and a stored
   * document into deliberately different regions of the space, and passing the
   * wrong one measurably degrades recall.
   */
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

/** L2 normalisation, so cosine similarity reduces to a dot product. */
export function l2Normalise(vector: number[]): number[] {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return vector.slice();
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Splits into provider-sized batches. */
export function batched<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
