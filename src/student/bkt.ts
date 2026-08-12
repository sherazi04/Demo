/**
 * Bayesian Knowledge Tracing (design.md §8.1).
 *
 * Pure functions, no database — the update rule is the part that must be
 * provably correct, so it is testable in isolation.
 */

export interface BktParameters {
  /** Prior probability of mastery before any evidence. */
  pInit: number;
  /** P(learn on this opportunity). */
  pTransit: number;
  /** P(wrong | mastered). */
  pSlip: number;
  /** P(right | not mastered). Derived per item type, not shared. */
  pGuess: number;
}

export const DEFAULT_BKT: Omit<BktParameters, "pGuess"> = {
  pInit: 0.15,
  pTransit: 0.12,
  pSlip: 0.1,
};

/**
 * Guess rate by item type.
 *
 * A 4-option MCQ and a short-answer item emphatically do not share a guess
 * rate: 0.25 versus near-zero. Using one rate for both would make a correct SAQ
 * count for far less evidence than it should, and a correct MCQ for far more.
 */
export function guessRateFor(
  type: "mcq" | "saq" | "numeric" | "code",
  optionCount = 4,
): number {
  switch (type) {
    case "mcq":
      return optionCount > 0 ? 1 / optionCount : 0.25;
    case "saq":
    case "code":
      return 0.05;
    case "numeric":
      // Not zero: a numeric answer can be guessed from plausible magnitudes.
      return 0.1;
  }
}

/**
 * One BKT update.
 *
 *   correct:    P(L|obs) = pL·(1−pSlip) / ( pL·(1−pSlip) + (1−pL)·pGuess )
 *   incorrect:  P(L|obs) = pL·pSlip     / ( pL·pSlip     + (1−pL)·(1−pGuess) )
 *   pL'        = P(L|obs) + (1 − P(L|obs))·pTransit
 *
 * The posterior is the evidence update; the transit term then accounts for the
 * chance the student learned *from* this opportunity, which is why mastery can
 * rise even after a wrong answer.
 */
export function bktUpdate(
  priorPKnown: number,
  correct: boolean,
  params: BktParameters,
): number {
  const pL = clamp01(priorPKnown);
  const { pSlip, pGuess, pTransit } = params;

  const numerator = correct ? pL * (1 - pSlip) : pL * pSlip;
  const denominator = correct
    ? pL * (1 - pSlip) + (1 - pL) * pGuess
    : pL * pSlip + (1 - pL) * (1 - pGuess);

  // Degenerate parameters (pSlip = 0 with pL = 0, say) can zero the denominator.
  // Falling back to the prior is the only defensible answer: the observation
  // carries no information under those parameters.
  const posterior = denominator === 0 ? pL : numerator / denominator;

  return clamp01(posterior + (1 - posterior) * pTransit);
}

/** Applies a sequence of observations, oldest first. */
export function bktSequence(
  observations: readonly boolean[],
  params: BktParameters,
  startingFrom?: number,
): number {
  let pKnown = startingFrom ?? params.pInit;
  for (const correct of observations) {
    pKnown = bktUpdate(pKnown, correct, params);
  }
  return pKnown;
}

/**
 * CLO mastery as the exposure-weighted mean of its topics' mastery (§8.1).
 *
 * Weighting by exposure rather than taking a flat mean matters: a CLO with one
 * heavily-practised topic and four untouched ones should not read as 20 %
 * mastered when the student has demonstrably learned the part they were taught.
 */
export function cloMasteryFrom(
  topics: ReadonlyArray<{ pKnown: number; observations: number }>,
): number {
  if (topics.length === 0) return 0;

  const totalWeight = topics.reduce((sum, t) => sum + Math.max(t.observations, 0), 0);
  if (totalWeight === 0) {
    // No exposure anywhere — fall back to the unweighted mean of the priors so
    // the value is still defined rather than dividing by zero.
    return clamp01(topics.reduce((sum, t) => sum + t.pKnown, 0) / topics.length);
  }

  const weighted = topics.reduce(
    (sum, t) => sum + t.pKnown * Math.max(t.observations, 0),
    0,
  );
  return clamp01(weighted / totalWeight);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
