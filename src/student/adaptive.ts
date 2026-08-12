import { clamp01 } from "./bkt";

/**
 * Adaptive item selection (design.md §8.3).
 *
 * Pure and synchronous: the candidate set is fetched by the caller, so the
 * selection *rule* — which is the part that must be demonstrably correct — is
 * unit-testable without a database.
 */

export interface CandidateItem {
  id: string;
  topicId: string;
  targetBloom: number;
  difficultyElo: number;
  /** Global serve count, used for exposure control. */
  timesServed: number;
  /** Misconception codes this item's distractors target. */
  misconceptionCodes: string[];
}

export interface SelectionState {
  /** BKT mastery for the target topic, used as the ability estimate. */
  pKnown: number;
  /** Item ids served to this student recently — deprioritised (FR-STU-003). */
  recentlyServedIds: readonly string[];
  /** Item ids already answered in this run — excluded outright. */
  answeredInRunIds: readonly string[];
  /** Misconceptions this student has triggered lately. */
  recentMisconceptionCodes: readonly string[];
  /** The CLO's Bloom ceiling — never exceeded regardless of mastery. */
  cloBloomCeiling: number;
  /** Mean serves per item across the bank, for the exposure term. */
  meanExposure?: number;
}

export interface ScoredCandidate {
  item: CandidateItem;
  score: number;
  /** Why this item scored as it did — shown in the adaptive-run explanation. */
  breakdown: {
    difficultyFit: number;
    exposurePenalty: number;
    misconceptionBoost: number;
  };
}

/**
 * Target difficulty: slightly above current ability.
 *
 * The +0.05 is desirable difficulty — an item exactly at ability is a coin
 * flip and teaches little. Clamped to [0.15, 0.9] so a student at either
 * extreme is never served something trivially easy or hopeless.
 */
export function targetDifficulty(pKnown: number): number {
  return Math.max(0.15, Math.min(0.9, clamp01(pKnown) + 0.05));
}

/**
 * Mastery gates cognitive level (FR-STU-005).
 *
 * bloomCap = 1 + floor(ability × 5), so a student at 0 mastery sees only
 * Remember-level items and one at full mastery can see all six. Capped again
 * by the CLO's own ceiling, because an outcome that tops out at Understand must
 * never be assessed at Analyse however well the student is doing.
 */
export function bloomCap(pKnown: number, cloBloomCeiling: number): number {
  const fromMastery = 1 + Math.floor(clamp01(pKnown) * 5);
  return Math.max(1, Math.min(fromMastery, cloBloomCeiling));
}

const EXPOSURE_WEIGHT = 0.15;
const MISCONCEPTION_WEIGHT = 0.1;

/**
 * Scores one candidate.
 *
 *   score = −|difficulty − target|
 *         − 0.15 × exposureRate
 *         + 0.10 × misconceptionRelevance
 */
export function scoreCandidate(
  item: CandidateItem,
  state: SelectionState,
  target: number,
): ScoredCandidate {
  const difficultyFit = -Math.abs(item.difficultyElo - target);

  // Normalised against the bank's mean so the penalty means "served more than
  // its share", not "served at all" — an absolute count would permanently
  // suppress the first items ever created.
  const mean = state.meanExposure && state.meanExposure > 0 ? state.meanExposure : 1;
  const exposureRate = item.timesServed / mean;
  const exposurePenalty = -EXPOSURE_WEIGHT * Math.min(exposureRate, 3);

  // Items whose distractors target a misconception this student has recently
  // triggered are boosted — this is what turns the bank into targeted
  // remediation rather than random practice.
  const recent = new Set(state.recentMisconceptionCodes);
  const hits = item.misconceptionCodes.filter((code) => recent.has(code)).length;
  const misconceptionBoost = hits > 0 ? MISCONCEPTION_WEIGHT * Math.min(hits, 2) : 0;

  // Recently served to this student: a strong penalty rather than exclusion,
  // so a thin bank can still serve something (FR-STU-003).
  const recentlyServed = state.recentlyServedIds.includes(item.id) ? -0.5 : 0;

  return {
    item,
    score: difficultyFit + exposurePenalty + misconceptionBoost + recentlyServed,
    breakdown: { difficultyFit, exposurePenalty, misconceptionBoost },
  };
}

/**
 * Picks the next item, or null when nothing is eligible.
 *
 * `random` is injectable so the tie-break is deterministic under test while
 * still spreading selection in production.
 */
export function selectNext(
  candidates: readonly CandidateItem[],
  state: SelectionState,
  random: () => number = Math.random,
): ScoredCandidate | null {
  const target = targetDifficulty(state.pKnown);
  const cap = bloomCap(state.pKnown, state.cloBloomCeiling);

  const eligible = candidates.filter(
    (item) =>
      item.targetBloom <= cap &&
      // Never repeat within a run — the same item twice teaches nothing and
      // makes the mastery estimate double-count one piece of evidence.
      !state.answeredInRunIds.includes(item.id),
  );

  if (eligible.length === 0) return null;

  const scored = eligible.map((item) => scoreCandidate(item, state, target));
  const best = Math.max(...scored.map((s) => s.score));

  // Ties broken randomly so identical items do not always serve in id order.
  const tied = scored.filter((s) => Math.abs(s.score - best) < 1e-9);
  const chosen = tied[Math.floor(random() * tied.length)] ?? tied[0];
  return chosen ?? null;
}

export type TerminationReason = "count" | "mastery" | "exit";

/**
 * Run termination (FR-STU-007): item count reached, mastery sustained over
 * three consecutive correct responses, or the student exits.
 */
export function shouldTerminate(input: {
  itemsAnswered: number;
  itemsPlanned: number;
  pKnown: number;
  masteryThreshold: number;
  recentResults: readonly boolean[];
}): TerminationReason | null {
  if (input.itemsAnswered >= input.itemsPlanned) return "count";

  const lastThree = input.recentResults.slice(-3);
  if (
    input.pKnown >= input.masteryThreshold &&
    lastThree.length === 3 &&
    lastThree.every(Boolean)
  ) {
    // Both conditions together: a high pKnown from a lucky streak on easy items
    // is not mastery, and three correct answers at low pKnown is not either.
    return "mastery";
  }

  return null;
}
