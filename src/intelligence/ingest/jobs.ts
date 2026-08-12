import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ingestJobs, materials } from "@/db/schema";
import type { IngestStageName } from "@/worker/queues";

/**
 * Per-stage progress records (FR-INT-014, FR-INT-015).
 *
 * The teacher panel polls these rows, so they are the contract behind the
 * progress UI: status, items done / items total, and an error message on
 * failure. Written by the worker, read by the panel.
 */

export const STAGE_ORDER: IngestStageName[] = [
  "parse",
  "chunk",
  "tag",
  "embed",
  "index",
  "kg_link",
];

/** Maps a stage to the material-level status shown while it runs. */
const STAGE_MATERIAL_STATUS = {
  parse: "parsing",
  chunk: "chunking",
  tag: "tagging",
  embed: "embedding",
  index: "embedding",
  kg_link: "embedding",
} as const;

export async function ensureJobRows(materialId: string): Promise<void> {
  await db
    .insert(ingestJobs)
    .values(STAGE_ORDER.map((stage) => ({ materialId, stage, status: "queued" as const })))
    .onConflictDoNothing();
}

export async function startStage(
  materialId: string,
  stage: IngestStageName,
  itemsTotal = 0,
): Promise<void> {
  await db
    .update(ingestJobs)
    .set({
      status: "running",
      itemsTotal,
      itemsDone: 0,
      message: null,
      startedAt: new Date(),
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(ingestJobs.materialId, materialId), eq(ingestJobs.stage, stage)));

  await db
    .update(materials)
    .set({ status: STAGE_MATERIAL_STATUS[stage], error: null })
    .where(eq(materials.id, materialId));
}

/**
 * Progress ticks are deliberately coarse — the UI polls, so writing a row per
 * item would cost far more than it shows.
 */
export async function reportProgress(
  materialId: string,
  stage: IngestStageName,
  itemsDone: number,
  itemsTotal?: number,
): Promise<void> {
  await db
    .update(ingestJobs)
    .set({
      itemsDone,
      ...(itemsTotal === undefined ? {} : { itemsTotal }),
      updatedAt: new Date(),
    })
    .where(and(eq(ingestJobs.materialId, materialId), eq(ingestJobs.stage, stage)));

  // Material-level progress is the fraction of stages complete plus this
  // stage's own fraction, so the bar advances smoothly across all six.
  if (itemsTotal && itemsTotal > 0) {
    const stageIndex = STAGE_ORDER.indexOf(stage);
    const withinStage = Math.min(itemsDone / itemsTotal, 1);
    const overall = (stageIndex + withinStage) / STAGE_ORDER.length;
    await db
      .update(materials)
      .set({ progress: Number(overall.toFixed(4)) })
      .where(eq(materials.id, materialId));
  }
}

export async function finishStage(
  materialId: string,
  stage: IngestStageName,
  itemsDone: number,
): Promise<void> {
  await db
    .update(ingestJobs)
    .set({
      status: "done",
      itemsDone,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(ingestJobs.materialId, materialId), eq(ingestJobs.stage, stage)));

  const stageIndex = STAGE_ORDER.indexOf(stage);
  const progress = (stageIndex + 1) / STAGE_ORDER.length;
  await db
    .update(materials)
    .set({ progress: Number(progress.toFixed(4)) })
    .where(eq(materials.id, materialId));
}

export async function failStage(
  materialId: string,
  stage: IngestStageName,
  message: string,
): Promise<void> {
  await db
    .update(ingestJobs)
    .set({
      status: "failed",
      message: message.slice(0, 2000),
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(ingestJobs.materialId, materialId), eq(ingestJobs.stage, stage)));

  // The material carries the failure too, so the list view shows it without
  // joining every job row.
  await db
    .update(materials)
    .set({ status: "failed", error: `${stage}: ${message}`.slice(0, 2000) })
    .where(eq(materials.id, materialId));
}

export async function incrementAttempts(
  materialId: string,
  stage: IngestStageName,
): Promise<void> {
  const [row] = await db
    .select({ attempts: ingestJobs.attempts })
    .from(ingestJobs)
    .where(and(eq(ingestJobs.materialId, materialId), eq(ingestJobs.stage, stage)))
    .limit(1);

  await db
    .update(ingestJobs)
    .set({ attempts: (row?.attempts ?? 0) + 1, updatedAt: new Date() })
    .where(and(eq(ingestJobs.materialId, materialId), eq(ingestJobs.stage, stage)));
}

export async function markIndexed(materialId: string, chunkCount: number): Promise<void> {
  await db
    .update(materials)
    .set({
      status: "indexed",
      progress: 1,
      chunkCount,
      indexedAt: new Date(),
      error: null,
    })
    .where(eq(materials.id, materialId));
}

export async function getJobs(materialId: string) {
  const rows = await db
    .select()
    .from(ingestJobs)
    .where(eq(ingestJobs.materialId, materialId));

  // Ordered by pipeline order, not insertion order, so the UI renders the six
  // stages in the sequence they actually run.
  return STAGE_ORDER.map((stage) => rows.find((r) => r.stage === stage)).filter(
    (row): row is (typeof rows)[number] => row !== undefined,
  );
}
