import { z } from "zod";
import { renderContext } from "@/intelligence/retrieval";
import type { RetrievalResult } from "@/intelligence/retrieval/types";

/**
 * AI co-teacher draft feedback (design.md §9.4, FR-TCH-050).
 *
 * Produces a DRAFT the teacher edits and explicitly releases. Nothing here is
 * ever shown to a student without that action.
 */

export const coteacherDraftSchema = z.object({
  whatIsCorrect: z.string().min(10).max(1200),
  whatIsMissing: z.string().min(10).max(1200),
  /** The misconception code if one is identifiable, else null. */
  misconceptionIfAny: z.string().nullable(),
  misconceptionExplanation: z.string().max(800).nullable(),
  /** Against the rubric's total, when a rubric was supplied. */
  suggestedScore: z.number().min(0),
  scoreRationale: z.string().min(10).max(800),
  nextStep: z.string().min(10).max(600),
  citedChunkIds: z.array(z.string()),
});

export type CoteacherDraft = z.infer<typeof coteacherDraftSchema>;

export function coteacherTaskBlock(): string {
  return `TASK — draft feedback on one student response, for a teacher to review.

You are writing FOR THE TEACHER, not for the student. The teacher will edit this and decide whether to send it. Be direct about what the response gets right and wrong; do not soften an assessment to be kind, and do not inflate a score.

whatIsCorrect            What the response actually gets right. Be specific — "understands the partition invariant" beats "shows good understanding". If very little is correct, say so plainly.

whatIsMissing            What a full-credit answer contains that this one does not. Point at the specific gap, not a general exhortation to "explain more".

misconceptionIfAny       If the error matches one of the supplied misconceptions, give its code. Use null when the response is simply incomplete rather than wrong, or when the error does not match a documented misconception — inventing a code that does not exist breaks the remediation link.

misconceptionExplanation When you name a misconception, explain how this specific response reveals it. Null otherwise.

suggestedScore           Against the rubric criteria supplied. Show your reasoning in scoreRationale, criterion by criterion. This is a suggestion for the teacher, not a mark.

nextStep                 One concrete thing this student should do next. A specific worked example, a particular concept to revisit — not "review the material".

citedChunkIds            The chunk_ids supporting your account of the correct answer.

Never address the student directly and never write in the second person: the teacher rewrites this before any student sees it.`;
}

export interface CoteacherRequest {
  stem: string;
  referenceAnswer: string | null;
  rubric: Array<{ criterion: string; points: number }> | null;
  studentResponse: string;
  misconceptions: Array<{ code: string; description: string; remediation: string }>;
  context: RetrievalResult[];
}

export function coteacherUserBlock(request: CoteacherRequest): string {
  const rubric = request.rubric
    ? request.rubric.map((r) => `- ${r.criterion} (${r.points} points)`).join("\n")
    : "(no rubric supplied — suggest a score out of 10)";

  const misconceptions =
    request.misconceptions.length > 0
      ? request.misconceptions.map((m) => `${m.code}: ${m.description}`).join("\n")
      : "(none recorded for this topic)";

  return `SOURCE MATERIAL
${renderContext(request.context)}

QUESTION
${request.stem}

REFERENCE ANSWER
${request.referenceAnswer ?? "(none recorded)"}

RUBRIC
${rubric}

KNOWN MISCONCEPTIONS
${misconceptions}

STUDENT RESPONSE
${request.studentResponse}

Draft the feedback now.`;
}
