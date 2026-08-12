import { describe, expect, it } from "vitest";
import { curriculum } from "@data/curriculum";
import { validateSeed } from "@/curriculum/validate-seed";
import { findCycle, reachableFrom, type Edge } from "@/lib/graph";

/**
 * Guards the authored CS-201 spine against the volumes required by
 * requirements.md §4.1 and the structural invariants the seeder depends on.
 * These run without any infrastructure, so a bad edit fails in CI, not at seed
 * time against a live database.
 */
describe("CS-201 curriculum seed", () => {
  it("passes structural validation with no problems", () => {
    expect(validateSeed()).toEqual([]);
  });

  it("meets the required volumes", () => {
    expect(curriculum.plos).toHaveLength(12);
    expect(curriculum.clos).toHaveLength(8);
    expect(curriculum.topics).toHaveLength(30);
    expect(curriculum.course.weeks).toBe(14);
    expect(curriculum.misconceptions.length).toBeGreaterThanOrEqual(60);
  });

  it("gives every CLO a Bloom level in 1..6 and a PLO mapping", () => {
    const mapped = new Set(curriculum.cloPloMap.map((m) => m.clo));
    for (const clo of curriculum.clos) {
      expect(clo.bloomLevel).toBeGreaterThanOrEqual(1);
      expect(clo.bloomLevel).toBeLessThanOrEqual(6);
      expect(mapped.has(clo.code)).toBe(true);
    }
  });

  it("uses the full Bloom range across the CLO set", () => {
    const levels = new Set(curriculum.clos.map((c) => c.bloomLevel));
    // A course whose CLOs sit at one or two levels cannot demonstrate a
    // Bloom-ascending lecture plan or a mastery-gated Bloom cap.
    expect(levels.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(5);
  });

  it("maps every topic to at least one CLO", () => {
    const mapped = new Set(curriculum.cloTopics.map((m) => m.topic));
    const orphans = curriculum.topics.filter((t) => !mapped.has(t.code)).map((t) => t.code);
    expect(orphans).toEqual([]);
  });

  it("gives every topic at least two misconceptions", () => {
    const counts = new Map<string, number>();
    for (const m of curriculum.misconceptions) {
      counts.set(m.topic, (counts.get(m.topic) ?? 0) + 1);
    }
    const thin = curriculum.topics.filter((t) => (counts.get(t.code) ?? 0) < 2).map((t) => t.code);
    expect(thin).toEqual([]);
  });

  it("has an acyclic prerequisite graph", () => {
    const edges: Edge[] = curriculum.prereqs.map((p) => ({ from: p.topic, to: p.prereq }));
    const codes = curriculum.topics.map((t) => t.code);
    expect(findCycle(codes, edges)).toBeNull();
  });

  it("has multi-level prerequisite depth for the closure query to exercise", () => {
    const edges: Edge[] = curriculum.prereqs.map((p) => ({ from: p.topic, to: p.prereq }));
    // T29 (Dynamic Programming) should transitively require the complexity and
    // recursion foundations, not just its direct parents.
    const closure = reachableFrom("T29", edges);
    expect(closure.size).toBeGreaterThan(5);
    expect(closure.has("T01")).toBe(true);
    expect(closure.has("T09")).toBe(true);
  });

  it("assigns every topic to a week within the course length", () => {
    for (const topic of curriculum.topics) {
      expect(topic.week).toBeGreaterThanOrEqual(1);
      expect(topic.week).toBeLessThanOrEqual(curriculum.course.weeks);
    }
  });

  it("uses only strengths 1..3 in the CLO-PLO matrix", () => {
    for (const m of curriculum.cloPloMap) {
      expect([1, 2, 3]).toContain(m.strength);
    }
  });

  it("gives each topic a summary that is more than a restated title", () => {
    for (const topic of curriculum.topics) {
      expect(topic.summary.length).toBeGreaterThan(80);
      expect(topic.summary).not.toBe(topic.title);
    }
  });
});

describe("validateSeed", () => {
  it("detects an introduced prerequisite cycle", () => {
    const broken = {
      ...curriculum,
      prereqs: [...curriculum.prereqs, { topic: "T01", prereq: "T30" }],
    };
    const problems = validateSeed(broken);
    expect(problems.some((p) => p.kind === "prereq_cycle")).toBe(true);
  });

  it("detects a dangling topic reference", () => {
    const broken = {
      ...curriculum,
      cloTopics: [...curriculum.cloTopics, { clo: "CLO-1", topic: "T99" }],
    };
    const problems = validateSeed(broken);
    expect(problems.some((p) => p.kind === "unknown_code" && p.ids.includes("T99"))).toBe(true);
  });

  it("detects a topic left with fewer than two misconceptions", () => {
    const broken = {
      ...curriculum,
      misconceptions: curriculum.misconceptions.filter((m) => m.topic !== "T01"),
    };
    const problems = validateSeed(broken);
    expect(
      problems.some((p) => p.kind === "missing_misconceptions" && p.ids.includes("T01")),
    ).toBe(true);
  });
});
