import { clamp01 } from "./bkt";

/**
 * Item difficulty calibration by Elo update (design.md §8.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS NOT ITEM RESPONSE THEORY.
 *
 * It is a calibrated-difficulty approximation. Real 2PL/3PL IRT estimates a
 * discrimination parameter and a guessing parameter alongside difficulty, from
 * a large student × item response matrix, by marginal maximum likelihood. This
 * does none of that: it is a single-parameter online update from whatever
 * responses happen to arrive.
 *
 * Every report, UI label and README section must say "Elo-calibrated", never
 * "IRT-calibrated" (honesty rule 1, design.md §16.1). The approximation is
 * perfectly reasonable for adaptive selection in a demo; misdescribing it is
 * not.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface EloParameters {
  /** Learning rate while the item is still poorly estimated. */
  kEarly: number;
  /** Learning rate once enough responses have accumulated. */
  kLate: number;
  /** Response count at which K drops. */
  servedSwitch: number;
}

export const DEFAULT_ELO: EloParameters = {
  kEarly: 0.03,
  kLate: 0.01,
  servedSwitch: 30,
};

/**
 * Probability that a student of `ability` answers an item of `difficulty`
 * correctly.
 *
 * The 0.4 scale factor sets how sharply the curve separates ability from
 * difficulty on the 0–1 scale both live on. Larger values flatten it; this
 * value gives a ~0.5 probability when they match and ~0.85 at a 0.4 gap.
 */
export function expectedScore(ability: number, difficulty: number): number {
  return 1 / (1 + Math.pow(10, (difficulty - ability) / 0.4));
}

/**
 * Updates an item's difficulty after one response.
 *
 * The sign is the part worth stating plainly: a CORRECT answer makes the item
 * EASIER (difficulty falls), because the evidence says it was more answerable
 * than estimated. `actual` is 1 for correct.
 */
export function eloUpdate(
  difficulty: number,
  ability: number,
  correct: boolean,
  timesServed: number,
  params: EloParameters = DEFAULT_ELO,
): number {
  const k = timesServed < params.servedSwitch ? params.kEarly : params.kLate;
  const expected = expectedScore(ability, difficulty);
  const actual = correct ? 1 : 0;

  // difficulty' = difficulty + K·(expected − actual)
  //   correct   (actual 1): expected − 1 ≤ 0 → difficulty falls
  //   incorrect (actual 0): expected − 0 ≥ 0 → difficulty rises
  return clamp01(difficulty + k * (expected - actual));
}

/**
 * How much to trust an item's difficulty estimate, from its response count.
 *
 * Surfaced in the UI so a teacher can tell a calibrated item from one still
 * carrying the generator's prior guess.
 */
export function calibrationConfidence(
  timesServed: number,
  params: EloParameters = DEFAULT_ELO,
): { level: "prior" | "provisional" | "calibrated"; label: string } {
  if (timesServed === 0) {
    return { level: "prior", label: "LLM prior, no responses yet" };
  }
  if (timesServed < params.servedSwitch) {
    return {
      level: "provisional",
      label: `provisional (${timesServed} of ${params.servedSwitch} responses)`,
    };
  }
  return { level: "calibrated", label: `Elo-calibrated over ${timesServed} responses` };
}
