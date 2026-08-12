import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, type RankedList } from "@/intelligence/retrieval/fuse";

describe("reciprocalRankFusion", () => {
  it("returns an empty list for no input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("preserves a single channel's order", () => {
    const lists: RankedList[] = [{ channel: "dense", ids: ["a", "b", "c"] }];
    expect(reciprocalRankFusion(lists).map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("rewards a document ranked by more than one channel", () => {
    // `b` is second in both lists; `a` and `c` are first in one each.
    const lists: RankedList[] = [
      { channel: "dense", ids: ["a", "b"] },
      { channel: "lexical", ids: ["c", "b"] },
    ];
    const fused = reciprocalRankFusion(lists, 60);
    expect(fused[0]?.id).toBe("b");
    expect(fused[0]?.channels).toHaveLength(2);
  });

  it("uses 1-based ranks so the top hit is not treated as unranked", () => {
    const single = reciprocalRankFusion([{ channel: "dense", ids: ["a"] }], 60);
    // 1/(60+1), not 1/(60+0).
    expect(single[0]?.score).toBeCloseTo(1 / 61, 10);
  });

  it("applies the graph rank penalty so graph-only hits enter behind", () => {
    const lists: RankedList[] = [
      { channel: "dense", ids: ["dense-hit"] },
      { channel: "graph", ids: ["graph-hit"], rankPenalty: 8 },
    ];
    const fused = reciprocalRankFusion(lists, 60);
    expect(fused[0]?.id).toBe("dense-hit");
    expect(fused[1]?.id).toBe("graph-hit");
    expect(fused[1]?.score).toBeCloseTo(1 / 69, 10);
  });

  it("still lets a graph hit win when several channels agree on it", () => {
    const lists: RankedList[] = [
      { channel: "dense", ids: ["x", "shared"] },
      { channel: "lexical", ids: ["y", "shared"] },
      { channel: "graph", ids: ["shared"], rankPenalty: 8 },
    ];
    expect(reciprocalRankFusion(lists, 60)[0]?.id).toBe("shared");
  });

  it("records which channel found each document and at what rank", () => {
    const lists: RankedList[] = [
      { channel: "dense", ids: ["a", "b"] },
      { channel: "lexical", ids: ["b"] },
    ];
    const fused = reciprocalRankFusion(lists, 60);
    const b = fused.find((h) => h.id === "b");
    expect(b?.channels).toEqual([
      { channel: "dense", rank: 2 },
      { channel: "lexical", rank: 1 },
    ]);
  });

  it("is deterministic when scores tie", () => {
    const lists: RankedList[] = [{ channel: "dense", ids: ["b", "a"] }];
    const other: RankedList[] = [{ channel: "dense", ids: ["b", "a"] }];
    expect(reciprocalRankFusion(lists).map((h) => h.id)).toEqual(
      reciprocalRankFusion(other).map((h) => h.id),
    );
  });

  it("breaks exact ties by channel agreement, then by id", () => {
    // Both at rank 1 in one list each — equal scores, equal channel counts.
    const lists: RankedList[] = [
      { channel: "dense", ids: ["zeta"] },
      { channel: "lexical", ids: ["alpha"] },
    ];
    expect(reciprocalRankFusion(lists).map((h) => h.id)).toEqual(["alpha", "zeta"]);
  });

  it("makes k control how sharply early ranks are favoured", () => {
    const lists: RankedList[] = [{ channel: "dense", ids: ["a", "b"] }];
    const sharp = reciprocalRankFusion(lists, 1);
    const flat = reciprocalRankFusion(lists, 1000);

    const sharpGap = (sharp[0]?.score ?? 0) - (sharp[1]?.score ?? 0);
    const flatGap = (flat[0]?.score ?? 0) - (flat[1]?.score ?? 0);
    // A small k separates rank 1 from rank 2 far more than a large k does.
    expect(sharpGap).toBeGreaterThan(flatGap);
  });

  it("deduplicates a document repeated within one channel's list", () => {
    const fused = reciprocalRankFusion([{ channel: "dense", ids: ["a", "a", "b"] }]);
    expect(fused.filter((h) => h.id === "a")).toHaveLength(1);
  });
});
