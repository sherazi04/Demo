import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clos, cloTopics, misconceptions, questions, topics } from "@/db/schema";
import { append } from "@/governance/audit";
import { newCorrelationId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { retrieve } from "@/intelligence/retrieval";
import { callStructured } from "@/intelligence/llm/router";
import { assemblePrompt } from "@/intelligence/llm/prompts/shared";
import {
  questionSchema,
  questionTaskBlock,
  questionUserBlock,
  type GeneratedQuestion,
} from "@/intelligence/llm/prompts/question";
import { loadCourseContext } from "@/curriculum/context";
import { validate } from "@/validation/engine";
import type { ValidationReport } from "@/validation/types";
import type { AuthedUser } from "@/auth/guard";

/**
 * Blueprint-driven assessment generation (design.md §9.1, FR-TCH-001..007).
 *
 * Items are generated ONE AT A TIME WITH PER-ITEM RETRIEVAL, never as one batch
 * call. Batching costs fewer tokens but reliably degrades CLO alignment,
 * because a single retrieval cannot be filtered to each item's own CLO and
 * Bloom level — and CLO alignment is the metric this entire system exists to
 * defend.
 *
 * Rejected items are PERSISTED with their failure reasons, never discarded
 * (FR-VAL-008). The teacher sees them beside the accepted ones; that visibility
 * is the feature, not a debugging aid.
 */

export const blueprintSlotSchema = z.object({
  cloId: z.string().uuid(),
  bloomLevel: z.number().int().min(1).max(6),
  count: z.number().int().min(1).max(20),
  type: z.enum(["mcq", "saq"]),
});

export const blueprintSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(200),
  slots: z.array(blueprintSlotSchema).min(1).max(20),
  difficultyBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.3, 0.8]),
});

export type Blueprint = z.infer<typeof blueprintSchema>;

export type GenerationEvent =
  | { kind: "start"; totalItems: number; correlationId: string }
  | { kind: "item-start"; index: number; cloCode: string; bloomLevel: number }
  | { kind: "item-retrieved"; index: number; chunkCount: number }
  | {
      kind: "item-done";
      index: number;
      questionId: string;
      status: "pending" | "rejected";
      stem: string;
      failures: string[];
      checks: ValidationReport["checks"];
    }
  | { kind: "item-error"; index: number; message: string }
  | {
      kind: "done";
      accepted: number;
      rejected: number;
      errored: number;
      correlationId: string;
    };

/**
 * Generates a blueprint, yielding progress per item so the UI can stream it
 * (NFR-PRF-002). An async generator rather than a callback so the caller
 * controls back-pressure and can stop cleanly.
 */
export async function* generateAssessment(
  actor: AuthedUser,
  blueprint: Blueprint,
): AsyncGenerator<GenerationEvent> {
  const correlationId = newCorrelationId();
  const totalItems = blueprint.slots.reduce((sum, slot) => sum + slot.count, 0);

  yield { kind: "start", totalItems, correlationId };

  const courseContext = await loadCourseContext(blueprint.courseId);
  const validTopicCodes = new Set(courseContext.topics.map((t) => t.code));
  const validCloCodes = new Set(courseContext.clos.map((c) => c.code));

  let accepted = 0;
  let rejected = 0;
  let errored = 0;
  let index = 0;
  const producedStems: string[] = [];

  for (const slot of blueprint.slots) {
    const [clo] = await db.select().from(clos).where(eq(clos.id, slot.cloId)).limit(1);
    if (!clo) {
      errored += slot.count;
      index += slot.count;
      continue;
    }

    // Topics this CLO is actually assessed by — the item's topic must be one of
    // them or the graph half of clo_alignment cannot pass.
    const topicRows = await db
      .select({ id: topics.id, code: topics.code, title: topics.title })
      .from(cloTopics)
      .innerJoin(topics, eq(topics.id, cloTopics.topicId))
      .where(eq(cloTopics.cloId, slot.cloId))
      .orderBy(topics.ordinal);

    if (topicRows.length === 0) {
      errored += slot.count;
      index += slot.count;
      continue;
    }

    for (let n = 0; n < slot.count; n += 1) {
      const currentIndex = index;
      index += 1;

      // Rotate topics so a multi-item slot spreads across the CLO's topics
      // rather than producing four near-duplicates about the same one.
      const topic = topicRows[n % topicRows.length];
      if (!topic) continue;

      yield {
        kind: "item-start",
        index: currentIndex,
        cloCode: clo.code,
        bloomLevel: slot.bloomLevel,
      };

      try {
        // Per-item retrieval, filtered to THIS item's CLO and Bloom level.
        const retrieval = await retrieve(
          `${clo.statement} ${topic.title}`,
          {
            courseId: blueprint.courseId,
            cloIds: [slot.cloId],
            topicIds: [topic.id],
            bloomBand: bloomBandFor(slot.bloomLevel),
            difficultyBand: blueprint.difficultyBand,
          },
          { finalK: 6 },
        );

        yield {
          kind: "item-retrieved",
          index: currentIndex,
          chunkCount: retrieval.results.length,
        };

        if (retrieval.results.length === 0) {
          // No context means nothing to ground against. Recording this as an
          // error rather than generating anyway is the honest outcome — an
          // ungrounded item would only fail groundedness after five judge calls.
          yield {
            kind: "item-error",
            index: currentIndex,
            message: `No indexed material matches ${clo.code} / ${topic.code} at Bloom ${slot.bloomLevel}. Upload material covering this topic, or widen the difficulty band.`,
          };
          errored += 1;
          continue;
        }

        const misconceptionRows = await db
          .select({
            code: misconceptions.code,
            description: misconceptions.description,
            remediation: misconceptions.remediation,
          })
          .from(misconceptions)
          .where(eq(misconceptions.topicId, topic.id));

        const { system } = assemblePrompt(courseContext, questionTaskBlock(slot.type));

        const generated = await callStructured(questionSchema, {
          tier: "generation",
          system,
          user: questionUserBlock({
            type: slot.type,
            cloCode: clo.code,
            cloStatement: clo.statement,
            bloomLevel: slot.bloomLevel,
            topicCode: topic.code,
            topicTitle: topic.title,
            difficultyBand: blueprint.difficultyBand,
            misconceptions: misconceptionRows,
            context: retrieval.results,
            avoidStems: producedStems.slice(-8),
          }),
          auditAction: "question.generate",
          resourceType: "question",
          retrievedChunkIds: retrieval.results.map((r) => r.id),
          correlationId,
          actorId: actor.id,
          actorRole: actor.role,
        });

        if (generated.refused || !generated.data) {
          yield {
            kind: "item-error",
            index: currentIndex,
            message: generated.refused
              ? `The model declined to generate this item: ${generated.refusalReason ?? "no reason given"}`
              : "The model returned no usable item.",
          };
          errored += 1;
          continue;
        }

        const item = generated.data;
        producedStems.push(item.stem);

        // The generator NEVER validates itself: this is a separate set of
        // judge-tier calls with their own prompts (FR-INT-052).
        const outcome = await validate(
          {
            type: item.type,
            stem: item.stem,
            options: item.options?.map((o) => ({
              key: o.key,
              text: o.text,
              correct: o.correct,
              misconceptionCode: o.misconceptionCode ?? undefined,
              rationale: o.rationale,
            })),
            referenceAnswer: item.referenceAnswer ?? null,
            rubric: item.rubric ?? null,
            explanation: item.explanation,
            difficultyPrior: item.difficultyPrior,
            citedChunkIds: item.citedChunkIds,
          },
          {
            courseId: blueprint.courseId,
            cloId: clo.id,
            cloCode: clo.code,
            cloStatement: clo.statement,
            cloBloomLevel: clo.bloomLevel,
            topicId: topic.id,
            topicCode: topic.code,
            topicTitle: topic.title,
            targetBloom: slot.bloomLevel,
            sourceChunks: retrieval.results,
            misconceptions: misconceptionRows,
            validTopicCodes,
            validCloCodes,
            correlationId,
            actorId: actor.id,
          },
        );

        const status = outcome.report.passed ? "pending" : "rejected";

        const [row] = await db
          .insert(questions)
          .values({
            courseId: blueprint.courseId,
            cloId: clo.id,
            topicId: topic.id,
            type: item.type,
            targetBloom: slot.bloomLevel,
            measuredBloom: outcome.measuredBloom,
            stem: item.stem,
            options: item.options?.map((o) => ({
              key: o.key,
              text: o.text,
              correct: o.correct,
              ...(o.misconceptionCode ? { misconceptionCode: o.misconceptionCode } : {}),
              rationale: o.rationale,
            })),
            referenceAnswer: item.referenceAnswer ?? null,
            rubric: item.rubric ?? null,
            explanation: item.explanation,
            difficultyPrior: item.difficultyPrior,
            difficultyElo: item.difficultyPrior,
            sourceChunkIds: item.citedChunkIds,
            generatedByModel: generated.model,
            validation: outcome.report,
            // A failed item is persisted as `rejected`, not dropped
            // (FR-VAL-008). It appears in the teacher UI beside the accepted
            // ones with its failure reasons.
            status,
          })
          .returning();

        if (!row) throw new Error("failed to persist the generated item");

        if (status === "pending") accepted += 1;
        else rejected += 1;

        yield {
          kind: "item-done",
          index: currentIndex,
          questionId: row.id,
          status,
          stem: item.stem,
          failures: outcome.report.failures,
          checks: outcome.report.checks,
        };
      } catch (error: unknown) {
        // One failed item must not abort the batch (NFR-REL-003).
        const message = error instanceof Error ? error.message : String(error);
        logger.error("item generation failed", { correlationId, index: currentIndex, error: message });
        yield { kind: "item-error", index: currentIndex, message };
        errored += 1;
      }
    }
  }

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "question.generate",
    resourceType: "assessment_run",
    resourceId: correlationId,
    correlationId,
    payload: { requested: totalItems, accepted, rejected, errored, title: blueprint.title },
  });

  logger.info("generation run complete", {
    correlationId,
    requested: totalItems,
    accepted,
    rejected,
    errored,
  });

  yield { kind: "done", accepted, rejected, errored, correlationId };
}

/**
 * Retrieval Bloom band for a requested level.
 *
 * Material one level below is legitimate grounding for an item — an Apply
 * question is properly grounded in the Understand-level explanation of the
 * procedure it applies. Material *above* the target is excluded: grounding an
 * Apply item in Evaluate-level discussion is what produces items that measure
 * the wrong level.
 */
function bloomBandFor(level: number): [number, number] {
  return [Math.max(1, level - 1), level];
}

/** Items from one generation run, accepted and rejected together. */
export async function itemsForRun(courseId: string, questionIds: string[]) {
  if (questionIds.length === 0) return [];
  return db
    .select()
    .from(questions)
    .where(and(eq(questions.courseId, courseId), inArray(questions.id, questionIds)));
}
