import { callStructured } from "@/intelligence/llm/router";
import {
  singleAnswerJudgePrompt,
  singleAnswerVerdictSchema,
} from "@/intelligence/llm/prompts/judge";
import type { CandidateItem, CheckResult, ValidationContext } from "./types";

/**
 * `single_answer` — exactly one defensibly correct option (FR-VAL-005).
 *
 * Each option is judged independently rather than asked "which is right?",
 * because the failure this catches is an item with two defensible answers — and
 * a model asked to pick one will pick one regardless.
 */
export async function singleAnswerCheck(
  item: CandidateItem,
  context: ValidationContext,
): Promise<CheckResult> {
  if (item.type !== "mcq" || !item.options || item.options.length === 0) {
    // Not applicable to short-answer items; passing with a clear note is
    // honest, and the report shows why it did not run.
    return {
      name: "single_answer",
      passed: true,
      score: 1,
      detail: "Not applicable — this check applies to multiple-choice items only.",
    };
  }

  // Structural check first: it is free and catches a generator that marked two
  // keys correct without any judge call.
  const markedCorrect = item.options.filter((o) => o.correct);
  if (markedCorrect.length !== 1) {
    return {
      name: "single_answer",
      passed: false,
      score: 0,
      detail: `The item marks ${markedCorrect.length} option(s) as correct; exactly one is required.`,
    };
  }

  const prompt = singleAnswerJudgePrompt({
    stem: item.stem,
    options: item.options.map((o) => ({ key: o.key, text: o.text })),
  });

  const verdict = await callStructured(singleAnswerVerdictSchema, {
    tier: "judge",
    system: [{ text: prompt.system, cache: true }],
    user: prompt.user,
    auditAction: "validation.run",
    resourceType: "validation:single_answer",
    correlationId: context.correlationId,
    actorId: context.actorId ?? null,
  });

  if (verdict.refused || !verdict.data) {
    return {
      name: "single_answer",
      passed: false,
      score: 0,
      detail: "The single-answer judge did not return a verdict.",
    };
  }

  const defensible = verdict.data.evaluations.filter((e) => e.defensiblyCorrect);
  const keyed = markedCorrect[0]?.key;

  if (defensible.length === 1) {
    const only = defensible[0];
    // One defensible option, but not the one the generator keyed — the item is
    // answerable yet mis-keyed, which is the more dangerous of the two failures
    // because it marks correct students wrong.
    if (only && only.key !== keyed) {
      return {
        name: "single_answer",
        passed: false,
        score: 0,
        detail: `The only defensible option is ${only.key}, but the item keys ${keyed} as correct. ${only.reasoning}`,
      };
    }
    return {
      name: "single_answer",
      passed: true,
      score: 1,
      detail: `Exactly one option (${keyed}) is defensibly correct.`,
    };
  }

  return {
    name: "single_answer",
    passed: false,
    score: 0,
    detail:
      defensible.length === 0
        ? "No option is defensibly correct as the stem is written."
        : `${defensible.length} options are defensibly correct (${defensible
            .map((d) => d.key)
            .join(", ")}), so the item is ambiguous.`,
  };
}
