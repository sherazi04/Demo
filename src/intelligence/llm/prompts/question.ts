import { z } from "zod";
import { bloomLabel } from "@/lib/utils";
import type { RetrievalResult } from "@/intelligence/retrieval/types";
import { renderContext } from "@/intelligence/retrieval";

/**
 * Assessment item generation (design.md §9.1).
 *
 * One schema serves both the model's structured output and runtime validation,
 * which is what stops the two drifting apart.
 */
export const questionSchema = z.object({
  type: z.enum(["mcq", "saq"]),
  stem: z.string().min(20),
  options: z
    .array(
      z.object({
        key: z.enum(["A", "B", "C", "D"]),
        text: z.string(),
        correct: z.boolean(),
        /** The misconception this distractor targets, or null for the key. */
        misconceptionCode: z.string().nullable(),
        rationale: z.string(),
      }),
    )
    .length(4)
    .optional(),
  referenceAnswer: z.string().optional(),
  rubric: z.array(z.object({ criterion: z.string(), points: z.number() })).optional(),
  explanation: z.string(),
  difficultyPrior: z.number().min(0).max(1),
  citedChunkIds: z.array(z.string()).min(1),
});

export type GeneratedQuestion = z.infer<typeof questionSchema>;

export interface QuestionRequest {
  type: "mcq" | "saq";
  cloCode: string;
  cloStatement: string;
  bloomLevel: number;
  topicCode: string;
  topicTitle: string;
  difficultyBand: [number, number];
  misconceptions: Array<{ code: string; description: string; remediation: string }>;
  context: RetrievalResult[];
  /** Stems already produced in this run, so the generator does not repeat itself. */
  avoidStems: string[];
}

/** system[2] — stable per item type, so it stays cacheable across a batch. */
export function questionTaskBlock(type: "mcq" | "saq"): string {
  const common = `TASK — write ONE assessment item.

Ground every factual claim in the provided source chunks and cite the chunk_id values you used in citedChunkIds. Do not introduce facts the sources do not support, even if you know them to be true — an unsupported claim fails the groundedness check regardless of its accuracy.

The item must demand exactly the requested Bloom level. An independent classifier will assess the level without being told what was requested; an item that sits at a different level is rejected. Pay attention to what the student must actually DO:
  · reciting a definition is Remember, however it is phrased
  · executing a stated procedure on given input is Apply
  · deciding WHICH procedure applies, or deriving a bound, is Analyse
  · judging between options against criteria is Evaluate

difficultyPrior is your estimate for a second-year undergraduate, 0 to 1. Be honest: the system calibrates against real responses later, and a prior that is uniformly 0.5 gives adaptive selection nothing to work with.`;

  if (type === "saq") {
    return `${common}

Produce a SHORT-ANSWER item:
  · stem: a question requiring a few sentences or a short derivation
  · referenceAnswer: what a full-credit answer contains
  · rubric: 2 to 4 criteria with point values, each independently checkable by a marker
  · explanation: why this answer is correct, grounded in the sources
  · omit options entirely`;
  }

  return `${common}

Produce a MULTIPLE-CHOICE item with exactly four options, A to D, exactly one correct.

Distractors are the substance of an MCQ, not padding. Each one must:
  · be selected by a student holding a specific, nameable misunderstanding
  · map to one of the supplied misconception codes wherever one fits — set misconceptionCode to that code, or null when no supplied misconception applies
  · be eliminable ONLY by understanding the content

Avoid these giveaway cues, which let a student answer without knowing anything:
  · making the correct option noticeably longer or more detailed than the others
  · absolutes ("always", "never") in distractors when the key is hedged
  · grammatical disagreement between the stem and any option
  · a distractor from an obviously different category
  · echoing the stem's exact wording in the key

Every option needs a rationale: for the key, why it is right; for each distractor, the specific reasoning error that leads there.`;
}

/** The volatile user turn — after the cache breakpoint. */
export function questionUserBlock(request: QuestionRequest): string {
  const misconceptions =
    request.misconceptions.length > 0
      ? request.misconceptions
          .map((m) => `${m.code}: ${m.description}`)
          .join("\n")
      : "(none recorded for this topic)";

  const avoid =
    request.avoidStems.length > 0
      ? `\n\nAlready written in this assessment — do not repeat or lightly reword these:\n${request.avoidStems
          .map((s, i) => `${i + 1}. ${s}`)
          .join("\n")}`
      : "";

  return `SOURCE MATERIAL
${renderContext(request.context)}

KNOWN MISCONCEPTIONS for ${request.topicCode} ${request.topicTitle}
${misconceptions}

REQUEST
Type:        ${request.type.toUpperCase()}
Outcome:     ${request.cloCode} — ${request.cloStatement}
Topic:       ${request.topicCode} ${request.topicTitle}
Bloom level: ${request.bloomLevel} (${bloomLabel(request.bloomLevel)})
Difficulty:  between ${request.difficultyBand[0]} and ${request.difficultyBand[1]}${avoid}

Write the item now.`;
}
