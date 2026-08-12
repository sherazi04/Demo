import { callStructured } from "@/intelligence/llm/router";
import { bloomJudgePrompt, bloomVerdictSchema } from "@/intelligence/llm/prompts/judge";
import { bloomLabel } from "@/lib/utils";
import type { CandidateItem, CheckResult, ValidationContext } from "./types";

/**
 * `bloom_match` — independent cognitive-level classification (FR-VAL-002).
 *
 * The classifier is a judge-tier call that is NOT TOLD the requested level. The
 * comparison against `targetBloom` happens here, in code, after the verdict
 * comes back — so the model cannot rationalise toward the answer it knows is
 * wanted. That independence is the entire value of the check.
 */
export async function bloomCheck(
  item: CandidateItem,
  context: ValidationContext,
): Promise<CheckResult & { measuredBloom: number | null }> {
  const prompt = bloomJudgePrompt({
    stem: item.stem,
    options: item.options?.map((o) => ({ key: o.key, text: o.text })),
    referenceAnswer: item.referenceAnswer ?? null,
  });

  const result = await callStructured(bloomVerdictSchema, {
    tier: "judge",
    system: [{ text: prompt.system, cache: true }],
    user: prompt.user,
    auditAction: "validation.run",
    resourceType: "validation:bloom_match",
    correlationId: context.correlationId,
    actorId: context.actorId ?? null,
  });

  if (result.refused || !result.data) {
    // A refusal cannot be read as a pass. An unmeasurable item fails, which
    // routes it to the teacher rather than silently approving it.
    return {
      name: "bloom_match",
      passed: false,
      score: 0,
      detail: "The Bloom classifier did not return a verdict, so the level is unverified.",
      measuredBloom: null,
    };
  }

  const measured = result.data.measuredBloom;
  const passed = measured === context.targetBloom;

  /*
   * Partial credit by distance is deliberately NOT used for the pass/fail
   * decision — an item one level off is still the wrong item for the
   * blueprint. The graded score is reported so the teacher can see whether a
   * failure was a near miss or a category error.
   */
  const distance = Math.abs(measured - context.targetBloom);
  const score = passed ? 1 : Math.max(0, 1 - distance * 0.34);

  return {
    name: "bloom_match",
    passed,
    score,
    detail: passed
      ? `Measured Bloom ${measured} (${bloomLabel(measured)}), matching the requested level. ${result.data.cognitiveDemand}`
      : `Measured Bloom ${measured} (${bloomLabel(measured)}) but the blueprint requested ${context.targetBloom} (${bloomLabel(context.targetBloom)}). ${result.data.justification}`,
    measuredBloom: measured,
  };
}
