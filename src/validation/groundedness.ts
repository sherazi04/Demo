import { callStructured } from "@/intelligence/llm/router";
import {
  groundednessJudgePrompt,
  groundednessVerdictSchema,
} from "@/intelligence/llm/prompts/judge";
import { getConfig } from "@/lib/config";
import type { CandidateItem, CheckResult, ValidationContext } from "./types";

/**
 * `groundedness` — every factual claim maps to a source chunk (FR-VAL-004).
 *
 * The judge receives the item and ONLY the source chunks: no course context, no
 * curriculum, no licence to use general knowledge. That restriction is what
 * makes the check meaningful — a judge that knows data structures would happily
 * confirm a true-but-unsourced claim, and the point is provenance, not truth.
 */
export async function groundednessCheck(
  item: CandidateItem,
  context: ValidationContext,
): Promise<CheckResult> {
  const config = await getConfig();
  const threshold = config["validation.groundednessThreshold"];

  // Only the chunks the item actually cites are shown, falling back to the full
  // provided context. An item cannot be grounded in material it never claimed.
  const cited = context.sourceChunks.filter((c) => item.citedChunkIds.includes(c.id));
  const chunks = cited.length > 0 ? cited : context.sourceChunks;

  if (chunks.length === 0) {
    return {
      name: "groundedness",
      passed: false,
      score: 0,
      detail: "No source chunks were available to ground this item against.",
    };
  }

  const prompt = groundednessJudgePrompt({
    stem: item.stem,
    options: item.options?.map((o) => ({
      key: o.key,
      text: o.text,
      rationale: o.rationale,
    })),
    explanation: item.explanation,
    chunks: chunks.map((c) => ({ id: c.id, text: c.text })),
  });

  const verdict = await callStructured(groundednessVerdictSchema, {
    tier: "judge",
    system: [{ text: prompt.system, cache: true }],
    user: prompt.user,
    auditAction: "validation.run",
    resourceType: "validation:groundedness",
    retrievedChunkIds: chunks.map((c) => c.id),
    correlationId: context.correlationId,
    actorId: context.actorId ?? null,
  });

  if (verdict.refused || !verdict.data) {
    return {
      name: "groundedness",
      passed: false,
      score: 0,
      detail: "The groundedness judge did not return a verdict, so grounding is unverified.",
    };
  }

  const claims = verdict.data.claims;
  const total = claims.length;
  const supported = claims.filter((c) => c.supported).length;
  const unsupported = claims.filter((c) => !c.supported);

  // A judge that found no claims has not verified anything; treat that as a
  // failure rather than a vacuous pass.
  if (total === 0) {
    return {
      name: "groundedness",
      passed: false,
      score: 0,
      detail: "The judge identified no checkable claims in this item.",
    };
  }

  const score = supported / total;
  const passed = unsupported.length === 0 && score >= threshold;

  return {
    name: "groundedness",
    passed,
    score: Number(score.toFixed(3)),
    detail: passed
      ? `All ${total} claim(s) trace to a source chunk.`
      : `${unsupported.length} of ${total} claim(s) are unsupported by the cited sources: ${unsupported
          .slice(0, 3)
          .map((c) => `"${c.claim.slice(0, 120)}"`)
          .join("; ")}`,
  };
}
