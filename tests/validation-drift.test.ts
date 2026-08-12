import { describe, expect, it } from "vitest";
import { driftCheck } from "@/validation/drift";
import type { CandidateItem, ValidationContext } from "@/validation/types";
import type { RetrievalResult } from "@/intelligence/retrieval/types";

function chunk(id: string): RetrievalResult {
  return {
    id,
    text: "source text",
    score: 1,
    channels: [],
    materialId: "m1",
    materialTitle: "Open Data Structures",
    topicId: "topic-1",
    topicCode: "T22",
    topicTitle: "Quicksort",
    cloIds: ["clo-4"],
    bloomLevel: 3,
    difficulty: 0.5,
    lomFormat: "worked_example",
    resourceType: "narrative text",
    tagConfidence: 0.9,
    verified: false,
    pageFrom: 10,
    pageTo: 11,
    sectionPath: "3 Sorting > 3.2 Quicksort",
  };
}

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    courseId: "course-1",
    cloId: "clo-4",
    cloCode: "CLO-4",
    cloStatement: "Apply searching and sorting algorithms.",
    cloBloomLevel: 3,
    topicId: "topic-1",
    topicCode: "T22",
    topicTitle: "Quicksort",
    targetBloom: 3,
    sourceChunks: [chunk("c1"), chunk("c2")],
    misconceptions: [],
    validTopicCodes: new Set(["T22", "T21"]),
    validCloCodes: new Set(["CLO-4", "CLO-1"]),
    ...overrides,
  };
}

function item(overrides: Partial<CandidateItem> = {}): CandidateItem {
  return {
    type: "mcq",
    stem: "Which invariant holds after one Lomuto partition step?",
    options: [],
    explanation: "The pivot is in its final sorted position.",
    difficultyPrior: 0.5,
    citedChunkIds: ["c1"],
    ...overrides,
  };
}

describe("driftCheck", () => {
  it("passes a well-formed in-curriculum item", () => {
    const result = driftCheck(item(), context());
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.fatal).toBeFalsy();
  });

  it("rejects a topic outside the curriculum and is fatal", () => {
    const result = driftCheck(item(), context({ topicCode: "T99" }));
    expect(result.passed).toBe(false);
    expect(result.fatal).toBe(true);
    expect(result.detail).toContain("T99");
  });

  it("rejects a CLO outside the curriculum", () => {
    const result = driftCheck(item(), context({ cloCode: "CLO-99" }));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("CLO-99");
  });

  /** An item may not claim to assess above its outcome's ceiling. */
  it("rejects a requested Bloom level above the CLO ceiling", () => {
    const result = driftCheck(item(), context({ targetBloom: 5, cloBloomLevel: 3 }));
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/exceeds .* ceiling/);
  });

  it("accepts a requested level at or below the ceiling", () => {
    expect(driftCheck(item(), context({ targetBloom: 3, cloBloomLevel: 3 })).passed).toBe(true);
    expect(driftCheck(item(), context({ targetBloom: 2, cloBloomLevel: 3 })).passed).toBe(true);
  });

  /**
   * A citation to a chunk the generator was never given is a fabricated
   * provenance claim — worse than no citation, because it looks verified.
   */
  it("rejects citations to chunks that were not in the provided context", () => {
    const result = driftCheck(item({ citedChunkIds: ["c1", "made-up"] }), context());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("made-up");
  });

  it("rejects an item that cites nothing at all", () => {
    const result = driftCheck(item({ citedChunkIds: [] }), context());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("cites no source chunks");
  });

  it("reports every distinct problem, not just the first", () => {
    const result = driftCheck(
      item({ citedChunkIds: [] }),
      context({ topicCode: "T99", cloCode: "CLO-99", targetBloom: 6, cloBloomLevel: 3 }),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("T99");
    expect(result.detail).toContain("CLO-99");
    expect(result.detail).toContain("ceiling");
    expect(result.detail).toContain("cites no source chunks");
  });

  it("names the curriculum position in the passing detail so the report is legible", () => {
    const result = driftCheck(item(), context());
    expect(result.detail).toContain("T22");
    expect(result.detail).toContain("CLO-4");
  });
});
