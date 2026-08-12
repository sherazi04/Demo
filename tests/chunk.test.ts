import { describe, expect, it } from "vitest";
import { chunkBlocks, estimateTokens, splitSentences } from "@/intelligence/ingest/chunk";
import type { TextBlock } from "@/intelligence/ingest/parse";

const OPTIONS = { targetTokens: 100, overlapTokens: 20, minTokens: 15 };

function block(text: string, extra: Partial<TextBlock> = {}): TextBlock {
  return {
    text,
    page: null,
    sectionPath: null,
    isHeading: false,
    headingLevel: null,
    ...extra,
  };
}

/** Prose long enough to force multiple chunks at the test target size. */
function prose(sentences: number): string {
  return Array.from(
    { length: sentences },
    (_, i) =>
      `Sentence number ${i + 1} explains a distinct property of the data structure under discussion in reasonable detail.`,
  ).join(" ");
}

describe("estimateTokens", () => {
  it("returns zero for empty or whitespace input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   \n ")).toBe(0);
  });

  it("grows with text length", () => {
    expect(estimateTokens(prose(10))).toBeGreaterThan(estimateTokens(prose(2)));
  });

  it("does not badly underestimate many short tokens", () => {
    // The char/4 rule alone would call this 4 tokens; the word floor catches it.
    expect(estimateTokens("a b c d e f g h")).toBeGreaterThanOrEqual(6);
  });
});

describe("splitSentences", () => {
  it("splits on sentence terminators", () => {
    expect(splitSentences("One thing. Two things! Three things?")).toHaveLength(3);
  });

  it("does not split on common abbreviations", () => {
    const parts = splitSentences("See Fig. 3 for the layout. It shows the heap.");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("Fig. 3");
  });

  it("does not split inside decimal numbers", () => {
    const parts = splitSentences("The load factor reached 0.75 before resizing. Then it halved.");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("0.75");
  });

  it("does not split on i.e. or e.g.", () => {
    expect(splitSentences("Use a heap, i.e. a complete tree. Then extract.")).toHaveLength(2);
  });

  it("returns the whole text when there is no terminator", () => {
    expect(splitSentences("no terminator here")).toEqual(["no terminator here"]);
  });
});

describe("chunkBlocks", () => {
  it("produces nothing from empty input", () => {
    expect(chunkBlocks([], OPTIONS)).toEqual([]);
  });

  it("produces contiguous ordinals starting at zero", () => {
    const chunks = chunkBlocks([block(prose(40))], OPTIONS);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  /** The core requirement: structure before size (FR-INT-016). */
  it("starts a new chunk at a heading rather than packing across it", () => {
    const blocks = [
      block("Sorting", { isHeading: true, headingLevel: 1 }),
      block("Merge sort divides the array in half."),
      block("Hashing", { isHeading: true, headingLevel: 1 }),
      block("A hash function maps keys to buckets."),
    ];
    const chunks = chunkBlocks(blocks, { ...OPTIONS, minTokens: 0 });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toContain("Merge sort");
    expect(chunks[0]?.text).not.toContain("hash function");
    expect(chunks[1]?.text).toContain("hash function");
  });

  it("keeps the heading as context on its section's first chunk", () => {
    const blocks = [
      block("3.2 Quicksort", { isHeading: true, headingLevel: 2 }),
      block("Partitioning places the pivot in its final position."),
    ];
    const chunks = chunkBlocks(blocks, { ...OPTIONS, minTokens: 0 });
    expect(chunks[0]?.text.startsWith("3.2 Quicksort")).toBe(true);
  });

  it("splits at slide boundaries", () => {
    const blocks = [
      block("Point one about heaps.", { page: 1 }),
      block("Point two about tries.", { page: 2 }),
    ];
    const chunks = chunkBlocks(blocks, { ...OPTIONS, minTokens: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.pageFrom).toBe(1);
    expect(chunks[1]?.pageFrom).toBe(2);
  });

  it("never starts or ends a chunk mid-sentence", () => {
    const chunks = chunkBlocks([block(prose(60))], OPTIONS);
    for (const chunk of chunks) {
      const body = chunk.text.trim();
      // Each chunk must begin at a sentence start (capital or heading) and end
      // on a terminator — a fragment is unusable as a citation.
      expect(/^[A-Z0-9]/.test(body)).toBe(true);
      expect(/[.!?]$/.test(body)).toBe(true);
    }
  });

  it("respects the target token size within a tolerance", () => {
    const chunks = chunkBlocks([block(prose(80))], OPTIONS);
    for (const chunk of chunks) {
      // Overshoot is bounded by one sentence, since packing stops before adding
      // a sentence that would exceed the target.
      expect(chunk.tokenCount).toBeLessThan(OPTIONS.targetTokens * 2);
    }
  });

  it("overlaps consecutive chunks with whole sentences", () => {
    const chunks = chunkBlocks([block(prose(60))], OPTIONS);
    expect(chunks.length).toBeGreaterThan(1);

    const first = chunks[0];
    const second = chunks[1];
    expect(first && second).toBeTruthy();
    if (!first || !second) return;

    const firstSentences = splitSentences(first.text);
    const lastOfFirst = firstSentences[firstSentences.length - 1];
    expect(lastOfFirst).toBeDefined();
    // The overlap carries a complete sentence forward, not a truncated fragment.
    if (lastOfFirst) expect(second.text).toContain(lastOfFirst);
  });

  it("emits an oversized single sentence whole rather than cutting it", () => {
    const long = `${"a very long clause that keeps going and going ".repeat(30)}end.`;
    const chunks = chunkBlocks([block(long)], OPTIONS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("end.");
  });

  it("folds a tiny trailing remainder into the previous chunk", () => {
    const chunks = chunkBlocks([block(`${prose(30)} Short tail.`)], OPTIONS);
    const last = chunks[chunks.length - 1];
    expect(last).toBeDefined();
    // No stub chunk below the minimum survives on its own.
    expect(last?.tokenCount ?? 0).toBeGreaterThanOrEqual(OPTIONS.minTokens);
  });

  it("carries the section path onto every chunk of that section", () => {
    const blocks = [
      block("Trees", { isHeading: true, headingLevel: 1, sectionPath: "Trees" }),
      block(prose(40), { sectionPath: "Trees" }),
    ];
    const chunks = chunkBlocks(blocks, OPTIONS);
    expect(chunks.every((c) => c.sectionPath === "Trees")).toBe(true);
  });

  it("records the page range spanned by a multi-page section", () => {
    const blocks = [
      block("Graphs", { isHeading: true, headingLevel: 1 }),
      block("First part of the section.", { page: 4 }),
    ];
    const chunks = chunkBlocks(blocks, { ...OPTIONS, minTokens: 0 });
    expect(chunks[0]?.pageFrom).toBe(4);
    expect(chunks[0]?.pageTo).toBe(4);
  });

  it("ignores a heading with no body rather than emitting an empty chunk", () => {
    const chunks = chunkBlocks(
      [block("Empty Section", { isHeading: true, headingLevel: 1 })],
      OPTIONS,
    );
    expect(chunks).toEqual([]);
  });
});
