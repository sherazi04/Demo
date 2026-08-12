import { batched, l2Normalise, type EmbeddingProvider } from "./types";
import { fetchWithRetry } from "./voyage";

const BATCH_SIZE = 96;

interface OpenAiResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Any OpenAI-compatible `/v1/embeddings` endpoint — OpenAI itself, Azure,
 * vLLM, Ollama, LM Studio. Keeping this generic is what makes a self-hosted
 * embedding model a configuration change rather than a code change.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai" as const;

  constructor(
    readonly model: string,
    readonly dimensions: number,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {
    // A local vLLM or Ollama endpoint typically needs no key, so an empty key
    // is only fatal when talking to api.openai.com itself.
    if (!apiKey && /(^|\.)openai\.com/i.test(new URL(baseUrl).hostname)) {
      throw new Error(
        "OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai against api.openai.com. " +
          "Point OPENAI_BASE_URL at a local endpoint, or use EMBEDDING_PROVIDER=local.",
      );
    }
  }

  async embed(texts: string[], _kind: "document" | "query"): Promise<number[][]> {
    const results: number[][] = [];
    const url = `${this.baseUrl.replace(/\/+$/, "")}/embeddings`;

    for (const batch of batched(texts, BATCH_SIZE)) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

      const response = await fetchWithRetry(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          input: batch,
          // Only the v3 OpenAI models honour this; compatible servers ignore
          // unknown fields, and the dimension is verified below regardless.
          dimensions: this.dimensions,
        }),
      });

      const payload = (await response.json()) as OpenAiResponse;
      const ordered = [...payload.data].sort((a, b) => a.index - b.index);

      for (const item of ordered) {
        if (item.embedding.length !== this.dimensions) {
          // Writing a wrong-width vector would fail at the pgvector column or,
          // worse, silently corrupt similarity if the column were resized.
          throw new Error(
            `Embedding provider returned ${item.embedding.length} dimensions, expected ${this.dimensions}. ` +
              `Set EMBEDDING_DIMENSIONS to match the model and re-embed the corpus.`,
          );
        }
        results.push(l2Normalise(item.embedding));
      }
    }

    return results;
  }
}
