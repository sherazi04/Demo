import type { CloTopicSeed } from "./types";

/**
 * Many-to-many CLO↔Topic mapping (FR-INT-005).
 *
 * This is the edge set the validation engine's `clo_alignment` graph check
 * walks: an item whose topic is not ASSESSED_BY-linked to its CLO fails,
 * regardless of how plausible it reads. Every topic appears at least once, or
 * the curriculum validation console will (correctly) flag it.
 */
export const cloTopics: CloTopicSeed[] = [
  // CLO-1 — complexity analysis (Analyze)
  { clo: "CLO-1", topic: "T01" },
  { clo: "CLO-1", topic: "T02" },
  { clo: "CLO-1", topic: "T03" },
  { clo: "CLO-1", topic: "T04" },
  { clo: "CLO-1", topic: "T09" },
  { clo: "CLO-1", topic: "T23" },

  // CLO-2 — linear structures (Understand)
  { clo: "CLO-2", topic: "T05" },
  { clo: "CLO-2", topic: "T06" },
  { clo: "CLO-2", topic: "T07" },
  { clo: "CLO-2", topic: "T08" },
  { clo: "CLO-2", topic: "T03" },

  // CLO-3 — recursion and hierarchical structures (Apply)
  { clo: "CLO-3", topic: "T09" },
  { clo: "CLO-3", topic: "T10" },
  { clo: "CLO-3", topic: "T11" },
  { clo: "CLO-3", topic: "T12" },
  { clo: "CLO-3", topic: "T13" },
  { clo: "CLO-3", topic: "T14" },

  // CLO-4 — searching and sorting (Apply)
  { clo: "CLO-4", topic: "T19" },
  { clo: "CLO-4", topic: "T20" },
  { clo: "CLO-4", topic: "T21" },
  { clo: "CLO-4", topic: "T22" },
  { clo: "CLO-4", topic: "T23" },
  { clo: "CLO-4", topic: "T16" },
  { clo: "CLO-4", topic: "T12" },

  // CLO-5 — hashing and heaps (Analyze)
  { clo: "CLO-5", topic: "T15" },
  { clo: "CLO-5", topic: "T16" },
  { clo: "CLO-5", topic: "T17" },
  { clo: "CLO-5", topic: "T18" },
  { clo: "CLO-5", topic: "T05" },
  { clo: "CLO-5", topic: "T13" },

  // CLO-6 — graph algorithm selection (Evaluate)
  { clo: "CLO-6", topic: "T24" },
  { clo: "CLO-6", topic: "T25" },
  { clo: "CLO-6", topic: "T26" },
  { clo: "CLO-6", topic: "T27" },
  { clo: "CLO-6", topic: "T08" },

  // CLO-7 — algorithm design strategies (Create)
  { clo: "CLO-7", topic: "T10" },
  { clo: "CLO-7", topic: "T21" },
  { clo: "CLO-7", topic: "T22" },
  { clo: "CLO-7", topic: "T28" },
  { clo: "CLO-7", topic: "T29" },
  { clo: "CLO-7", topic: "T04" },

  // CLO-8 — trade-off evaluation and tractability (Evaluate)
  { clo: "CLO-8", topic: "T30" },
  { clo: "CLO-8", topic: "T02" },
  { clo: "CLO-8", topic: "T06" },
  { clo: "CLO-8", topic: "T13" },
  { clo: "CLO-8", topic: "T18" },
  { clo: "CLO-8", topic: "T22" },
  { clo: "CLO-8", topic: "T24" },
  { clo: "CLO-8", topic: "T26" },
  { clo: "CLO-8", topic: "T28" },
  { clo: "CLO-8", topic: "T29" },
];
