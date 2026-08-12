import { describe, expect, it } from "vitest";
import { buildPlanSteps, type PlanInputTopic } from "@/student/learning-plan";
import { pointsFor } from "@/student/gamification";

const THRESHOLD = 0.7;

function topic(overrides: Partial<PlanInputTopic> & { id: string }): PlanInputTopic {
  return {
    code: overrides.id.toUpperCase(),
    title: `Topic ${overrides.id}`,
    ordinal: 1,
    week: 1,
    pKnown: 0,
    prereqIds: [],
    cloCode: null,
    cloId: null,
    bloomLevel: null,
    ...overrides,
  };
}

/** Position of a topic id among the topic steps only. */
function topicOrder(steps: ReturnType<typeof buildPlanSteps>): string[] {
  return steps.filter((s) => s.kind === "topic").map((s) => s.topicId ?? "");
}

describe("buildPlanSteps", () => {
  it("returns nothing when every topic is mastered", () => {
    const steps = buildPlanSteps(
      [topic({ id: "a", pKnown: 0.9 }), topic({ id: "b", pKnown: 0.8 })],
      [],
      THRESHOLD,
    );
    expect(topicOrder(steps)).toEqual([]);
  });

  it("includes only unmastered topics", () => {
    const steps = buildPlanSteps(
      [topic({ id: "done", pKnown: 0.95 }), topic({ id: "todo", pKnown: 0.2, ordinal: 2 })],
      [],
      THRESHOLD,
    );
    expect(topicOrder(steps)).toEqual(["todo"]);
  });

  it("orders eligible topics by course ordinal", () => {
    const steps = buildPlanSteps(
      [
        topic({ id: "third", ordinal: 3 }),
        topic({ id: "first", ordinal: 1 }),
        topic({ id: "second", ordinal: 2 }),
      ],
      [],
      THRESHOLD,
    );
    expect(topicOrder(steps)).toEqual(["first", "second", "third"]);
  });

  /** FR-STU-021 — the invariant the whole plan exists to guarantee. */
  it("never places a topic before an unmastered prerequisite", () => {
    const steps = buildPlanSteps(
      [
        // Dependent appears first by ordinal, but depends on `base`.
        topic({ id: "dependent", ordinal: 1, prereqIds: ["base"] }),
        topic({ id: "base", ordinal: 9 }),
      ],
      [],
      THRESHOLD,
    );
    const order = topicOrder(steps);
    expect(order.indexOf("base")).toBeLessThan(order.indexOf("dependent"));
  });

  it("hoists a whole prerequisite chain bottom-up", () => {
    const steps = buildPlanSteps(
      [
        topic({ id: "c", ordinal: 1, prereqIds: ["b"] }),
        topic({ id: "b", ordinal: 5, prereqIds: ["a"] }),
        topic({ id: "a", ordinal: 9 }),
      ],
      [],
      THRESHOLD,
    );
    const order = topicOrder(steps);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("treats a mastered prerequisite as satisfied and does not re-add it", () => {
    const steps = buildPlanSteps(
      [
        topic({ id: "dependent", ordinal: 2, prereqIds: ["base"] }),
        topic({ id: "base", ordinal: 1, pKnown: 0.9 }),
      ],
      [],
      THRESHOLD,
    );
    expect(topicOrder(steps)).toEqual(["dependent"]);
  });

  it("marks blocked topics and names what blocks them", () => {
    const steps = buildPlanSteps(
      [
        topic({ id: "dependent", ordinal: 1, prereqIds: ["base"] }),
        topic({ id: "base", ordinal: 2 }),
      ],
      [],
      THRESHOLD,
    );
    const dependent = steps.find((s) => s.topicId === "dependent");
    expect(dependent?.blocked).toBe(true);
    expect(dependent?.blockedBy).toContain("BASE");

    const base = steps.find((s) => s.topicId === "base");
    expect(base?.blocked).toBe(false);
  });

  it("terminates on a cyclic prerequisite set rather than hanging", () => {
    // The seeder rejects cycles; this guarantees a corrupt set cannot hang the
    // plan builder if one ever reaches it.
    const steps = buildPlanSteps(
      [
        topic({ id: "x", prereqIds: ["y"] }),
        topic({ id: "y", prereqIds: ["x"] }),
      ],
      [],
      THRESHOLD,
    );
    expect(topicOrder(steps).sort()).toEqual(["x", "y"]);
  });

  it("pins remediation steps at the head, ahead of all topics", () => {
    const steps = buildPlanSteps(
      [topic({ id: "a" })],
      [
        {
          misconceptionId: "m1",
          misconceptionCode: "MC-T22-1",
          topicId: "a",
          description: "Believes randomised quicksort has an O(n log n) worst case",
          remediation: "Work through the adversarial input.",
          hits: 4,
        },
      ],
      THRESHOLD,
    );
    expect(steps[0]?.kind).toBe("remediation");
    expect(steps[0]?.title).toContain("randomised quicksort");
  });

  it("orders remediations by hit count, most persistent first", () => {
    const steps = buildPlanSteps(
      [],
      [
        {
          misconceptionId: "m1",
          misconceptionCode: "A",
          topicId: "t",
          description: "less frequent",
          remediation: "",
          hits: 3,
        },
        {
          misconceptionId: "m2",
          misconceptionCode: "B",
          topicId: "t",
          description: "most frequent",
          remediation: "",
          hits: 9,
        },
      ],
      THRESHOLD,
    );
    expect(steps[0]?.title).toContain("most frequent");
  });

  it("inserts a milestone at each CLO boundary", () => {
    const steps = buildPlanSteps(
      [
        topic({ id: "a", ordinal: 1, cloCode: "CLO-1", cloId: "c1" }),
        topic({ id: "b", ordinal: 2, cloCode: "CLO-1", cloId: "c1" }),
        topic({ id: "c", ordinal: 3, cloCode: "CLO-2", cloId: "c2" }),
      ],
      [],
      THRESHOLD,
    );
    const milestones = steps.filter((s) => s.kind === "milestone");
    // One per distinct CLO, not one per topic.
    expect(milestones).toHaveLength(2);
    expect(milestones[0]?.title).toContain("CLO-1");
    expect(milestones[1]?.title).toContain("CLO-2");
  });

  it("estimates more effort for topics further from mastery", () => {
    const steps = buildPlanSteps(
      [topic({ id: "weak", pKnown: 0.05, ordinal: 1 }), topic({ id: "nearly", pKnown: 0.65, ordinal: 2 })],
      [],
      THRESHOLD,
    );
    const weak = steps.find((s) => s.topicId === "weak");
    const nearly = steps.find((s) => s.topicId === "nearly");
    expect(weak?.estimatedMinutes ?? 0).toBeGreaterThan(nearly?.estimatedMinutes ?? 0);
  });

  it("reorders after mastery changes", () => {
    const before = buildPlanSteps(
      [
        topic({ id: "dependent", ordinal: 1, prereqIds: ["base"] }),
        topic({ id: "base", ordinal: 2 }),
      ],
      [],
      THRESHOLD,
    );
    const after = buildPlanSteps(
      [
        topic({ id: "dependent", ordinal: 1, prereqIds: ["base"] }),
        topic({ id: "base", ordinal: 2, pKnown: 0.9 }),
      ],
      [],
      THRESHOLD,
    );
    // Mastering the prerequisite removes it and unblocks the dependent.
    expect(topicOrder(before)).toEqual(["base", "dependent"]);
    expect(topicOrder(after)).toEqual(["dependent"]);
    expect(after.find((s) => s.topicId === "dependent")?.blocked).toBe(false);
  });
});

describe("pointsFor", () => {
  it("weights points by difficulty", () => {
    expect(pointsFor(0)).toBe(5);
    expect(pointsFor(0.5)).toBe(10);
    expect(pointsFor(1)).toBe(15);
  });

  it("clamps out-of-range difficulty rather than producing absurd awards", () => {
    expect(pointsFor(-5)).toBe(5);
    expect(pointsFor(99)).toBe(15);
  });
});
