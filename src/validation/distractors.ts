import { callStructured } from "@/intelligence/llm/router";
import { distractorJudgePrompt, distractorVerdictSchema } from "@/intelligence/llm/prompts/judge";
import { getConfig } from "@/lib/config";
import type { CandidateItem, CheckResult, ValidationContext } from "./types";

/**
 * `distractor_quality` — plausible, non-giveaway, misconception-mapped
 * (FR-VAL-006).
 *
 * A distractor anchored to a documented misconception is what turns a wrong
 * answer into a diagnosis, which is what the adaptive feedback engine needs
 * downstream. A merely plausible distractor still passes; an implausible one or
 * an obvious giveaway does not.
 */
export async function distractorCheck(
  item: CandidateItem,
  context: ValidationContext,
): Promise<CheckResult> {
  if (item.type !== "mcq" || !item.options || item.options.length === 0) {
    return {
      name: "distractor_quality",
      passed: true,
      score: 1,
      detail: "Not applicable — this check applies to multiple-choice items only.",
    };
  }

  const config = await getConfig();
  const threshold = config["validation.distractorThreshold"];

  const validCodes = new Set(context.misconceptions.map((m) => m.code));
  const invented = item.options
    .filter((o) => !o.correct && o.misconceptionCode)
    .filter((o) => !validCodes.has(o.misconceptionCode ?? ""))
    .map((o) => `${o.key} → ${o.misconceptionCode}`);

  const prompt = distractorJudgePrompt({
    stem: item.stem,
    options: item.options.map((o) => ({
      key: o.key,
      text: o.text,
      correct: o.correct,
      misconceptionCode: o.misconceptionCode ?? null,
    })),
    misconceptions: context.misconceptions,
  });

  const verdict = await callStructured(distractorVerdictSchema, {
    tier: "judge",
    system: [{ text: prompt.system, cache: true }],
    user: prompt.user,
    auditAction: "validation.run",
    resourceType: "validation:distractor_quality",
    correlationId: context.correlationId,
    actorId: context.actorId ?? null,
  });

  if (verdict.refused || !verdict.data) {
    return {
      name: "distractor_quality",
      passed: false,
      score: 0,
      detail: "The distractor judge did not return a verdict.",
    };
  }

  const rated = verdict.data.distractors;
  const implausible = rated.filter((d) => !d.plausible);
  const giveaways = rated.filter((d) => d.giveaway);
  const mean = rated.length > 0 ? verdict.data.meanQuality : 0;

  const problems: string[] = [];
  if (implausible.length > 0) {
    problems.push(
      `implausible distractor(s): ${implausible.map((d) => d.key).join(", ")}`,
    );
  }
  if (giveaways.length > 0) {
    problems.push(
      `giveaway cue(s): ${giveaways
        .map((d) => `${d.key} (${d.giveawayReason ?? "eliminable without understanding"})`)
        .join("; ")}`,
    );
  }
  // A misconception code the curriculum does not define is a provenance
  // failure: the feedback engine would look it up and find nothing.
  if (invented.length > 0) {
    problems.push(`misconception code(s) not in this topic's set: ${invented.join(", ")}`);
  }

  const passed = problems.length === 0 && mean >= threshold;

  return {
    name: "distractor_quality",
    passed,
    score: Number(mean.toFixed(3)),
    detail: passed
      ? `All ${rated.length} distractor(s) are plausible and free of giveaway cues (mean quality ${mean.toFixed(2)}). ${
          rated.filter((d) => d.mapsToMisconception).length
        } map to a named misconception.`
      : `${problems.join("; ")}${mean < threshold ? `; mean quality ${mean.toFixed(2)} < ${threshold}` : ""}`,
  };
}
