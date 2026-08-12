import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";

/**
 * BullMQ wiring for the six ingestion stages (design.md §6.5, FR-INT-013).
 *
 * One queue per stage rather than one queue with a stage field: each stage then
 * has its own concurrency and retry policy, and a stuck `tag` stage cannot
 * block an unrelated material's `parse`.
 */

export const INGEST_STAGES = [
  "parse",
  "chunk",
  "tag",
  "embed",
  "index",
  "kg_link",
] as const;

export type IngestStageName = (typeof INGEST_STAGES)[number];

export interface StageJobData {
  materialId: string;
  courseId: string;
  /** Threaded through every stage so one upload traces end to end (NFR-OBS-003). */
  correlationId: string;
  /** The user whose action started the pipeline, for the audit trail. */
  actorId: string | null;
}

let connection: IORedis | null = null;

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connection it blocks on;
 * with the default, a blocking BRPOPLPUSH is torn down mid-wait.
 */
export function getRedis(): IORedis {
  connection ??= new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connection;
}

export function connectionOptions(): ConnectionOptions {
  return getRedis();
}

const queues = new Map<IngestStageName, Queue<StageJobData>>();

export function getQueue(stage: IngestStageName): Queue<StageJobData> {
  const existing = queues.get(stage);
  if (existing) return existing;

  const queue = new Queue<StageJobData>(`ingest:${stage}`, {
    connection: connectionOptions(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      // Keep a bounded history: the ingest_jobs table is the durable record of
      // what happened, so Redis does not need to be one too.
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  queues.set(stage, queue);
  return queue;
}

/**
 * Enqueues a stage. `jobId` is deterministic so a re-enqueue of the same
 * (material, stage) is deduplicated by BullMQ rather than running twice —
 * which matters because every stage is retryable from the UI (FR-INT-015).
 */
export async function enqueueStage(
  stage: IngestStageName,
  data: StageJobData,
  options: { force?: boolean } = {},
): Promise<void> {
  const queue = getQueue(stage);
  const jobId = `${data.materialId}:${stage}`;

  if (options.force) {
    // A manual retry must supersede the completed job holding that id.
    const existing = await queue.getJob(jobId);
    if (existing) await existing.remove().catch(() => undefined);
  }

  await queue.add(stage, data, { jobId });
}

export async function closeQueues(): Promise<void> {
  for (const queue of queues.values()) await queue.close();
  queues.clear();
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
