import type { PrereqSeed } from "./types";

/**
 * Directed prerequisite edges (FR-INT-004): `topic` requires `prereq`.
 *
 * This set is acyclic by construction — every edge points from a lower topic
 * code to a higher one — but the seeder re-derives that rather than trusting
 * it, because a hand-edited file is exactly where a cycle gets introduced.
 * A corrupt prerequisite graph silently corrupts every learning plan (R10).
 */
export const prereqs: PrereqSeed[] = [
  // Complexity foundations
  { topic: "T02", prereq: "T01" },
  { topic: "T03", prereq: "T02" },
  { topic: "T04", prereq: "T03" },
  { topic: "T04", prereq: "T09" },

  // Linear structures
  { topic: "T05", prereq: "T03" },
  { topic: "T06", prereq: "T05" },
  { topic: "T07", prereq: "T05" },
  { topic: "T07", prereq: "T06" },
  { topic: "T08", prereq: "T05" },
  { topic: "T08", prereq: "T06" },

  // Recursion
  { topic: "T09", prereq: "T07" },
  { topic: "T10", prereq: "T09" },

  // Trees
  { topic: "T11", prereq: "T06" },
  { topic: "T11", prereq: "T09" },
  { topic: "T12", prereq: "T11" },
  { topic: "T13", prereq: "T12" },
  { topic: "T13", prereq: "T04" },
  { topic: "T14", prereq: "T11" },

  // Heaps
  { topic: "T15", prereq: "T05" },
  { topic: "T15", prereq: "T11" },
  { topic: "T16", prereq: "T15" },

  // Hashing
  { topic: "T17", prereq: "T05" },
  { topic: "T18", prereq: "T17" },
  { topic: "T18", prereq: "T06" },
  { topic: "T18", prereq: "T03" },

  // Searching and elementary sorting
  { topic: "T19", prereq: "T05" },
  { topic: "T19", prereq: "T02" },
  { topic: "T20", prereq: "T05" },
  { topic: "T20", prereq: "T03" },

  // Divide-and-conquer sorting
  { topic: "T21", prereq: "T20" },
  { topic: "T21", prereq: "T04" },
  { topic: "T22", prereq: "T21" },
  { topic: "T23", prereq: "T21" },
  { topic: "T23", prereq: "T22" },

  // Graphs
  { topic: "T24", prereq: "T05" },
  { topic: "T24", prereq: "T06" },
  { topic: "T25", prereq: "T24" },
  { topic: "T25", prereq: "T08" },
  { topic: "T25", prereq: "T09" },
  { topic: "T26", prereq: "T25" },
  { topic: "T26", prereq: "T15" },
  { topic: "T27", prereq: "T25" },
  { topic: "T27", prereq: "T15" },

  // Design strategies
  { topic: "T28", prereq: "T26" },
  { topic: "T28", prereq: "T27" },
  { topic: "T29", prereq: "T10" },
  { topic: "T29", prereq: "T04" },
  { topic: "T29", prereq: "T28" },
  { topic: "T30", prereq: "T29" },
  { topic: "T30", prereq: "T23" },
];
