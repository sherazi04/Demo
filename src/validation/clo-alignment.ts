import { callStructured } from "@/intelligence/llm/router";
import {
  cloAlignmentJudgePrompt,
  cloAlignmentVerdictSchema,
} from "@/intelligence/llm/prompts/judge";
import { cosineSimilarity } from "@/intelligence/embeddings/types";
import { embedDocuments } from "@/intelligence/embeddings";
import { cloAssessesTopic } from "@/intelligence/kg/queries";
import { isReachable } from "@/intelligence/kg/driver";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { CandidateItem, CheckResult, ValidationContext } from "./types";

/**
 * `clo_alignment` — three independent signals combined (FR-VAL-003).
 *
 *   (a) embedding similarity between the item and the CLO statement — cheap,
 *       computed first, and enough on its own to reject the obviously unrelated
 *   (b) a knowledge-graph path check that the item's topic is ASSESSED_BY the
 *       CLO — structural, and cannot be talked around by fluent prose
 *   (c) a judge verdict with justification
 *
 * They are combined rather than gated because each fails differently: (a) is
 * fooled by shared vocabulary, (b) is coarse, and (c) is the only one that can
 * tell "about the topic" from "assesses the capability".
 */

const WEIGHTS = { similarity: 0.25, graph: 0.25, judge: 0.5 } as const;

export async function cloAlignmentCheck(
  item: CandidateItem,
  context: ValidationContext,
): Promise<CheckResult> {
  const config = await getConfig();
  const threshold = config["validation.cloAlignThreshold"];

  // (a) Cheap half first.
  const itemText = [item.stem, item.explanation].filter(Boolean).join("\n");
  let similarity = 0;
  try {
    const [itemVector, cloVector] = await embedDocuments([itemText, context.cloStatement]);
    if (itemVector && cloVector) {
      // Cosine on L2-normalised vectors lands in [-1, 1]; clamp the negative
      // half to zero — "less than unrelated" is not a meaningful signal here.
      similarity = Math.max(0, cosineSimilarity(itemVector, cloVector));
    }
  } catch (error: unknown) {
    logger.warn("clo alignment: embedding comparison unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // (b) Structural check. Absence of the graph is not evidence of misalignment,
  // so an unreachable Neo4j re-weights rather than fails.
  let graphLinked: boolean | null = null;
  if (await isReachable()) {
    try {
      graphLinked = await cloAssessesTopic(context.cloId, context.topicId);
    } catch (error: unknown) {
      logger.warn("clo alignment: graph check unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // (c) Judge verdict.
  const prompt = cloAlignmentJudgePrompt({
    cloCode: context.cloCode,
    cloStatement: context.cloStatement,
    cloBloomLevel: context.cloBloomLevel,
    topicTitle: context.topicTitle,
    stem: item.stem,
    options: item.options?.map((o) => ({ key: o.key, text: o.text })),
  });

  const verdict = await callStructured(cloAlignmentVerdictSchema, {
    tier: "judge",
    system: [{ text: prompt.system, cache: true }],
    user: prompt.user,
    auditAction: "validation.run",
    resourceType: "validation:clo_alignment",
    correlationId: context.correlationId,
    actorId: context.actorId ?? null,
  });

  if (verdict.refused || !verdict.data) {
    return {
      name: "clo_alignment",
      passed: false,
      score: 0,
      detail: "The alignment judge did not return a verdict, so alignment is unverified.",
    };
  }

  const judgeScore = verdict.data.assessesClo ? verdict.data.alignmentScore : 0;

  // With no graph available, redistribute its weight over the two signals that
  // did run rather than scoring a missing signal as zero.
  const graphScore = graphLinked === null ? null : graphLinked ? 1 : 0;
  const combined =
    graphScore === null
      ? (WEIGHTS.similarity * similarity + WEIGHTS.judge * judgeScore) /
        (WEIGHTS.similarity + WEIGHTS.judge)
      : WEIGHTS.similarity * similarity + WEIGHTS.graph * graphScore + WEIGHTS.judge * judgeScore;

  const passed = combined >= threshold;

  const parts = [
    `similarity ${similarity.toFixed(2)}`,
    graphScore === null
      ? "graph check unavailable"
      : graphLinked
        ? `${context.topicCode} is ASSESSED_BY ${context.cloCode}`
        : `${context.topicCode} is NOT linked to ${context.cloCode} in the curriculum graph`,
    `judge ${judgeScore.toFixed(2)}`,
  ];

  return {
    name: "clo_alignment",
    passed,
    score: Number(combined.toFixed(3)),
    detail: passed
      ? `Combined ${combined.toFixed(2)} ≥ ${threshold} (${parts.join(", ")}). ${verdict.data.justification}`
      : `Combined ${combined.toFixed(2)} < ${threshold} (${parts.join(", ")}). ${
          verdict.data.actuallyAssesses
            ? `The item appears to assess: ${verdict.data.actuallyAssesses}. `
            : ""
        }${verdict.data.justification}`,
  };
}
