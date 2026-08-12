import type { CloPloSeed, CloSeed } from "./types";

/**
 * Eight course learning outcomes, each pinned to a Bloom level (FR-INT-002).
 *
 * The Bloom level is a *ceiling* as well as a target: the validation engine
 * rejects any item whose requested level exceeds its CLO's level, and adaptive
 * selection will not serve above it either.
 */
export const clos: CloSeed[] = [
  {
    code: "CLO-1",
    ordinal: 1,
    bloomLevel: 4,
    weight: 1.25,
    statement:
      "Analyse the time and space complexity of iterative and recursive algorithms using asymptotic notation, and derive closed-form bounds from recurrence relations.",
  },
  {
    code: "CLO-2",
    ordinal: 2,
    bloomLevel: 2,
    weight: 1.0,
    statement:
      "Explain the structure, invariants and operational behaviour of linear data structures — arrays, linked lists, stacks, queues and deques — and describe the cost of their core operations.",
  },
  {
    code: "CLO-3",
    ordinal: 3,
    bloomLevel: 3,
    weight: 1.25,
    statement:
      "Apply recursive problem decomposition and hierarchical data structures — binary trees, binary search trees, balanced trees and tries — to implement correct solutions to structured search problems.",
  },
  {
    code: "CLO-4",
    ordinal: 4,
    bloomLevel: 3,
    weight: 1.5,
    statement:
      "Apply appropriate searching and sorting algorithms to solve computational problems, tracing their execution and predicting their behaviour on given inputs.",
  },
  {
    code: "CLO-5",
    ordinal: 5,
    bloomLevel: 4,
    weight: 1.25,
    statement:
      "Analyse the performance trade-offs of hash-based and heap-based structures, including collision resolution strategy, load factor and amortised versus worst-case cost.",
  },
  {
    code: "CLO-6",
    ordinal: 6,
    bloomLevel: 5,
    weight: 1.25,
    statement:
      "Evaluate competing graph algorithms for a given modelling problem and justify the selection in terms of graph representation, edge weights and required guarantees.",
  },
  {
    code: "CLO-7",
    ordinal: 7,
    bloomLevel: 6,
    weight: 1.5,
    statement:
      "Design efficient algorithms for novel problems using divide-and-conquer, greedy and dynamic-programming strategies, and argue their correctness.",
  },
  {
    code: "CLO-8",
    ordinal: 8,
    bloomLevel: 5,
    weight: 1.0,
    statement:
      "Evaluate algorithmic and data-structure trade-offs against stated constraints, including tractability limits, and communicate the justification for a chosen design.",
  },
];

/**
 * CLO↔PLO contribution matrix (FR-INT-003). Strength: 1 = low, 2 = medium,
 * 3 = high. Deliberately sparse — a course that claims to contribute strongly
 * to all twelve PLOs is not being honest about what it assesses.
 */
export const cloPloMap: CloPloSeed[] = [
  { clo: "CLO-1", plo: "PLO-1", strength: 3 },
  { clo: "CLO-1", plo: "PLO-2", strength: 3 },
  { clo: "CLO-1", plo: "PLO-4", strength: 1 },

  { clo: "CLO-2", plo: "PLO-1", strength: 3 },
  { clo: "CLO-2", plo: "PLO-10", strength: 1 },

  { clo: "CLO-3", plo: "PLO-1", strength: 2 },
  { clo: "CLO-3", plo: "PLO-3", strength: 3 },
  { clo: "CLO-3", plo: "PLO-5", strength: 2 },

  { clo: "CLO-4", plo: "PLO-1", strength: 2 },
  { clo: "CLO-4", plo: "PLO-2", strength: 3 },
  { clo: "CLO-4", plo: "PLO-3", strength: 2 },

  { clo: "CLO-5", plo: "PLO-2", strength: 3 },
  { clo: "CLO-5", plo: "PLO-4", strength: 2 },

  { clo: "CLO-6", plo: "PLO-2", strength: 2 },
  { clo: "CLO-6", plo: "PLO-3", strength: 3 },
  { clo: "CLO-6", plo: "PLO-4", strength: 2 },

  { clo: "CLO-7", plo: "PLO-3", strength: 3 },
  { clo: "CLO-7", plo: "PLO-4", strength: 2 },
  { clo: "CLO-7", plo: "PLO-5", strength: 1 },
  { clo: "CLO-7", plo: "PLO-12", strength: 2 },

  { clo: "CLO-8", plo: "PLO-2", strength: 2 },
  { clo: "CLO-8", plo: "PLO-10", strength: 3 },
  { clo: "CLO-8", plo: "PLO-12", strength: 2 },
];
