import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

/**
 * One shared Anthropic client. The SDK already implements bounded retry with
 * backoff on 408/409/429/5xx, so the router does not re-implement transport
 * retries — only schema-violation retries, which the SDK cannot know about.
 */
const globalForAnthropic = globalThis as unknown as { __dualEngineAnthropic?: Anthropic };

export function getAnthropic(): Anthropic {
  const existing = globalForAnthropic.__dualEngineAnthropic;
  if (existing) return existing;

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Generation, judging and tagging all require it. " +
        "Retrieval and the student engine run without it; set EMBEDDING_PROVIDER=local " +
        "to exercise the pipeline offline.",
    );
  }

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    // Milliseconds in the TypeScript SDK.
    timeout: env.LLM_TIMEOUT_MS,
    maxRetries: env.LLM_MAX_RETRIES,
  });

  if (env.NODE_ENV !== "production") globalForAnthropic.__dualEngineAnthropic = client;
  return client;
}

export function hasAnthropicKey(): boolean {
  return env.ANTHROPIC_API_KEY.length > 0;
}

export { Anthropic };
