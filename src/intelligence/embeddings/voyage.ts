import { batched, l2Normalise, type EmbeddingProvider } from "./types";
import { logger } from "@/lib/logger";

/** Voyage caps a request at 128 inputs. */
const BATCH_SIZE = 128;

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id = "voyage" as const;

  constructor(
    readonly model: string,
    readonly dimensions: number,
    private readonly apiKey: string,
  ) {
    if (!apiKey) {
      throw new Error(
        "VOYAGE_API_KEY is required for EMBEDDING_PROVIDER=voyage. " +
          "Set EMBEDDING_PROVIDER=local to run without any embedding API key.",
      );
    }
  }

  async embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
    const results: number[][] = [];

    for (const batch of batched(texts, BATCH_SIZE)) {
      const response = await fetchWithRetry("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
          input_type: kind,
          output_dimension: this.dimensions,
        }),
      });

      const payload = (await response.json()) as VoyageResponse;
      // The API is documented to return results in request order, but it also
      // returns an explicit index — sorting by it costs nothing and removes the
      // possibility of silently mismatching vectors to chunks.
      const ordered = [...payload.data].sort((a, b) => a.index - b.index);
      for (const item of ordered) results.push(l2Normalise(item.embedding));
    }

    return results;
  }
}

/**
 * Bounded retry with exponential backoff on 429 and 5xx (NFR-REL-002).
 * Shared with the OpenAI-compatible provider.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 4,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      const body = await response.text().catch(() => "");
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 300)}`);
      }

      // Honour Retry-After when the server sends it rather than guessing.
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 250 + Math.random() * 250;

      logger.warn("embedding request retry", { status: response.status, attempt, delay });
      await sleep(delay);
    } catch (error: unknown) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleep(2 ** attempt * 250 + Math.random() * 250);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Embedding request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
