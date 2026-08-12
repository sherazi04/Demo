import { describe, expect, it } from "vitest";
import {
  bktSequence,
  bktUpdate,
  cloMasteryFrom,
  guessRateFor,
  DEFAULT_BKT,
  type BktParameters,
} from "@/student/bkt";
import { calibrationConfidence, eloUpdate, expectedScore, DEFAULT_ELO } from "@/student/elo";
import {
  bloomCap,
  selectNext,
  scoreCandidate,
  shouldTerminate,
  targetDifficulty,
  type CandidateItem,
  type SelectionState,
} from "@/student/adaptive";

const MCQ: BktParameters = { ...DEFAULT_BKT, pGuess: 0.25 };
const SAQ: BktParameters = { ...DEFAULT_BKT, pGuess: 0.05 };

describe("guessRateFor", () => {
  it("derives the MCQ rate from the option count", () => {
    expect(guessRateFor("mcq", 4)).toBeCloseTo(0.25);
    expect(guessRateFor("mcq", 5)).toBeCloseTo(0.2);
  });

  it("gives a short answer a far lower guess rate than an MCQ", () => {
    // Sharing one rate would make a correct SAQ count for much less evidence
    // than it deserves.
    expect(guessRateFor("saq")).toBeLessThan(guessRateFor("mcq", 4));
  });
});

describe("bktUpdate", () => {
  it("raises mastery on a correct answer", () => {
    expect(bktUpdate(0.3, true, MCQ)).toBeGreaterThan(0.3);
  });

  it("lowers the posterior on an incorrect answer", () => {
    // pL' can still exceed the prior via pTransit, so compare the posterior
    // itself by using a zero-transit parameter set.
    const noTransit = { ...MCQ, pTransit: 0 };
    expect(bktUpdate(0.6, false, noTransit)).toBeLessThan(0.6);
  });

  it("keeps mastery within [0,1]", () => {
    for (const prior of [0, 0.5, 1]) {
      for (const correct of [true, false]) {
        const result = bktUpdate(prior, correct, MCQ);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }
    }
  });

  it("treats a correct SAQ as stronger evidence than a correct MCQ", () => {
    // A right answer that could not have been guessed says more.
    expect(bktUpdate(0.3, true, SAQ)).toBeGreaterThan(bktUpdate(0.3, true, MCQ));
  });

  it("can raise mastery slightly even on a wrong answer, via pTransit", () => {
    // The student may have learned from the opportunity; that is what pTransit
    // models, and it is why a single wrong answer is not catastrophic.
    const veryLow = bktUpdate(0.02, false, MCQ);
    expect(veryLow).toBeGreaterThan(0);
  });

  it("does not divide by zero on degenerate parameters", () => {
    const degenerate: BktParameters = { pInit: 0, pTransit: 0, pSlip: 0, pGuess: 0 };
    expect(Number.isFinite(bktUpdate(0, true, degenerate))).toBe(true);
    expect(Number.isFinite(bktUpdate(0, false, degenerate))).toBe(true);
  });

  it("converges upward under a run of correct answers", () => {
    const after = bktSequence([true, true, true, true, true, true], MCQ);
    expect(after).toBeGreaterThan(0.85);
  });

  it("stays low under a run of wrong answers", () => {
    const after = bktSequence([false, false, false, false, false], MCQ);
    expect(after).toBeLessThan(0.3);
  });

  it("is order-sensitive: recent evidence moves the estimate more", () => {
    const upThenDown = bktSequence([true, true, false], MCQ);
    const downThenUp = bktSequence([false, true, true], MCQ);
    expect(upThenDown).not.toBeCloseTo(downThenUp, 5);
  });
});

describe("cloMasteryFrom", () => {
  it("returns zero for no topics", () => {
    expect(cloMasteryFrom([])).toBe(0);
  });

  it("weights by exposure rather than taking a flat mean", () => {
    const topics = [
      { pKnown: 0.9, observations: 20 },
      { pKnown: 0.1, observations: 0 },
    ];
    // A flat mean would report 0.5 and understate what the student has shown.
    expect(cloMasteryFrom(topics)).toBeCloseTo(0.9, 5);
  });

  it("falls back to the unweighted mean when nothing has been attempted", () => {
    const topics = [
      { pKnown: 0.2, observations: 0 },
      { pKnown: 0.4, observations: 0 },
    ];
    expect(cloMasteryFrom(topics)).toBeCloseTo(0.3, 5);
  });
});

describe("expectedScore", () => {
  it("is 0.5 when ability equals difficulty", () => {
    expect(expectedScore(0.5, 0.5)).toBeCloseTo(0.5, 10);
  });

  it("rises as ability exceeds difficulty", () => {
    expect(expectedScore(0.9, 0.3)).toBeGreaterThan(0.9);
    expect(expectedScore(0.1, 0.8)).toBeLessThan(0.1);
  });
});

describe("eloUpdate", () => {
  /** The sign convention is the thing most easily got backwards. */
  it("makes an item EASIER when a student answers it correctly", () => {
    expect(eloUpdate(0.5, 0.5, true, 0)).toBeLessThan(0.5);
  });

  it("makes an item HARDER when a student answers it incorrectly", () => {
    expect(eloUpdate(0.5, 0.5, false, 0)).toBeGreaterThan(0.5);
  });

  it("moves less once the item is well served", () => {
    const early = Math.abs(eloUpdate(0.5, 0.5, true, 0) - 0.5);
    const late = Math.abs(eloUpdate(0.5, 0.5, true, 100) - 0.5);
    expect(late).toBeLessThan(early);
  });

  it("moves less when the outcome was expected", () => {
    // A strong student answering an easy item correctly is barely evidence.
    const expectedOutcome = Math.abs(eloUpdate(0.2, 0.95, true, 0) - 0.2);
    const surprising = Math.abs(eloUpdate(0.8, 0.1, true, 0) - 0.8);
    expect(expectedOutcome).toBeLessThan(surprising);
  });

  it("stays within [0,1] under repeated extreme updates", () => {
    let difficulty = 0.5;
    for (let i = 0; i < 500; i += 1) difficulty = eloUpdate(difficulty, 1, true, i);
    expect(difficulty).toBeGreaterThanOrEqual(0);

    difficulty = 0.5;
    for (let i = 0; i < 500; i += 1) difficulty = eloUpdate(difficulty, 0, false, i);
    expect(difficulty).toBeLessThanOrEqual(1);
  });

  it("labels calibration honestly by response count", () => {
    expect(calibrationConfidence(0).level).toBe("prior");
    expect(calibrationConfidence(5).level).toBe("provisional");
    expect(calibrationConfidence(DEFAULT_ELO.servedSwitch).level).toBe("calibrated");
    // Never described as IRT anywhere in the surfaced label.
    expect(calibrationConfidence(50).label.toLowerCase()).not.toContain("irt");
  });
});

describe("targetDifficulty and bloomCap", () => {
  it("targets slightly above current ability", () => {
    expect(targetDifficulty(0.5)).toBeCloseTo(0.55, 5);
  });

  it("clamps to a sane band at both extremes", () => {
    expect(targetDifficulty(0)).toBeCloseTo(0.15, 5);
    expect(targetDifficulty(1)).toBeCloseTo(0.9, 5);
  });

  it("raises the Bloom cap as mastery rises", () => {
    expect(bloomCap(0, 6)).toBe(1);
    expect(bloomCap(0.5, 6)).toBe(3);
    expect(bloomCap(1, 6)).toBe(6);
  });

  it("never exceeds the CLO's own ceiling however high mastery is", () => {
    expect(bloomCap(1, 2)).toBe(2);
    expect(bloomCap(0.99, 3)).toBe(3);
  });
});

describe("selectNext", () => {
  const item = (overrides: Partial<CandidateItem> & { id: string }): CandidateItem => ({
    topicId: "t1",
    targetBloom: 2,
    difficultyElo: 0.5,
    timesServed: 0,
    misconceptionCodes: [],
    ...overrides,
  });

  const state = (overrides: Partial<SelectionState> = {}): SelectionState => ({
    pKnown: 0.5,
    recentlyServedIds: [],
    answeredInRunIds: [],
    recentMisconceptionCodes: [],
    cloBloomCeiling: 6,
    meanExposure: 1,
    ...overrides,
  });

  it("returns null when nothing is eligible", () => {
    expect(selectNext([], state())).toBeNull();
  });

  it("prefers the item closest to the target difficulty", () => {
    const chosen = selectNext(
      [
        item({ id: "far", difficultyElo: 0.1 }),
        item({ id: "near", difficultyElo: 0.55 }),
        item({ id: "high", difficultyElo: 0.95 }),
      ],
      state({ pKnown: 0.5 }),
      () => 0,
    );
    expect(chosen?.item.id).toBe("near");
  });

  it("excludes items above the Bloom cap", () => {
    const chosen = selectNext(
      [item({ id: "too-high", targetBloom: 6, difficultyElo: 0.55 })],
      state({ pKnown: 0.1 }),
      () => 0,
    );
    expect(chosen).toBeNull();
  });

  it("never serves above the CLO ceiling even at full mastery", () => {
    const chosen = selectNext(
      [item({ id: "above-ceiling", targetBloom: 5, difficultyElo: 0.9 })],
      state({ pKnown: 1, cloBloomCeiling: 3 }),
      () => 0,
    );
    expect(chosen).toBeNull();
  });

  it("never repeats an item already answered in this run", () => {
    const chosen = selectNext(
      [item({ id: "seen", difficultyElo: 0.55 })],
      state({ answeredInRunIds: ["seen"] }),
      () => 0,
    );
    expect(chosen).toBeNull();
  });

  it("deprioritises a recently served item without excluding it", () => {
    const only = selectNext(
      [item({ id: "recent", difficultyElo: 0.55 })],
      state({ recentlyServedIds: ["recent"] }),
      () => 0,
    );
    // Still served when it is the only option — a thin bank must not stall.
    expect(only?.item.id).toBe("recent");

    const withAlternative = selectNext(
      [item({ id: "recent", difficultyElo: 0.55 }), item({ id: "fresh", difficultyElo: 0.6 })],
      state({ recentlyServedIds: ["recent"] }),
      () => 0,
    );
    expect(withAlternative?.item.id).toBe("fresh");
  });

  it("spreads exposure across the bank", () => {
    const chosen = selectNext(
      [
        item({ id: "overused", difficultyElo: 0.55, timesServed: 50 }),
        item({ id: "fresh", difficultyElo: 0.58, timesServed: 0 }),
      ],
      state({ meanExposure: 10 }),
      () => 0,
    );
    expect(chosen?.item.id).toBe("fresh");
  });

  it("boosts items targeting a misconception the student recently triggered", () => {
    const chosen = selectNext(
      [
        item({ id: "generic", difficultyElo: 0.55 }),
        item({ id: "targeted", difficultyElo: 0.62, misconceptionCodes: ["MC-T22-1"] }),
      ],
      state({ recentMisconceptionCodes: ["MC-T22-1"] }),
      () => 0,
    );
    expect(chosen?.item.id).toBe("targeted");
  });

  it("exposes the score breakdown so a choice can be explained", () => {
    const scored = scoreCandidate(
      item({ id: "x", difficultyElo: 0.55, timesServed: 5, misconceptionCodes: ["M1"] }),
      state({ recentMisconceptionCodes: ["M1"], meanExposure: 5 }),
      0.55,
    );
    expect(scored.breakdown.difficultyFit).toBeCloseTo(0, 5);
    expect(scored.breakdown.exposurePenalty).toBeLessThan(0);
    expect(scored.breakdown.misconceptionBoost).toBeGreaterThan(0);
  });

  /** The demo's step 9: difficulty visibly rises after a correct streak. */
  it("serves harder items as mastery rises", () => {
    const bank = [
      item({ id: "easy", difficultyElo: 0.2, targetBloom: 1 }),
      item({ id: "medium", difficultyElo: 0.5, targetBloom: 2 }),
      item({ id: "hard", difficultyElo: 0.85, targetBloom: 3 }),
    ];
    const low = selectNext(bank, state({ pKnown: 0.1 }), () => 0);
    const high = selectNext(bank, state({ pKnown: 0.8 }), () => 0);

    expect(low?.item.id).toBe("easy");
    expect(high?.item.id).toBe("hard");
    expect(high?.item.difficultyElo).toBeGreaterThan(low?.item.difficultyElo ?? 1);
  });
});

describe("shouldTerminate", () => {
  const base = {
    itemsAnswered: 3,
    itemsPlanned: 10,
    pKnown: 0.5,
    masteryThreshold: 0.85,
    recentResults: [] as boolean[],
  };

  it("continues mid-run", () => {
    expect(shouldTerminate(base)).toBeNull();
  });

  it("stops when the planned count is reached", () => {
    expect(shouldTerminate({ ...base, itemsAnswered: 10 })).toBe("count");
  });

  it("stops on sustained mastery: three consecutive correct AND a high estimate", () => {
    expect(
      shouldTerminate({ ...base, pKnown: 0.9, recentResults: [true, true, true] }),
    ).toBe("mastery");
  });

  it("does not stop on three correct answers at low mastery", () => {
    // A lucky streak on easy items is not mastery.
    expect(
      shouldTerminate({ ...base, pKnown: 0.4, recentResults: [true, true, true] }),
    ).toBeNull();
  });

  it("does not stop on high mastery without the sustained streak", () => {
    expect(
      shouldTerminate({ ...base, pKnown: 0.95, recentResults: [true, false, true] }),
    ).toBeNull();
  });
});
