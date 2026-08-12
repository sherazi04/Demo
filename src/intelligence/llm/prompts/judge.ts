import { z } from "zod";

/**
 * Judge-tier prompts (design.md §7).
 *
 * These are SEPARATE CALLS with SEPARATE PROMPTS from the generator
 * (FR-INT-052). A generator asked to check its own work in the same call
 * agrees with itself; that is not validation, it is a formality. Each judge
 * below is given the minimum context needed for its own question and nothing
 * more — most importantly, the Bloom classifier is never told what level was
 * requested.
 */

/* ── bloom_match ─────────────────────────────────────────────────────────── */

export const bloomVerdictSchema = z.object({
  measuredBloom: z.number().int().min(1).max(6),
  /** The cognitive operation the student must perform, in the judge's words. */
  cognitiveDemand: z.string().max(400),
  confidence: z.number().min(0).max(1),
  justification: z.string().max(600),
});

/**
 * CRITICAL: the requested level is deliberately absent from this prompt. If the
 * classifier knows the target it will rationalise toward it, and `bloom_match`
 * stops being an independent measurement.
 */
export function bloomJudgePrompt(item: {
  stem: string;
  options?: Array<{ key: string; text: string }>;
  referenceAnswer?: string | null;
}): { system: string; user: string } {
  const system = `You classify the cognitive demand of assessment items using Bloom's revised taxonomy.

1 Remember   — retrieve a fact, term or definition from memory.
2 Understand — explain, interpret, summarise, classify, or compare in one's own words.
3 Apply      — execute a known procedure on a new but similar case; trace an algorithm; compute using a given method.
4 Analyse    — decompose, derive, distinguish, or examine relationships; work out *which* method applies and why.
5 Evaluate   — judge against criteria, justify a choice, critique a trade-off.
6 Create     — design or synthesise something new.

Judge the work the student must actually do to answer correctly, not the verb the question uses. A question that says "analyse" but can be answered by recalling a memorised fact is level 1. A question that says "compute" but requires deriving the method first is level 4.

For a multiple-choice item, consider what a student must do to eliminate the distractors, not merely to recognise the key.

Report the level you measure. Do not speculate about what level was intended.`;

  const options = item.options
    ? `\n\nOptions:\n${item.options.map((o) => `${o.key}. ${o.text}`).join("\n")}`
    : "";
  const answer = item.referenceAnswer
    ? `\n\nReference answer:\n${item.referenceAnswer}`
    : "";

  return {
    system,
    user: `Classify this assessment item.\n\nStem:\n${item.stem}${options}${answer}`,
  };
}

/* ── clo_alignment ───────────────────────────────────────────────────────── */

export const cloAlignmentVerdictSchema = z.object({
  assessesClo: z.boolean(),
  /** 0–1: how squarely the item assesses this specific outcome. */
  alignmentScore: z.number().min(0).max(1),
  justification: z.string().max(600),
  /** What the item actually assesses, when it is not the target CLO. */
  actuallyAssesses: z.string().max(300).nullable(),
});

export function cloAlignmentJudgePrompt(input: {
  cloCode: string;
  cloStatement: string;
  cloBloomLevel: number;
  topicTitle: string;
  stem: string;
  options?: Array<{ key: string; text: string }>;
}): { system: string; user: string } {
  const system = `You judge whether an assessment item genuinely assesses a stated Course Learning Outcome.

An item aligns with a CLO when answering it correctly requires the specific capability the CLO describes. Being merely *about the same subject matter* is not alignment: an outcome about analysing complexity is not assessed by an item that asks the student to recall which sort is fastest.

Score strictly:
  1.0  answering correctly requires exactly the capability the CLO names
  0.7  requires that capability alongside other unrelated work
  0.4  touches the topic but exercises a different capability
  0.0  unrelated, or assesses a capability the CLO does not mention

Where the item does not align, say what it actually assesses.`;

  const options = input.options
    ? `\n\nOptions:\n${input.options.map((o) => `${o.key}. ${o.text}`).join("\n")}`
    : "";

  return {
    system,
    user: `Target outcome ${input.cloCode} (Bloom ${input.cloBloomLevel}):
${input.cloStatement}

Nominal topic: ${input.topicTitle}

Item stem:
${input.stem}${options}

Does answering this item correctly require the capability ${input.cloCode} describes?`,
  };
}

/* ── groundedness ────────────────────────────────────────────────────────── */

export const groundednessVerdictSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string().max(400),
      supported: z.boolean(),
      /** The chunk id that supports it, or null when nothing does. */
      supportingChunkId: z.string().nullable(),
      note: z.string().max(300),
    }),
  ),
  allSupported: z.boolean(),
  unsupportedCount: z.number().int().min(0),
});

/**
 * The judge sees the item and ONLY the source chunks — no course context, no
 * curriculum, no general knowledge licence. Anything it cannot map to a chunk
 * id is unsupported by definition, which is the whole point.
 */
export function groundednessJudgePrompt(input: {
  stem: string;
  options?: Array<{ key: string; text: string; rationale: string }>;
  explanation: string;
  chunks: Array<{ id: string; text: string }>;
}): { system: string; user: string } {
  const system = `You verify that every factual claim in an assessment item is supported by the provided source material.

You have ONLY the sources below. You must not use outside knowledge, and you must not treat a claim as supported because it is true in general — the question is solely whether THESE sources support it.

For each distinct factual claim in the item (the stem, each option rationale, and the explanation):
  · state the claim
  · say whether the sources support it
  · give the chunk_id that supports it, or null

A claim is supported only when a source chunk states it or entails it directly. "Related to" is not "supports". Definitional or arithmetic steps that follow from a supported claim count as supported; new facts do not.`;

  const sources = input.chunks
    .map((c) => `chunk_id: ${c.id}\n${c.text}`)
    .join("\n\n---\n\n");

  const options = input.options
    ? `\n\nOptions and rationales:\n${input.options
        .map((o) => `${o.key}. ${o.text}\n   rationale: ${o.rationale}`)
        .join("\n")}`
    : "";

  return {
    system,
    user: `SOURCES
${sources}

ITEM
Stem: ${input.stem}${options}

Explanation: ${input.explanation}

Check every factual claim against the sources above.`,
  };
}

/* ── single_answer ───────────────────────────────────────────────────────── */

export const singleAnswerVerdictSchema = z.object({
  evaluations: z.array(
    z.object({
      key: z.string(),
      defensiblyCorrect: z.boolean(),
      reasoning: z.string().max(400),
    }),
  ),
  defensibleCount: z.number().int().min(0),
});

/**
 * Each option is judged on its own merits. Asking "which one is right?" invites
 * the model to pick exactly one regardless — the failure mode this check exists
 * to catch is precisely an item with two defensible answers.
 */
export function singleAnswerJudgePrompt(input: {
  stem: string;
  options: Array<{ key: string; text: string }>;
}): { system: string; user: string } {
  const system = `You evaluate each option of a multiple-choice item independently.

For EACH option, decide: could a well-prepared student defend this as a correct answer to the stem as written? Judge each option on its own merits. Do not assume exactly one is correct, and do not compare options against each other to find "the best" — a well-formed item has exactly one defensible option, and finding two or zero is a real and important outcome.

Consider ambiguity in the stem: if the stem is loose enough that two options both satisfy it, both are defensible.`;

  return {
    system,
    user: `Stem: ${input.stem}

Options:
${input.options.map((o) => `${o.key}. ${o.text}`).join("\n")}

Evaluate every option independently.`,
  };
}

/* ── distractor_quality ──────────────────────────────────────────────────── */

export const distractorVerdictSchema = z.object({
  distractors: z.array(
    z.object({
      key: z.string(),
      plausible: z.boolean(),
      /** True when the option is eliminable without understanding the content. */
      giveaway: z.boolean(),
      giveawayReason: z.string().max(300).nullable(),
      mapsToMisconception: z.boolean(),
      quality: z.number().min(0).max(1),
    }),
  ),
  meanQuality: z.number().min(0).max(1),
});

export function distractorJudgePrompt(input: {
  stem: string;
  options: Array<{ key: string; text: string; correct: boolean; misconceptionCode: string | null }>;
  misconceptions: Array<{ code: string; description: string }>;
}): { system: string; user: string } {
  const system = `You rate the quality of the incorrect options (distractors) in a multiple-choice item.

For each distractor assess:

plausible   Would a student who holds a genuine misunderstanding select it? A distractor that no one would ever pick tests nothing and effectively shortens the item.

giveaway    Can it be eliminated WITHOUT understanding the content? Common giveaway cues:
            · noticeably longer or shorter than the other options
            · absolutes ("always", "never") where the others are hedged
            · grammatical disagreement with the stem
            · a category error obvious from the wording alone
            · repeating the stem's phrasing verbatim

mapsToMisconception  Does it correspond to one of the named misconceptions supplied below? A distractor anchored to a documented misconception is worth more than a merely plausible one, because it turns a wrong answer into a diagnosis.

quality     0 to 1 overall.

Judge only the distractors, not the correct option.`;

  const misconceptions = input.misconceptions
    .map((m) => `${m.code}: ${m.description}`)
    .join("\n");

  return {
    system,
    user: `Stem: ${input.stem}

Options (the correct one is marked):
${input.options
  .map(
    (o) =>
      `${o.key}. ${o.text}${o.correct ? "  [CORRECT]" : ""}${
        o.misconceptionCode ? `  [claims misconception ${o.misconceptionCode}]` : ""
      }`,
  )
  .join("\n")}

Known misconceptions for this topic:
${misconceptions || "(none recorded)"}

Rate each distractor.`,
  };
}
