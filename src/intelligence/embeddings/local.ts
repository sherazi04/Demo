import { createHash } from "node:crypto";
import { l2Normalise, type EmbeddingProvider } from "./types";

/**
 * Deterministic hashed character-n-gram embedding (design.md §6.3).
 *
 * Exists so the entire system runs with no API key and no network access
 * (FR-INT-045, acceptance criterion 2). It is a bag-of-n-grams projection, not
 * a learned model: it captures lexical overlap and morphology but no semantics,
 * so a paraphrase with no shared substrings scores near zero.
 *
 * README and eval output must state that retrieval figures measured on this
 * provider are a floor, not a representative result — that is a documented
 * limitation (design.md §16.3), not a caveat to bury.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local" as const;
  readonly model: string;
  readonly dimensions: number;

  /** Character n-gram sizes; 3–5 balances morphology against vocabulary blow-up. */
  private readonly gramSizes = [3, 4, 5];

  constructor(dimensions: number) {
    this.dimensions = dimensions;
    this.model = `local-hashed-ngram-${dimensions}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async embed(texts: string[], _kind: "document" | "query"): Promise<number[][]> {
    // Query and document share one space here: with no learned projection there
    // is nothing for an asymmetric encoding to exploit.
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const normalised = normaliseText(text);
    if (normalised.length === 0) return vector;

    // Whole-token features carry more signal than any single n-gram for short
    // technical terms ("heap", "trie"), so they are added alongside the grams.
    for (const token of normalised.split(" ")) {
      if (token.length === 0) continue;
      addFeature(vector, `w:${token}`, this.dimensions, 1.5);
    }

    const padded = ` ${normalised} `;
    for (const n of this.gramSizes) {
      if (padded.length < n) continue;
      for (let i = 0; i <= padded.length - n; i += 1) {
        addFeature(vector, `g${n}:${padded.slice(i, i + n)}`, this.dimensions, 1);
      }
    }

    // Sub-linear term weighting, the same reason tf-idf uses log: without it a
    // long chunk's repeated words dominate its own direction.
    for (let i = 0; i < vector.length; i += 1) {
      const value = vector[i] ?? 0;
      vector[i] = value === 0 ? 0 : Math.sign(value) * Math.log1p(Math.abs(value));
    }

    return l2Normalise(vector);
  }
}

function normaliseText(text: string): string {
  return text
    .toLowerCase()
    // NFKD splits accented letters into base + combining mark; the class below
    // then drops the marks along with all other non-alphanumerics.
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hashes a feature to a bucket and a sign. The sign bit is what keeps unrelated
 * features from systematically accumulating in the same direction when they
 * collide — signed hashing makes collisions cancel on average rather than add.
 */
function addFeature(
  vector: number[],
  feature: string,
  dimensions: number,
  weight: number,
): void {
  const digest = createHash("sha1").update(feature).digest();
  const a = digest[0] ?? 0;
  const b = digest[1] ?? 0;
  const c = digest[2] ?? 0;
  const d = digest[3] ?? 0;
  const raw = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

  const index = raw % dimensions;
  const sign = (digest[4] ?? 0) & 1 ? -1 : 1;
  vector[index] = (vector[index] ?? 0) + sign * weight;
}
