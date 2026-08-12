import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { goldPath, notAvailable, ratio, readJsonl, type EvalSection } from "./shared";

/**
 * CLO alignment precision — validator verdict versus expert rating.
 *
 * This measures the VALIDATOR, not the generator: given items an expert has
 * judged, how often does `clo_alignment` agree? A high agreement is what
 * licenses trusting the validator's verdict on items no expert has seen.
 */

interface ExpertRating {
  /** The question id in this database, when the item was generated here. */
  questionId?: string;
  /** Or a stem to match on, for expert-authored reference items. */
  stem?: string;
  cloCode: string;
  /** The expert's judgement: does this item genuinely assess the CLO? */
  assessesClo: boolean;
}

export async function runCloPrecision(): Promise<EvalSection> {
  const notes: string[] = [];
  const gold = await readJsonl<ExpertRating>(goldPath("expert-questions.jsonl"));

  if (gold.length === 0) {
    return {
      script: "clo-precision",
      metrics: [
        notAvailable(
          "CLO alignment precision",
          `${goldPath("expert-questions.jsonl")} is absent or empty; requirements.md §4.3 asks for ≥50 expert-rated items`,
          "≥ 85 %",
        ),
      ],
      notes: ["Author the expert rating set to make this metric reportable."],
    };
  }

  if (gold.length < 50) {
    notes.push(
      `Expert set has ${gold.length} items; requirements.md §4.3 specifies at least 50.`,
    );
  }

  const rated = gold.filter((row) => row.questionId);
  if (rated.length === 0) {
    return {
      script: "clo-precision",
      metrics: [
        notAvailable(
          "CLO alignment precision",
          "no gold row carries a questionId that exists in this database; generate items first, then rate them",
          "≥ 85 %",
        ),
      ],
      notes,
    };
  }

  // Confusion counts between the validator's verdict and the expert's.
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  let compared = 0;

  for (const row of rated) {
    if (!row.questionId) continue;

    const [item] = await db
      .select({ validation: questions.validation })
      .from(questions)
      .where(and(eq(questions.id, row.questionId), isNotNull(questions.validation)))
      .limit(1);
    if (!item?.validation) continue;

    const check = item.validation.checks.find((c) => c.name === "clo_alignment");
    if (!check) continue;

    compared += 1;
    if (check.passed && row.assessesClo) truePositive += 1;
    else if (check.passed && !row.assessesClo) falsePositive += 1;
    else if (!check.passed && row.assessesClo) falseNegative += 1;
    else trueNegative += 1;
  }

  if (compared === 0) {
    return {
      script: "clo-precision",
      metrics: [
        notAvailable(
          "CLO alignment precision",
          "no rated item has a persisted clo_alignment result to compare against",
          "≥ 85 %",
        ),
      ],
      notes,
    };
  }

  const agreement = truePositive + trueNegative;

  return {
    script: "clo-precision",
    metrics: [
      ratio("CLO alignment precision", truePositive, truePositive + falsePositive, "≥ 85 %", {
        interpretation:
          "of the items the validator passed, the share the expert also judged aligned",
      }),
      ratio("CLO alignment recall", truePositive, truePositive + falseNegative, undefined, {
        interpretation:
          "of the items the expert judged aligned, the share the validator also passed",
      }),
      ratio("Validator–expert agreement", agreement, compared, undefined, {
        truePositive,
        falsePositive,
        falseNegative,
        trueNegative,
      }),
    ],
    notes,
  };
}
