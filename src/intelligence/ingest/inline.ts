import { logger } from "@/lib/logger";
import { failStage, incrementAttempts } from "./jobs";
import { PIPELINE, stageEntry } from "./stages";
import type { IngestStageName, StageJobData } from "@/worker/queues";

/**
 * Runs the ingestion pipeline in-process, without Redis or BullMQ.
 *
 * The queued worker is the real deployment path — a 600-page PDF's embed stage
 * would otherwise block whatever process called this. Inline exists so the
 * system is runnable on a machine with no Redis, which is the difference
 * between a reviewer seeing the pipeline work and reading a claim that it does.
 *
 * Behaviour is deliberately identical where it matters: the same six stages in
 * the same order, the same attempt counter, and the same `failStage` record on
 * failure, so `ingest_jobs` tells the same story either way. What differs is
 * only that a failure is not retried automatically — there is no queue to retry
 * from — so the stage is left failed and retryable from the UI, exactly as a
 * job that exhausted its attempts would be.
 */
export async function runPipelineInline(
  data: StageJobData,
  from: IngestStageName = "parse",
): Promise<{ completed: IngestStageName[]; failed: IngestStageName | null }> {
  const startIndex = PIPELINE.findIndex((entry) => entry.stage === from);
  if (startIndex < 0) throw new Error(`Unknown ingestion stage: ${from}`);

  const log = logger.child({
    correlationId: data.correlationId,
    materialId: data.materialId,
    mode: "inline",
  });

  const completed: IngestStageName[] = [];

  for (const entry of PIPELINE.slice(startIndex)) {
    log.info("stage started", { stage: entry.stage });
    await incrementAttempts(data.materialId, entry.stage);

    try {
      await entry.run(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("stage failed", { stage: entry.stage, error: message });
      await failStage(data.materialId, entry.stage, message);
      // Stop here rather than continuing: a later stage reading a half-written
      // predecessor's output would produce quietly wrong data, which is worse
      // than an obviously failed upload.
      return { completed, failed: entry.stage };
    }

    completed.push(entry.stage);
    log.info("stage finished", { stage: entry.stage });
  }

  return { completed, failed: null };
}

/** Re-runs a single stage inline, for the retry-one-stage path. */
export async function runStageInline(
  stage: IngestStageName,
  data: StageJobData,
): Promise<void> {
  const entry = stageEntry(stage);
  if (!entry) throw new Error(`Unknown ingestion stage: ${stage}`);

  await incrementAttempts(data.materialId, stage);
  try {
    await entry.run(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await failStage(data.materialId, stage, message);
    throw error;
  }
}
