import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { failStage, incrementAttempts } from "@/intelligence/ingest/jobs";
import { PIPELINE } from "@/intelligence/ingest/stages";
import { closeQueues, connectionOptions, enqueueStage, type StageJobData } from "./queues";

/**
 * Ingestion worker — a separate process from the web app (design.md §1.1).
 *
 * Run with `npm run worker` alongside `npm run dev`. Keeping it out of the
 * Next.js process matters: a 600-page PDF's embed stage would otherwise block
 * the event loop serving the panels.
 */

const workers: Worker<StageJobData>[] = [];

function startWorker(entry: (typeof PIPELINE)[number]): Worker<StageJobData> {
  return new Worker<StageJobData>(
    `ingest:${entry.stage}`,
    async (job: Job<StageJobData>) => {
      const { materialId, correlationId } = job.data;
      const log = logger.child({ correlationId, materialId, stage: entry.stage });

      log.info("stage started", { attempt: job.attemptsMade + 1 });
      await incrementAttempts(materialId, entry.stage);

      await entry.run(job.data);

      // Chained here rather than in the processor so a stage cannot advance
      // the pipeline while reporting failure.
      if (entry.next) {
        await enqueueStage(entry.next, job.data);
      }
      log.info("stage finished");
    },
    {
      connection: connectionOptions(),
      // Embedding and tagging are network-bound; the default of 1 would make a
      // large upload needlessly serial, but too much concurrency just trades
      // one rate limit for another.
      concurrency: env.INGEST_CONCURRENCY,
    },
  );
}

for (const entry of PIPELINE) {
  const worker = startWorker(entry);

  worker.on("failed", (job, error) => {
    const data = job?.data;
    if (!data) return;

    const attemptsLeft = (job?.opts.attempts ?? 1) - (job?.attemptsMade ?? 0);
    logger.error("stage failed", {
      correlationId: data.correlationId,
      materialId: data.materialId,
      stage: entry.stage,
      attemptsLeft,
      error: error.message,
    });

    // Only record terminal failure once BullMQ has exhausted its retries —
    // marking the material failed on a transient error would flap the UI.
    if (attemptsLeft <= 0) {
      void failStage(data.materialId, entry.stage, error.message);
    }
  });

  worker.on("error", (error) => {
    logger.error("worker error", { stage: entry.stage, error: error.message });
  });

  workers.push(worker);
}

logger.info("ingestion worker ready", {
  stages: PIPELINE.map((p) => p.stage),
  concurrency: env.INGEST_CONCURRENCY,
});

async function shutdown(signal: string): Promise<void> {
  logger.info("worker shutting down", { signal });
  // Close lets in-flight jobs finish; killing mid-embed would leave a stage
  // half-written, and the retry would then re-embed rows unnecessarily.
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
