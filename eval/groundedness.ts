import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { notAvailable, ratio, type EvalSection } from "./shared";

/**
 * Groundedness pass rate over approved items.
 *
 * Read from the persisted validation reports rather than re-judged: the report
 * on the item is the record the approval decision was actually made on, so
 * re-running would measure a different (later) judge, not the one that gated
 * the bank.
 */
export async function runGroundedness(): Promise<EvalSection> {
  const rows = await db
    .select({ id: questions.id, status: questions.status, validation: questions.validation })
    .from(questions)
    .where(isNotNull(questions.validation))
    .orderBy(desc(questions.createdAt))
    .limit(500);

  if (rows.length === 0) {
    return {
      script: "groundedness",
      metrics: [
        notAvailable(
          "Groundedness rate",
          "no validated items exist yet; generate an assessment first",
          "≥ 95 %",
        ),
      ],
      notes: [],
    };
  }

  let passed = 0;
  let total = 0;
  let approvedPassed = 0;
  let approvedTotal = 0;

  for (const row of rows) {
    const check = row.validation?.checks.find((c) => c.name === "groundedness");
    if (!check) continue;

    total += 1;
    if (check.passed) passed += 1;

    if (row.status === "approved") {
      approvedTotal += 1;
      if (check.passed) approvedPassed += 1;
    }
  }

  const [{ rejected } = { rejected: 0 }] = await db
    .select({ rejected: sql<number>`count(*)::int` })
    .from(questions)
    .where(eq(questions.status, "rejected"));

  return {
    script: "groundedness",
    metrics: [
      ratio("Groundedness rate (all validated items)", passed, total, "≥ 95 %"),
      ratio("Groundedness rate (approved items)", approvedPassed, approvedTotal, "≥ 95 %"),
    ],
    notes: [
      "Computed from the persisted validation report each approval decision was made on, " +
        "not re-judged — re-running would measure a later judge than the one that gated the bank.",
      rejected > 0
        ? "Rejected items are included in the all-items figure by design: excluding them would " +
          "report the pass rate of items that already passed."
        : "",
    ].filter(Boolean),
  };
}
