import { callStructured } from "@/intelligence/llm/router";
import { assemblePrompt, type CourseContext } from "@/intelligence/llm/prompts/shared";
import {
  taggerResponseSchema,
  taggerTaskBlock,
  taggerUserBlock,
  type TaggerItem,
} from "@/intelligence/llm/prompts/tagger";
import { logger } from "@/lib/logger";

/**
 * Stage 3 — LOM tagging (design.md §6.5, FR-INT-020..022).
 *
 * Batched to amortise the cached course-context prefix across ~10 chunks per
 * call, at the bulk tier.
 */

export interface TagInput {
  chunkId: string;
  text: string;
}

export interface TagOutcome {
  chunkId: string;
  topicCode: string | null;
  bloomLevel: number | null;
  difficulty: number | null;
  lomFormat: string | null;
  resourceType: string | null;
  cloCodes: string[];
  keywords: string[];
  /** Zero when the tagger drifted — see below. */
  confidence: number;
  reasoning: string;
  /** Populated when the response referenced something outside the curriculum. */
  driftReasons: string[];
}

export const TAG_BATCH_SIZE = 10;

/**
 * Tags one batch.
 *
 * A response naming a topic or CLO that is not in the curriculum is a DRIFT
 * FAILURE, not a near-miss: `confidence` is forced to 0 so the chunk sorts to
 * the top of the human review queue, and the offending code is recorded in
 * `driftReasons`. It is never silently accepted, and never silently mapped to
 * the nearest valid code — a plausible wrong tag is worse than an obvious
 * missing one, because every downstream filter would then trust it.
 */
export async function tagBatch(
  chunks: readonly TagInput[],
  context: CourseContext,
  options: { correlationId?: string; actorId?: string | null } = {},
): Promise<TagOutcome[]> {
  if (chunks.length === 0) return [];

  const validTopics = new Set(context.topics.map((t) => t.code));
  const validClos = new Set(context.clos.map((c) => c.code));

  const { system } = assemblePrompt(context, taggerTaskBlock());

  const result = await callStructured(taggerResponseSchema, {
    tier: "bulk",
    system,
    user: taggerUserBlock(chunks.map((c) => ({ text: c.text }))),
    auditAction: "chunk.tag",
    resourceType: "chunk_batch",
    correlationId: options.correlationId,
    actorId: options.actorId ?? null,
  });

  if (result.refused || !result.data) {
    // A refusal is an outcome: every chunk in the batch goes to review with
    // zero confidence rather than being dropped or retried indefinitely.
    logger.warn("tagger refused or returned nothing", {
      correlationId: options.correlationId,
      refused: result.refused,
      batchSize: chunks.length,
    });
    return chunks.map((chunk) => unreviewable(chunk, "tagger returned no usable output"));
  }

  const byIndex = new Map<number, TaggerItem>();
  for (const item of result.data.items) byIndex.set(item.index, item);

  return chunks.map((chunk, index) => {
    const item = byIndex.get(index);
    if (!item) {
      return unreviewable(chunk, "tagger omitted this chunk from its response");
    }

    const driftReasons: string[] = [];

    const topicOk = validTopics.has(item.topicCode);
    if (!topicOk) {
      driftReasons.push(`topic "${item.topicCode}" is not in the curriculum`);
    }

    const knownClos = item.cloCodes.filter((code) => validClos.has(code));
    const unknownClos = item.cloCodes.filter((code) => !validClos.has(code));
    if (unknownClos.length > 0) {
      driftReasons.push(`CLO code(s) not in the curriculum: ${unknownClos.join(", ")}`);
    }

    const drifted = driftReasons.length > 0;

    return {
      chunkId: chunk.chunkId,
      // A drifted topic is discarded rather than stored: writing an invented
      // topic id is impossible anyway, and storing null makes the gap visible.
      topicCode: topicOk ? item.topicCode : null,
      bloomLevel: item.bloomLevel,
      difficulty: item.difficulty,
      lomFormat: item.lomFormat,
      resourceType: item.resourceType,
      cloCodes: knownClos,
      keywords: item.keywords,
      confidence: drifted ? 0 : item.confidence,
      reasoning: item.reasoning,
      driftReasons,
    };
  });
}

function unreviewable(chunk: TagInput, reason: string): TagOutcome {
  return {
    chunkId: chunk.chunkId,
    topicCode: null,
    bloomLevel: null,
    difficulty: null,
    lomFormat: null,
    resourceType: null,
    cloCodes: [],
    keywords: [],
    confidence: 0,
    reasoning: "",
    driftReasons: [reason],
  };
}
