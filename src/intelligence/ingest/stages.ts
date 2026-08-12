import {
  runChunk,
  runEmbed,
  runIndex,
  runKgLink,
  runParse,
  runTag,
} from "./pipeline";
import type { IngestStageName, StageJobData } from "@/worker/queues";

/**
 * The six ordered ingestion stages (design.md §6.5, FR-INT-013).
 *
 * Defined here rather than in the worker so the queued runner and the inline
 * runner cannot drift apart — the ordering and the chaining rule are the
 * pipeline's contract, and two copies of it would eventually disagree.
 */
export type StageHandler = (data: StageJobData) => Promise<void>;

export const PIPELINE: ReadonlyArray<{
  stage: IngestStageName;
  run: StageHandler;
  next: IngestStageName | null;
}> = [
  { stage: "parse", run: runParse, next: "chunk" },
  { stage: "chunk", run: runChunk, next: "tag" },
  { stage: "tag", run: runTag, next: "embed" },
  { stage: "embed", run: runEmbed, next: "index" },
  { stage: "index", run: runIndex, next: "kg_link" },
  { stage: "kg_link", run: runKgLink, next: null },
];

export function stageEntry(stage: IngestStageName) {
  return PIPELINE.find((entry) => entry.stage === stage);
}
