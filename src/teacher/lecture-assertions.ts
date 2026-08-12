import type { LecturePlan } from "@/intelligence/llm/prompts/lecture";

/**
 * Structural assertions on a generated lecture plan (FR-TCH-010, FR-TCH-013).
 *
 * Kept free of any database or LLM import so the rules are unit-testable on
 * their own — these encode the two promises the co-pilot makes about every
 * plan, and a promise that is not tested is a claim.
 */

export interface PlanAssertion {
  name: "bloom_ascending" | "has_formative_check" | "duration_match" | "citations_present";
  passed: boolean;
  detail: string;
}

/** The assertions worth one regeneration; the others are reported only. */
export const BLOCKING_ASSERTIONS: PlanAssertion["name"][] = [
  "bloom_ascending",
  "has_formative_check",
];

export function assertPlan(plan: LecturePlan, durationMinutes: number): PlanAssertion[] {
  const assertions: PlanAssertion[] = [];

  // Non-decreasing, not strictly increasing: consecutive segments at the same
  // level are normal — explain then demo are both legitimately the same level.
  const levels = plan.segments.map((s) => s.bloomLevel);
  let firstDrop = -1;
  for (let i = 1; i < levels.length; i += 1) {
    const previous = levels[i - 1] ?? 0;
    const current = levels[i] ?? 0;
    if (current < previous) {
      firstDrop = i;
      break;
    }
  }
  assertions.push({
    name: "bloom_ascending",
    passed: firstDrop === -1,
    detail:
      firstDrop === -1
        ? `Bloom levels are non-decreasing across all ${levels.length} segments (${levels.join(" → ")}).`
        : `Segment ${firstDrop + 1} ("${plan.segments[firstDrop]?.title}") drops from Bloom ${levels[firstDrop - 1]} to ${levels[firstDrop]}. The sequence must not descend.`,
  });

  const assessSegments = plan.segments.filter((s) => s.activityType === "assess");
  assertions.push({
    name: "has_formative_check",
    passed: assessSegments.length > 0,
    detail:
      assessSegments.length > 0
        ? `${assessSegments.length} formative check(s): ${assessSegments.map((s) => s.title).join(", ")}.`
        : 'No segment has activityType "assess". Every session needs at least one formative check for understanding.',
  });

  const totalMinutes = plan.segments.reduce((sum, s) => sum + s.minutes, 0);
  const drift = Math.abs(totalMinutes - durationMinutes);
  assertions.push({
    name: "duration_match",
    // A 15% tolerance: minute-exact planning is not how teaching works, and
    // failing a good plan over three minutes would be noise.
    passed: drift <= Math.max(5, durationMinutes * 0.15),
    detail: `Segments total ${totalMinutes} minutes against a ${durationMinutes}-minute session.`,
  });

  const uncited = plan.segments.filter((s) => s.citedChunkIds.length === 0);
  assertions.push({
    name: "citations_present",
    passed: uncited.length === 0,
    detail:
      uncited.length === 0
        ? "Every segment cites at least one source chunk."
        : `${uncited.length} segment(s) cite no source: ${uncited.map((s) => s.title).join(", ")}.`,
  });

  return assertions;
}
