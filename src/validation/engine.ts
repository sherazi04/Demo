import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { ValidationBlockedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bloomCheck } from "./bloom";
import { cloAlignmentCheck } from "./clo-alignment";
import { distractorCheck } from "./distractors";
import { driftCheck } from "./drift";
import { groundednessCheck } from "./groundedness";
import { singleAnswerCheck } from "./single-answer";
import type {
  CandidateItem,
  CheckResult,
  ValidationContext,
  ValidationReport,
} from "./types";

export * from "./types";

/**
 * The validation engine (design.md §7, FR-VAL-001).
 *
 * Ordering is cheapest-first, and it is not cosmetic: `drift` is free set
 * membership and short-circuits, so an item referencing a topic outside the
 * curriculum never costs five judge calls. The remaining checks run in
 * increasing cost, with the two structural MCQ checks ahead of groundedness
 * because they are single-pass while groundedness reasons over every chunk.
 */

export interface ValidationOutcome {
  report: ValidationReport;
  /** The independently classified level, persisted on the item. */
  measuredBloom: number | null;
}

export async function validate(
  item: CandidateItem,
  context: ValidationContext,
): Promise<ValidationOutcome> {
  const checks: CheckResult[] = [];
  let measuredBloom: number | null = null;

  // 1. drift — free, and fatal.
  const drift = driftCheck(item, context);
  checks.push(drift);

  if (drift.fatal) {
    logger.info("validation short-circuited on drift", {
      correlationId: context.correlationId,
      topic: context.topicCode,
      clo: context.cloCode,
    });
    return { report: buildReport(checks, "short-circuited"), measuredBloom: null };
  }

  // 2. clo_alignment — one embedding pair plus one judge call.
  checks.push(await cloAlignmentCheck(item, context));

  // 3. bloom_match — one judge call, deliberately blind to the target.
  const bloom = await bloomCheck(item, context);
  measuredBloom = bloom.measuredBloom;
  checks.push({
    name: bloom.name,
    passed: bloom.passed,
    score: bloom.score,
    detail: bloom.detail,
  });

  // 4–5. MCQ structure. Skipped as not-applicable for SAQs by the checks
  // themselves, so the report always carries all six names.
  checks.push(await singleAnswerCheck(item, context));
  checks.push(await distractorCheck(item, context));

  // 6. groundedness — the most expensive, and last.
  checks.push(await groundednessCheck(item, context));

  const judgeModel = (await getConfig())["llm.judge.model"];
  return { report: buildReport(checks, judgeModel), measuredBloom };
}

function buildReport(checks: CheckResult[], judgeModel: string): ValidationReport {
  const failures = checks
    .filter((c) => !c.passed)
    .map((c) => `${c.name}: ${c.detail}`);

  return {
    passed: failures.length === 0,
    checks: checks.map((c) => ({
      name: c.name,
      passed: c.passed,
      score: c.score,
      detail: c.detail,
    })),
    failures,
    judgeModel,
  };
}

/**
 * Guards the approval transition (FR-VAL-010).
 *
 * This is the service-layer half of the enforcement. The other half is the
 * `questions_approved_requires_validation` check constraint in the migration,
 * so a direct SQL UPDATE cannot approve a failed item either. Both are
 * required: the constraint cannot produce a useful error message, and the
 * service layer alone can be bypassed.
 */
export async function assertApprovable(questionId: string): Promise<void> {
  const config = await getConfig();
  if (!config["validation.enforce"]) {
    logger.warn("validation enforcement is OFF — approving without a passing report", {
      questionId,
    });
    return;
  }

  const [row] = await db
    .select({ validation: questions.validation, status: questions.status })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);

  if (!row) throw new ValidationBlockedError("Question not found");

  if (!row.validation) {
    throw new ValidationBlockedError(
      "This item has no validation report, so it cannot be approved.",
    );
  }
  if (!row.validation.passed) {
    throw new ValidationBlockedError(
      `This item failed validation and cannot be approved: ${row.validation.failures.join("; ")}`,
      { failures: row.validation.failures },
    );
  }
}

/** Human-readable one-line summary for the item list. */
export function summariseReport(report: ValidationReport | null): string {
  if (!report) return "not validated";
  if (report.passed) return `passed all ${report.checks.length} checks`;
  return `failed ${report.failures.length} of ${report.checks.length}: ${report.checks
    .filter((c) => !c.passed)
    .map((c) => c.name)
    .join(", ")}`;
}
