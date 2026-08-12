/**
 * Shapes for the declarative curriculum seed (FR-INT-007, NFR-CFG-006).
 *
 * Retargeting the system to a different course means replacing the data files
 * in this directory — no code change. Every code reference is by `code`, never
 * by database id, so the seed stays portable.
 */

export type BloomLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const BLOOM_NAMES: Record<BloomLevel, string> = {
  1: "Remember",
  2: "Understand",
  3: "Apply",
  4: "Analyze",
  5: "Evaluate",
  6: "Create",
};

export interface ProgramSeed {
  code: string;
  title: string;
  accreditationBody: string;
}

export interface PloSeed {
  code: string;
  statement: string;
  ordinal: number;
}

export interface CourseSeed {
  code: string;
  title: string;
  creditHours: number;
  weeks: number;
}

export interface CloSeed {
  code: string;
  statement: string;
  bloomLevel: BloomLevel;
  weight: number;
  ordinal: number;
}

/** Contribution strength: 1 = low, 2 = medium, 3 = high (FR-INT-003). */
export type ContributionStrength = 1 | 2 | 3;

export interface CloPloSeed {
  clo: string;
  plo: string;
  strength: ContributionStrength;
}

export interface TopicSeed {
  code: string;
  title: string;
  week: number;
  ordinal: number;
  summary: string;
}

/** `topic` depends on `prereq`; the seeder rejects any cycle before writing. */
export interface PrereqSeed {
  topic: string;
  prereq: string;
}

export interface CloTopicSeed {
  clo: string;
  topic: string;
}

export interface MisconceptionSeed {
  topic: string;
  code: string;
  description: string;
  remediation: string;
}
