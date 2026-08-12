import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clos, questions, topics } from "@/db/schema";
import { append } from "@/governance/audit";
import { assertApprovable } from "@/validation/engine";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { AuthedUser } from "@/auth/guard";

/**
 * The reusable item bank (FR-TCH-006, FR-TCH-007).
 *
 * Rejected items are first-class rows here, not hidden: the bank view lists
 * them beside accepted ones with their failure reasons (FR-VAL-009).
 */

export const bankFilterSchema = z.object({
  courseId: z.string().uuid(),
  cloId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  bloomLevel: z.coerce.number().int().min(1).max(6).optional(),
  status: z.enum(["draft", "rejected", "pending", "approved", "retired"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type BankFilter = z.infer<typeof bankFilterSchema>;

export async function listBank(filter: BankFilter) {
  const conditions = [eq(questions.courseId, filter.courseId)];
  if (filter.cloId) conditions.push(eq(questions.cloId, filter.cloId));
  if (filter.topicId) conditions.push(eq(questions.topicId, filter.topicId));
  if (filter.bloomLevel) conditions.push(eq(questions.targetBloom, filter.bloomLevel));
  if (filter.status) conditions.push(eq(questions.status, filter.status));

  return db
    .select({
      id: questions.id,
      type: questions.type,
      stem: questions.stem,
      options: questions.options,
      referenceAnswer: questions.referenceAnswer,
      rubric: questions.rubric,
      explanation: questions.explanation,
      targetBloom: questions.targetBloom,
      measuredBloom: questions.measuredBloom,
      difficultyPrior: questions.difficultyPrior,
      difficultyElo: questions.difficultyElo,
      timesServed: questions.timesServed,
      timesCorrect: questions.timesCorrect,
      status: questions.status,
      validation: questions.validation,
      sourceChunkIds: questions.sourceChunkIds,
      generatedByModel: questions.generatedByModel,
      reviewNote: questions.reviewNote,
      createdAt: questions.createdAt,
      cloCode: clos.code,
      cloStatement: clos.statement,
      topicCode: topics.code,
      topicTitle: topics.title,
    })
    .from(questions)
    .innerJoin(clos, eq(clos.id, questions.cloId))
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .where(and(...conditions))
    .orderBy(desc(questions.createdAt))
    .limit(filter.limit ?? 100);
}

export const reviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: z.string().max(1000).optional() }),
  z.object({ action: z.literal("reject"), note: z.string().min(1).max(1000) }),
  z.object({ action: z.literal("retire"), note: z.string().max(1000).optional() }),
  z.object({
    action: z.literal("edit"),
    stem: z.string().min(20).optional(),
    explanation: z.string().optional(),
    referenceAnswer: z.string().nullable().optional(),
    note: z.string().max(1000).optional(),
  }),
]);

export type ReviewAction = z.infer<typeof reviewActionSchema>;

/**
 * Applies a teacher's review decision. Every decision is audited (FR-GOV-006).
 */
export async function reviewItem(
  actor: AuthedUser,
  questionId: string,
  decision: ReviewAction,
): Promise<{ status: string }> {
  const [before] = await db
    .select()
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);
  if (!before) throw new NotFoundError("Question");

  switch (decision.action) {
    case "approve": {
      // Service-layer half of the enforcement; the DB check constraint is the
      // other half, so neither path alone can approve a failed item.
      await assertApprovable(questionId);

      await db
        .update(questions)
        .set({
          status: "approved",
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: decision.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(questions.id, questionId));

      await append({
        actorId: actor.id,
        actorRole: actor.role,
        action: "question.approve",
        resourceType: "question",
        resourceId: questionId,
        payload: { statusBefore: before.status, cloId: before.cloId, bloom: before.targetBloom },
      });
      return { status: "approved" };
    }

    case "reject": {
      await db
        .update(questions)
        .set({
          status: "rejected",
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: decision.note,
          updatedAt: new Date(),
        })
        .where(eq(questions.id, questionId));

      await append({
        actorId: actor.id,
        actorRole: actor.role,
        action: "question.reject",
        resourceType: "question",
        resourceId: questionId,
        // The reason is required by FR-TCH-006 and recorded, not just displayed.
        payload: { statusBefore: before.status, reason: decision.note },
      });
      return { status: "rejected" };
    }

    case "retire": {
      if (before.status !== "approved") {
        throw new ConflictError("Only an approved item can be retired.");
      }
      await db
        .update(questions)
        .set({
          status: "retired",
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: decision.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(questions.id, questionId));

      await append({
        actorId: actor.id,
        actorRole: actor.role,
        action: "question.edit",
        resourceType: "question",
        resourceId: questionId,
        payload: { action: "retire" },
      });
      return { status: "retired" };
    }

    case "edit": {
      /*
       * An edit invalidates the validation report: the judges assessed text
       * that no longer exists. Returning the item to `draft` and clearing the
       * report forces re-validation before it can be approved — otherwise a
       * teacher could edit a passing item into a failing one and approve it on
       * the strength of the old verdict.
       */
      await db
        .update(questions)
        .set({
          ...(decision.stem ? { stem: decision.stem } : {}),
          ...(decision.explanation ? { explanation: decision.explanation } : {}),
          ...(decision.referenceAnswer !== undefined
            ? { referenceAnswer: decision.referenceAnswer }
            : {}),
          status: "draft",
          validation: null,
          measuredBloom: null,
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: decision.note ?? "edited — requires re-validation",
          updatedAt: new Date(),
        })
        .where(eq(questions.id, questionId));

      await append({
        actorId: actor.id,
        actorRole: actor.role,
        action: "question.edit",
        resourceType: "question",
        resourceId: questionId,
        payload: {
          statusBefore: before.status,
          fields: Object.keys(decision).filter((k) => k !== "action" && k !== "note"),
          validationCleared: true,
        },
      });
      return { status: "draft" };
    }
  }
}

/** Per-CLO × Bloom approved-item counts (FR-TCH-023). */
export async function bankCoverage(courseId: string) {
  const rows = await db
    .select({
      cloId: questions.cloId,
      cloCode: clos.code,
      bloomLevel: questions.targetBloom,
      approved: sql<number>`count(*) FILTER (WHERE ${questions.status} = 'approved')::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${questions.status} = 'pending')::int`,
      rejected: sql<number>`count(*) FILTER (WHERE ${questions.status} = 'rejected')::int`,
    })
    .from(questions)
    .innerJoin(clos, eq(clos.id, questions.cloId))
    .where(eq(questions.courseId, courseId))
    .groupBy(questions.cloId, clos.code, questions.targetBloom);

  return rows;
}

export async function getQuestions(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(questions).where(inArray(questions.id, ids));
}
