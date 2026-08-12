import { describe, expect, it } from "vitest";
import { assertPlan } from "@/teacher/lecture-assertions";
import type { LecturePlan, LectureSegment } from "@/intelligence/llm/prompts/lecture";

function segment(overrides: Partial<LectureSegment> = {}): LectureSegment {
  return {
    title: "Segment",
    minutes: 15,
    bloomLevel: 2,
    cloCode: "CLO-4",
    activityType: "explain",
    content: "Content long enough to satisfy the schema minimum for a segment body.",
    instructorNotes: "Watch for students confusing the two cases.",
    citedChunkIds: ["c1"],
    ...overrides,
  };
}

function plan(segments: LectureSegment[]): LecturePlan {
  return {
    title: "Quicksort",
    framing: "This session builds on partitioning toward analysing quicksort's behaviour.",
    segments,
    anticipatedMisconceptions: [],
  };
}

const named = (plan: ReturnType<typeof assertPlan>, name: string) =>
  plan.find((a) => a.name === name);

describe("assertPlan — bloom_ascending", () => {
  it("passes a strictly ascending plan", () => {
    const result = assertPlan(
      plan([
        segment({ bloomLevel: 1, activityType: "recall" }),
        segment({ bloomLevel: 2 }),
        segment({ bloomLevel: 3, activityType: "assess" }),
      ]),
      45,
    );
    expect(named(result, "bloom_ascending")?.passed).toBe(true);
  });

  it("passes consecutive segments at the same level", () => {
    // Non-decreasing, not strictly increasing — explain then demo are both
    // legitimately the same level.
    const result = assertPlan(
      plan([
        segment({ bloomLevel: 2 }),
        segment({ bloomLevel: 2, activityType: "demo" }),
        segment({ bloomLevel: 3, activityType: "assess" }),
      ]),
      45,
    );
    expect(named(result, "bloom_ascending")?.passed).toBe(true);
  });

  it("fails when the level drops and names the offending segment", () => {
    const result = assertPlan(
      plan([
        segment({ bloomLevel: 1 }),
        segment({ bloomLevel: 4, title: "Analyse the bound" }),
        segment({ bloomLevel: 2, title: "Back to definitions", activityType: "assess" }),
      ]),
      45,
    );
    const assertion = named(result, "bloom_ascending");
    expect(assertion?.passed).toBe(false);
    expect(assertion?.detail).toContain("Back to definitions");
    expect(assertion?.detail).toContain("Segment 3");
  });

  it("passes a single-segment plan trivially", () => {
    const result = assertPlan(plan([segment({ activityType: "assess" })]), 15);
    expect(named(result, "bloom_ascending")?.passed).toBe(true);
  });
});

describe("assertPlan — has_formative_check", () => {
  it("fails when no segment is an assessment", () => {
    const result = assertPlan(
      plan([segment({ bloomLevel: 1 }), segment({ bloomLevel: 2 })]),
      30,
    );
    const assertion = named(result, "has_formative_check");
    expect(assertion?.passed).toBe(false);
    expect(assertion?.detail).toContain("assess");
  });

  it("passes and names the checks when present", () => {
    const result = assertPlan(
      plan([
        segment({ bloomLevel: 1 }),
        segment({ bloomLevel: 2, activityType: "assess", title: "Exit ticket" }),
      ]),
      30,
    );
    const assertion = named(result, "has_formative_check");
    expect(assertion?.passed).toBe(true);
    expect(assertion?.detail).toContain("Exit ticket");
  });
});

describe("assertPlan — duration_match", () => {
  it("passes when the segments sum close to the requested duration", () => {
    const result = assertPlan(
      plan([
        segment({ minutes: 30, activityType: "assess" }),
        segment({ minutes: 30, bloomLevel: 3 }),
      ]),
      60,
    );
    expect(named(result, "duration_match")?.passed).toBe(true);
  });

  it("tolerates small drift rather than failing a good plan over minutes", () => {
    const result = assertPlan(
      plan([segment({ minutes: 55, activityType: "assess" })]),
      60,
    );
    expect(named(result, "duration_match")?.passed).toBe(true);
  });

  it("fails on a substantial mismatch", () => {
    const result = assertPlan(
      plan([segment({ minutes: 10, activityType: "assess" })]),
      90,
    );
    const assertion = named(result, "duration_match");
    expect(assertion?.passed).toBe(false);
    expect(assertion?.detail).toContain("10 minutes");
  });
});

describe("assertPlan — citations_present", () => {
  it("fails when a segment cites nothing and names it", () => {
    const result = assertPlan(
      plan([
        segment({ activityType: "assess" }),
        segment({ bloomLevel: 3, title: "Uncited part", citedChunkIds: [] }),
      ]),
      30,
    );
    const assertion = named(result, "citations_present");
    expect(assertion?.passed).toBe(false);
    expect(assertion?.detail).toContain("Uncited part");
  });

  it("passes when every segment cites at least one chunk", () => {
    const result = assertPlan(plan([segment({ activityType: "assess" })]), 15);
    expect(named(result, "citations_present")?.passed).toBe(true);
  });
});

describe("assertPlan", () => {
  it("always returns all four assertions regardless of outcome", () => {
    const result = assertPlan(plan([segment()]), 15);
    expect(result.map((a) => a.name).sort()).toEqual([
      "bloom_ascending",
      "citations_present",
      "duration_match",
      "has_formative_check",
    ]);
  });
});
