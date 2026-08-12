import IORedis from "ioredis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runPipelineInline, runStageInline } from "./inline";
import { enqueueStage, type IngestStageName, type StageJobData } from "@/worker/queues";

/**
 * Chooses between the queued worker and the inline runner.
 *
 * INGEST_MODE:
 *   queue   always BullMQ; fail loudly if Redis is down (production)
 *   inline  always in-process; never touch Redis
 *   auto    use Redis if it answers, otherwise run inline (default)
 *
 * `auto` exists so the system runs on a machine without Redis. It probes once
 * and logs which path it took — a fallback that happened silently would leave
 * someone wondering why uploads were slow, or worse, believing a queue was
 * absorbing work that was actually running in the request.
 */

type Mode = "queue" | "inline";

let resolved: Mode | null = null;

async function redisAnswers(): Promise<boolean> {
  const probe = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 1000,
    lazyConnect: true,
    retryStrategy: () => null,
  });

  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

export async function ingestMode(): Promise<Mode> {
  if (resolved) return resolved;

  const configured = env.INGEST_MODE;

  if (configured === "queue" || configured === "inline") {
    resolved = configured;
    logger.info("ingestion mode set by configuration", { mode: resolved });
    return resolved;
  }

  resolved = (await redisAnswers()) ? "queue" : "inline";
  logger.info(
    resolved === "queue"
      ? "ingestion will use the BullMQ worker (Redis answered)"
      : "ingestion will run inline (Redis did not answer). Uploads are processed " +
          "in-process and will block for the length of the pipeline. Start Redis and " +
          "`npm run worker` for the queued path.",
    { mode: resolved, redisUrl: env.REDIS_URL.replace(/\/\/.*@/, "//") },
  );
  return resolved;
}

/** Starts the whole pipeline for a freshly uploaded material. */
export async function dispatchIngest(data: StageJobData): Promise<Mode> {
  const mode = await ingestMode();

  if (mode === "queue") {
    await enqueueStage("parse", data);
    return mode;
  }

  await runPipelineInline(data);
  return mode;
}

/** Re-runs one stage, queued or inline. */
export async function dispatchStage(
  stage: IngestStageName,
  data: StageJobData,
): Promise<Mode> {
  const mode = await ingestMode();

  if (mode === "queue") {
    // Force, because a completed job holds the deterministic job id and would
    // otherwise silently deduplicate the retry away.
    await enqueueStage(stage, data, { force: true });
    return mode;
  }

  await runStageInline(stage, data);
  return mode;
}

/** Test seam: forget the probed mode so the next call re-resolves. */
export function resetIngestMode(): void {
  resolved = null;
}
