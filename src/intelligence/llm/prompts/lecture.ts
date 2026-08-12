import { z } from "zod";
import { renderContext } from "@/intelligence/retrieval";
import { bloomLabel } from "@/lib/utils";
import type { RetrievalResult } from "@/intelligence/retrieval/types";

/**
 * Lecture co-pilot (design.md §9.2, FR-TCH-010..013).
 */

export const ACTIVITY_TYPES = [
  "recall",
  "explain",
  "demo",
  "practice",
  "discuss",
  "assess",
] as const;

export const lectureSegmentSchema = z.object({
  title: z.string().min(3).max(160),
  minutes: z.number().int().min(2).max(60),
  bloomLevel: z.number().int().min(1).max(6),
  /** Must be a CLO code from the course context. */
  cloCode: z.string(),
  activityType: z.enum(ACTIVITY_TYPES),
  /** What is actually taught or done — the substance of the segment. */
  content: z.string().min(40),
  /** Delivery guidance for the instructor: timing, pitfalls, what to watch for. */
  instructorNotes: z.string().min(20),
  citedChunkIds: z.array(z.string()),
});

export const lecturePlanSchema = z.object({
  title: z.string().min(3).max(200),
  /** One or two sentences on where this session sits in the course. */
  framing: z.string().min(20).max(600),
  segments: z.array(lectureSegmentSchema).min(3).max(12),
  /** Misconceptions the instructor should expect to surface. */
  anticipatedMisconceptions: z.array(z.string()).max(6),
});

export type LecturePlan = z.infer<typeof lecturePlanSchema>;
export type LectureSegment = z.infer<typeof lectureSegmentSchema>;

/** system[2] — stable across every lecture request, so it stays cacheable. */
export function lectureTaskBlock(): string {
  return `TASK — design one time-boxed teaching session.

The session must ASCEND Bloom's taxonomy. Segment Bloom levels must be non-decreasing from first to last: open where students already are and build. A session that opens at Analyse has skipped the work that makes Analyse possible; a session that drops back to Remember after reaching Apply has lost the thread.

A typical arc: recall prior knowledge (1-2) → explain the new idea (2) → demonstrate it (3) → have students practise it (3-4) → check understanding (at the level just taught).

At least one segment MUST have activityType "assess": a formative check for understanding, aligned to the target outcome. This is not a summative quiz — it is the instructor finding out, mid-session, whether the class is with them. Say what the check is and what response would indicate a problem.

activityType meanings:
  recall    activating prior knowledge the new material depends on
  explain   instructor-led exposition of a new idea
  demo      working an example in front of the class
  practice  students working, individually or in pairs
  discuss   structured discussion or peer instruction
  assess    formative check for understanding

For every segment:
  · minutes must sum to approximately the requested duration
  · cloCode must be one of the course's CLO codes
  · bloomLevel must not exceed the ceiling of the CLO you name
  · content must be grounded in the provided sources, and citedChunkIds must list the chunk_id values you used
  · instructorNotes must be genuinely useful to someone delivering this: where students stall, what to emphasise, what a wrong answer will look like

Do not pad to fill the time. If the material supports 60 minutes of substance, produce 60 minutes and say so in the framing rather than inventing filler.`;
}

export interface LectureRequest {
  topicCode: string;
  topicTitle: string;
  topicSummary: string;
  durationMinutes: number;
  clos: Array<{ code: string; statement: string; bloomLevel: number }>;
  prerequisiteTitles: string[];
  misconceptions: Array<{ code: string; description: string; remediation: string }>;
  context: RetrievalResult[];
  /** Set on a regeneration attempt after an assertion failed. */
  correction?: string;
}

export function lectureUserBlock(request: LectureRequest): string {
  const clos = request.clos
    .map((c) => `${c.code} (ceiling Bloom ${c.bloomLevel} — ${bloomLabel(c.bloomLevel)}): ${c.statement}`)
    .join("\n");

  const prereqs =
    request.prerequisiteTitles.length > 0
      ? request.prerequisiteTitles.join(", ")
      : "(none recorded)";

  const misconceptions =
    request.misconceptions.length > 0
      ? request.misconceptions.map((m) => `${m.code}: ${m.description}`).join("\n")
      : "(none recorded)";

  const correction = request.correction
    ? `\n\nCORRECTION REQUIRED — your previous attempt was rejected:\n${request.correction}\nProduce a corrected plan.`
    : "";

  return `SOURCE MATERIAL
${renderContext(request.context)}

SESSION
Topic:      ${request.topicCode} ${request.topicTitle}
Summary:    ${request.topicSummary}
Duration:   ${request.durationMinutes} minutes
Prerequisites students should already hold: ${prereqs}

OUTCOMES this session serves
${clos}

MISCONCEPTIONS commonly held on this topic
${misconceptions}

Design the session now.${correction}`;
}
