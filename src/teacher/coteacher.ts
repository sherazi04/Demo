import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { attemptItems, attempts, misconceptions, questions, topics } from "@/db/schema";
import { loadCourseContext } from "@/curriculum/context";
import { assemblePrompt } from "@/intelligence/llm/prompts/shared";
import {
  coteacherDraftSchema,
  coteacherTaskBlock,
  coteacherUserBlock,
  type CoteacherDraft,
} from "@/intelligence/llm/prompts/coteacher";
import { callStructured } from "@/intelligence/llm/router";
import { retrieve } from "@/intelligence/retrieval";
import { append } from "@/governance/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { newCorrelationId } from "@/lib/ids";
import type { AuthedUser } from "@/auth/guard";

/**
 * AI co-teacher (FR-TCH-050..052).
 *
 * Drafting and releasing are two separate operations, and there is no code path
 * that does both: `draftFeedback` writes to `attempt_items.feedback` with
 * `released: false`, and only `releaseFeedback` — an explicit teacher action —
 * flips that flag. Feedback is never auto-sent (FR-TCH-052).
 */

export const draftRequestSchema = z.object({
  attemptItemId: z.string().uuid(),
});

export const releaseRequestSchema = z.object({
  attemptItemId: z.string().uuid(),
  /** The teacher's edited text — what the student actually receives. */
  edited: z.object({
    whatIsCorrect: z.string().min(1),
    whatIsMissing: z.string().min(1),
    nextStep: z.string().min(1),
    suggestedScore: z.number().min(0).optional(),
  }),
});

/** What is stored on `attempt_items.feedback` for a co-teacher draft. */
export interface StoredCoteacherFeedback extends Record<string, unknown> {
  kind: "coteacher";
  draft: CoteacherDraft;
  /** False until a teacher explicitly releases it. */
  released: boolean;
  releasedAt: string | null;
  releasedBy: string | null;
  /** Present once released — the teacher's edited version. */
  edited: {
    whatIsCorrect: string;
    whatIsMissing: string;
    nextStep: string;
    suggestedScore?: number;
  } | null;
  model: string;
  draftedAt: string;
}

export async function draftFeedback(
  actor: AuthedUser,
  attemptItemId: string,
): Promise<{ draft: CoteacherDraft; model: string }> {
  const correlationId = newCorrelationId();

  const [row] = await db
    .select({
      attemptItemId: attemptItems.id,
      response: attemptItems.response,
      questionId: questions.id,
      stem: questions.stem,
      referenceAnswer: questions.referenceAnswer,
      rubric: questions.rubric,
      topicId: questions.topicId,
      courseId: questions.courseId,
      cloId: questions.cloId,
    })
    .from(attemptItems)
    .innerJoin(questions, eq(questions.id, attemptItems.questionId))
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .where(eq(attemptItems.id, attemptItemId))
    .limit(1);

  if (!row) throw new NotFoundError("Attempt item");
  if (!row.response || row.response.trim().length === 0) {
    throw new ConflictError("This item has no student response to give feedback on.");
  }

  const [topic] = await db
    .select({ title: topics.title, summary: topics.summary })
    .from(topics)
    .where(eq(topics.id, row.topicId))
    .limit(1);

  const misconceptionRows = await db
    .select({
      code: misconceptions.code,
      description: misconceptions.description,
      remediation: misconceptions.remediation,
    })
    .from(misconceptions)
    .where(eq(misconceptions.topicId, row.topicId));

  const retrieval = await retrieve(
    `${row.stem} ${topic?.title ?? ""}`,
    { courseId: row.courseId, topicIds: [row.topicId], cloIds: [row.cloId] },
    { finalK: 6 },
  );

  const courseContext = await loadCourseContext(row.courseId);
  const { system } = assemblePrompt(courseContext, coteacherTaskBlock());

  const result = await callStructured(coteacherDraftSchema, {
    tier: "generation",
    system,
    user: coteacherUserBlock({
      stem: row.stem,
      referenceAnswer: row.referenceAnswer,
      rubric: row.rubric,
      // The student's own words go to the model, but no identifier does —
      // nothing here carries a name or an id (NFR-SEC-006).
      studentResponse: row.response,
      misconceptions: misconceptionRows,
      context: retrieval.results,
    }),
    auditAction: "coteacher.draft",
    resourceType: "attempt_item",
    resourceId: attemptItemId,
    retrievedChunkIds: retrieval.results.map((r) => r.id),
    correlationId,
    actorId: actor.id,
    actorRole: actor.role,
  });

  if (result.refused || !result.data) {
    throw new Error(
      result.refused
        ? `The model declined to draft feedback: ${result.refusalReason ?? "no reason given"}`
        : "The model returned no usable draft.",
    );
  }

  const stored: StoredCoteacherFeedback = {
    kind: "coteacher",
    draft: result.data,
    released: false,
    releasedAt: null,
    releasedBy: null,
    edited: null,
    model: result.model,
    draftedAt: new Date().toISOString(),
  };

  await db
    .update(attemptItems)
    .set({ feedback: stored })
    .where(eq(attemptItems.id, attemptItemId));

  return { draft: result.data, model: result.model };
}

/**
 * Releases edited feedback to the student. The release is itself audited
 * (FR-TCH-052, FR-GOV-006) — it is a human decision about what a student sees.
 */
export async function releaseFeedback(
  actor: AuthedUser,
  attemptItemId: string,
  edited: z.infer<typeof releaseRequestSchema>["edited"],
): Promise<void> {
  const [row] = await db
    .select({ feedback: attemptItems.feedback })
    .from(attemptItems)
    .where(eq(attemptItems.id, attemptItemId))
    .limit(1);
  if (!row) throw new NotFoundError("Attempt item");

  const existing = row.feedback as StoredCoteacherFeedback | null;
  if (!existing || existing.kind !== "coteacher") {
    throw new ConflictError("There is no co-teacher draft on this item to release.");
  }
  if (existing.released) {
    throw new ConflictError("This feedback has already been released.");
  }

  const updated: StoredCoteacherFeedback = {
    ...existing,
    released: true,
    releasedAt: new Date().toISOString(),
    releasedBy: actor.id,
    edited,
  };

  await db
    .update(attemptItems)
    .set({ feedback: updated })
    .where(eq(attemptItems.id, attemptItemId));

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "coteacher.release",
    resourceType: "attempt_item",
    resourceId: attemptItemId,
    payload: {
      // Whether the teacher changed the draft is worth recording: it is the
      // evidence that review is real rather than a rubber stamp.
      editedFromDraft:
        edited.whatIsCorrect !== existing.draft.whatIsCorrect ||
        edited.whatIsMissing !== existing.draft.whatIsMissing ||
        edited.nextStep !== existing.draft.nextStep,
      model: existing.model,
    },
  });
}

/** Responses awaiting a co-teacher draft or release. */
export async function feedbackQueue(courseId: string, limit = 30) {
  return db
    .select({
      attemptItemId: attemptItems.id,
      response: attemptItems.response,
      correct: attemptItems.correct,
      answeredAt: attemptItems.answeredAt,
      feedback: attemptItems.feedback,
      stem: questions.stem,
      questionType: questions.type,
      referenceAnswer: questions.referenceAnswer,
      rubric: questions.rubric,
    })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .innerJoin(questions, eq(questions.id, attemptItems.questionId))
    // Only free-text items need co-teacher feedback; an MCQ gets automated
    // misconception feedback from the student engine instead.
    .where(
      and(
        eq(attempts.courseId, courseId),
        eq(questions.type, "saq"),
        isNotNull(attemptItems.answeredAt),
      ),
    )
    .orderBy(attemptItems.answeredAt)
    .limit(limit);
}
