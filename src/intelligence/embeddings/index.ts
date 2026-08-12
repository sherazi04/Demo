import { getConfig } from "@/lib/config";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { LocalEmbeddingProvider } from "./local";
import { OpenAiEmbeddingProvider } from "./openai";
import { VoyageEmbeddingProvider } from "./voyage";
import type { EmbeddingProvider } from "./types";

export * from "./types";
export { LocalEmbeddingProvider } from "./local";

/**
 * Resolves the configured provider (NFR-CFG-002). Cached per (provider,
 * dimensions) pair so a config change swaps the implementation without a
 * restart, and an unchanged config does not rebuild the client per call.
 */
let cached: { key: string; provider: EmbeddingProvider } | null = null;

export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  const config = await getConfig();
  const id = config["embedding.provider"];
  const dimensions = config["embedding.dimensions"];
  const key = `${id}:${dimensions}`;

  if (cached?.key === key) return cached.provider;

  let provider: EmbeddingProvider;
  switch (id) {
    case "voyage":
      provider = new VoyageEmbeddingProvider(env.VOYAGE_MODEL, dimensions, env.VOYAGE_API_KEY);
      break;
    case "openai":
      provider = new OpenAiEmbeddingProvider(
        env.OPENAI_EMBEDDING_MODEL,
        dimensions,
        env.OPENAI_API_KEY,
        env.OPENAI_BASE_URL,
      );
      break;
    case "local":
    default:
      provider = new LocalEmbeddingProvider(dimensions);
      break;
  }

  logger.info("embedding provider resolved", {
    provider: provider.id,
    model: provider.model,
    dimensions: provider.dimensions,
  });
  cached = { key, provider };
  return provider;
}

export function resetEmbeddingProviderCache(): void {
  cached = null;
}

/** Convenience wrapper for the single-text case. */
export async function embedQuery(text: string): Promise<number[]> {
  const provider = await getEmbeddingProvider();
  const [vector] = await provider.embed([text], "query");
  if (!vector) throw new Error("embedding provider returned no vector");
  return vector;
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const provider = await getEmbeddingProvider();
  return provider.embed(texts, "document");
}

/**
 * pgvector's text input format. Drizzle's `vector` column accepts a number[],
 * but raw SQL comparisons (`embedding <=> $1`) need the literal.
 */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
