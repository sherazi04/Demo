import { z } from "zod";
import { renderContext } from "@/intelligence/retrieval";
import type { RetrievalResult } from "@/intelligence/retrieval/types";

/**
 * Adaptive feedback on an incorrect response (design.md §8.4,
 * FR-STU-010..014).
 *
 * The structure is fixed rather than free prose because each part serves a
 * distinct purpose, and "you are incorrect, the answer is B" — which is what a
 * free-form prompt tends to produce — teaches nothing.
 */
export const feedbackSchema = z.object({
  /** What the student's reasoning appears to have been. */
  likelyReasoning: z.string().min(20).max(600),
  /** The exact point at which that reasoning breaks down. */
  whereItFails: z.string().min(20).max(700),
  /** The correct reasoning path, worked through. */
  correctReasoning: z.string().min(30).max(1000),
  /** One concrete next action. */
  nextStep: z.string().min(10).max(400),
  citedChunkIds: z.array(z.string()).min(1),
});

export type GeneratedFeedback = z.infer<typeof feedbackSchema>;

export function feedbackTaskBlock(): string {
  return `TASK — explain one incorrect answer to the student who gave it.

Write TO THE STUDENT, in the second person. Be direct and warm; do not be cheerful about a wrong answer, and do not soften it into vagueness.

likelyReasoning   Reconstruct the thinking that leads to the option they chose. You will be told which misconception that option targets — start from it. Say "you have probably..." rather than asserting you know their mind. This must describe a specific, plausible line of reasoning, not "you may have been confused".

whereItFails      The precise step where that reasoning breaks. Not "this is wrong" — the exact inference that does not hold, and why. This is the sentence the student will remember, so make it carry the weight.

correctReasoning  The correct path from the question to the answer. Work it through; do not just assert the conclusion. Ground it in the sources.

nextStep          One concrete thing to do next: a specific worked example to study, a particular idea to revisit. Not "review the material".

citedChunkIds     The chunk_ids your correct reasoning rests on.

NEVER mention, describe, or hint at any other question — including ones you have not been shown. Feedback must not reveal answers to items the student has not yet seen.

Do not restate the question back before answering. Do not congratulate.`;
}

export interface FeedbackRequest {
  stem: string;
  options: Array<{ key: string; text: string; correct: boolean }>;
  chosenKey: string;
  correctKey: string;
  /** The misconception the chosen distractor targets, when there is one. */
  misconception: { code: string; description: string; remediation: string } | null;
  explanation: string;
  context: RetrievalResult[];
  /** Times this student has hit this misconception, including now. */
  hitCount: number;
}

export function feedbackUserBlock(request: FeedbackRequest): string {
  const options = request.options
    .map((o) => `${o.key}. ${o.text}${o.key === request.chosenKey ? "   ← the student chose this" : ""}${o.correct ? "   [correct answer]" : ""}`)
    .join("\n");

  const misconception = request.misconception
    ? `${request.misconception.code}: ${request.misconception.description}\nStandard remediation: ${request.misconception.remediation}`
    : "(the chosen option does not map to a documented misconception — reconstruct the likely reasoning yourself)";

  const repeat =
    request.hitCount >= 3
      ? `\n\nThis student has now made this same error ${request.hitCount} times. Address it more fundamentally than a one-line correction: something about their mental model is not being reached by the usual explanation.`
      : "";

  return `SOURCE MATERIAL
${renderContext(request.context)}

QUESTION
${request.stem}

OPTIONS
${options}

MISCONCEPTION TARGETED BY THEIR CHOICE
${misconception}

REFERENCE EXPLANATION
${request.explanation}

Write the feedback now.${repeat}`;
}
