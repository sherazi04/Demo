import { describe, expect, it } from "vitest";
import { LocalEmbeddingProvider } from "@/intelligence/embeddings/local";
import { cosineSimilarity, l2Normalise, batched } from "@/intelligence/embeddings/types";

const provider = new LocalEmbeddingProvider(1024);

async function embed(text: string): Promise<number[]> {
  const [vector] = await provider.embed([text], "document");
  if (!vector) throw new Error("no vector");
  return vector;
}

describe("l2Normalise", () => {
  it("produces a unit vector", () => {
    const v = l2Normalise([3, 4]);
    expect(Math.hypot(...v)).toBeCloseTo(1, 10);
  });

  it("leaves the zero vector alone rather than dividing by zero", () => {
    expect(l2Normalise([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical direction and -1 for opposite", () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("is 0 for orthogonal vectors and for a zero vector", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("batched", () => {
  it("splits into fixed-size batches with a short tail", () => {
    expect(batched([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns nothing for an empty input", () => {
    expect(batched([], 10)).toEqual([]);
  });
});

describe("LocalEmbeddingProvider", () => {
  it("produces vectors of the configured width", async () => {
    const v = await embed("binary search tree");
    expect(v).toHaveLength(1024);
  });

  it("is deterministic across calls and process-independent", async () => {
    const a = await embed("quicksort partitioning");
    const b = await embed("quicksort partitioning");
    expect(a).toEqual(b);

    // A second instance must agree, or a re-embed would silently invalidate
    // every stored vector.
    const other = new LocalEmbeddingProvider(1024);
    const [c] = await other.embed(["quicksort partitioning"], "document");
    expect(c).toEqual(a);
  });

  it("returns unit vectors so cosine reduces to a dot product", async () => {
    const v = await embed("hash table collision resolution");
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  });

  it("returns a zero vector for empty input without producing NaN", async () => {
    const v = await embed("   ");
    expect(v.every((x) => x === 0)).toBe(true);
    expect(v.some(Number.isNaN)).toBe(false);
  });

  it("scores lexically related text above unrelated text", async () => {
    const query = await embed("binary search tree insertion");
    const related = await embed("inserting a node into a binary search tree");
    const unrelated = await embed("greedy interval scheduling by earliest finish time");

    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated),
    );
  });

  it("is case- and punctuation-insensitive", async () => {
    const a = await embed("Merge Sort: divide and conquer!");
    const b = await embed("merge sort divide and conquer");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.95);
  });

  it("matches morphological variants through character n-grams", async () => {
    const a = await embed("sorting algorithm");
    const b = await embed("sorted algorithms");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.4);
  });

  /**
   * This is the documented weakness (design.md §16.3) and is asserted rather
   * than hidden: a pure paraphrase with no shared substrings scores low, which
   * is exactly why reported retrieval figures must not be measured on this
   * provider.
   */
  it("does not capture semantics without lexical overlap", async () => {
    const a = await embed("last in first out");
    const b = await embed("stack discipline");
    expect(cosineSimilarity(a, b)).toBeLessThan(0.3);
  });

  it("embeds a batch in input order", async () => {
    const texts = ["heap", "trie", "graph"];
    const vectors = await provider.embed(texts, "document");
    expect(vectors).toHaveLength(3);
    for (const [index, text] of texts.entries()) {
      const [single] = await provider.embed([text], "document");
      expect(vectors[index]).toEqual(single);
    }
  });

  it("honours a different configured dimension", async () => {
    const small = new LocalEmbeddingProvider(256);
    const [v] = await small.embed(["dynamic programming"], "document");
    expect(v).toHaveLength(256);
  });
});
