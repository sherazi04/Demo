import { describe, expect, it } from "vitest";
import { findCycle, reachableFrom, topologicalSort, type Edge } from "@/lib/graph";

const edges = (pairs: Array<[string, string]>): Edge[] =>
  pairs.map(([from, to]) => ({ from, to }));

describe("findCycle", () => {
  it("returns null for a DAG", () => {
    expect(findCycle(["a", "b", "c"], edges([["a", "b"], ["b", "c"], ["a", "c"]]))).toBeNull();
  });

  it("finds a direct two-node cycle", () => {
    const cycle = findCycle(["a", "b"], edges([["a", "b"], ["b", "a"]]));
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
  });

  it("finds a multi-hop cycle and reports the path", () => {
    const cycle = findCycle(
      ["a", "b", "c", "d"],
      edges([["a", "b"], ["b", "c"], ["c", "d"], ["d", "b"]]),
    );
    expect(cycle).not.toBeNull();
    // b -> c -> d -> b; the entry edge a->b is not part of the cycle.
    expect(new Set(cycle ?? [])).toEqual(new Set(["b", "c", "d"]));
  });

  it("finds a self-loop", () => {
    expect(findCycle(["a"], edges([["a", "a"]]))).toEqual(["a", "a"]);
  });

  it("does not mistake a diamond for a cycle", () => {
    const diamond = edges([["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]);
    expect(findCycle(["a", "b", "c", "d"], diamond)).toBeNull();
  });
});

describe("topologicalSort", () => {
  it("orders dependents before their targets", () => {
    const order = topologicalSort(["a", "b", "c"], edges([["a", "b"], ["b", "c"]]));
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("returns null on a cyclic graph", () => {
    expect(topologicalSort(["a", "b"], edges([["a", "b"], ["b", "a"]]))).toBeNull();
  });

  it("is deterministic across runs for independent nodes", () => {
    const nodes = ["z", "y", "x"];
    expect(topologicalSort(nodes, [])).toEqual(topologicalSort(nodes, []));
  });
});

describe("reachableFrom", () => {
  it("collects the transitive closure and excludes the start node", () => {
    const set = reachableFrom("a", edges([["a", "b"], ["b", "c"], ["c", "d"]]));
    expect(set).toEqual(new Set(["b", "c", "d"]));
  });

  it("returns empty for a node with no outgoing edges", () => {
    expect(reachableFrom("d", edges([["a", "b"]]))).toEqual(new Set());
  });

  it("terminates on a cyclic graph", () => {
    expect(reachableFrom("a", edges([["a", "b"], ["b", "a"]]))).toEqual(new Set(["b"]));
  });
});
