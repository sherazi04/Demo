import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  attemptItems,
  attempts,

  cloMastery,
  cloTopics,
  clos,
  misconceptionHits,
  misconceptions,
  questions,
  topicMastery,
  topics,
} from "@/db/schema";
import type { QuestionOption } from "@/db/schema/assessment";
import { loadCourseContext } from "@/curriculum/context";
import { assemblePrompt } from "@/intelligence/llm/prompts/shared";
import {
  feedbackSchema,
  feedbackTaskBlock,
  feedbackUserBlock,
} from "@/intelligence/llm/prompts/feedback";
import { callStructured } from "@/intelligence/llm/router";
import { retrieve } from "@/intelligence/retrieval";
import { hasAnthropicKey } from "@/intelligence/llm/client";
import { env } from "@/lib/env";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { newCorrelationId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { bktUpdate, cloMasteryFrom, guessRateFor, DEFAULT_BKT } from "./bkt";
import { eloUpdate } from "./elo";
import { selectNext, shouldTerminate, type CandidateItem } from "./adaptive";
import { awardBadge, awardForCorrectAnswer, touchStreak } from "./gamification";
import { regeneratePlan } from "./learning-plan";

/**
 * Adaptive quiz orchestration (design.md §8.1–8.4, FR-STU-001..014).
 *
 * ONLY `approved` items are ever served (FR-STU-004). That is enforced here in
 * the candidate query and, independently, by the database check constraint that
 * makes `approved` unreachable without a passing validation report.
 */

export const startQuizSchema = z.object({
  courseId: z.string().uuid(),
  topicId: z.string().uuid().optional(),
  cloId: z.string().uuid().optional(),
  itemsPlanned: z.number().int().min(1).max(30).default(10),
});

export const answerSchema = z.object({
  attemptItemId: z.string().uuid(),
  /** Option key for an MCQ, free text for an SAQ. */
  response: z.string().min(1).max(4000),
  responseMs: z.number().int().min(0).optional(),
});

export async function startAttempt(
  studentId: string,
  input: z.infer<typeof startQuizSchema>,
): Promise<{ attemptId: string }> {
  const [attempt] = await db
    .insert(attempts)
    .values({
      studentId,
      courseId: input.courseId,
      mode: "adaptive",
      targetCloId: input.cloId ?? null,
      targetTopicId: input.topicId ?? null,
      itemsPlanned: input.itemsPlanned,
    })
    .returning();
  if (!attempt) throw new Error("failed to start the attempt");
  return { attemptId: attempt.id };
}

export interface ServedItem {
  attemptItemId: string;
  questionId: string;
  type: "mcq" | "saq" | "numeric" | "code";
  stem: string;
  /** `correct` and `rationale` are stripped — the student must not see them. */
  options: Array<{ key: string; text: string }> | null;
  ordinal: number;
  topicTitle: string;
  bloomLevel: number;
  /** Shown so the adaptation is visible rather than mysterious. */
  servedDifficulty: number;
  itemsPlanned: number;
  itemsAnswered: number;
}

/** Serves the next item, or null when the run should end. */
export async function nextItem(
  studentId: string,
  attemptId: string,
): Promise<{ item: ServedItem | null; finished: boolean; reason?: string }> {
  const attempt = await loadAttempt(studentId, attemptId);
  if (attempt.finishedAt) return { item: null, finished: true, reason: "already finished" };

  // An unanswered served item is re-served rather than skipped: a refresh must
  // not silently burn an item or leave a dangling row.
  const [pending] = await db
    .select()
    .from(attemptItems)
    .where(and(eq(attemptItems.attemptId, attemptId), sql`${attemptItems.answeredAt} IS NULL`))
    .orderBy(desc(attemptItems.ordinal))
    .limit(1);

  if (pending) {
    const question = await loadQuestion(pending.questionId);
    return {
      item: await toServedItem(pending, question, attempt),
      finished: false,
    };
  }

  const answered = await db
    .select({ correct: attemptItems.correct, questionId: attemptItems.questionId })
    .from(attemptItems)
    .where(eq(attemptItems.attemptId, attemptId))
    .orderBy(attemptItems.ordinal);

  // A pinned topic is honoured exactly; otherwise the weakest topic that can
  // actually supply an item wins.
  const ranked = attempt.targetTopicId
    ? [attempt.targetTopicId]
    : await rankTopicsByWeakness(studentId, attempt.courseId);

  if (ranked.length === 0) {
    await finishAttempt(studentId, attemptId, "count");
    return { item: null, finished: true, reason: "no topics available for this course" };
  }

  // Termination is judged on the topic the run is actually working through —
  // the weakest one — regardless of which topic ends up supplying the item.
  const leadTopicId = ranked[0] as string;
  const pKnown = await getTopicMastery(studentId, leadTopicId);

  const termination = shouldTerminate({
    itemsAnswered: answered.length,
    itemsPlanned: attempt.itemsPlanned,
    pKnown,
    masteryThreshold: env.MASTERY_HIGH,
    recentResults: answered.map((a) => a.correct === true),
  });
  if (termination) {
    await finishAttempt(studentId, attemptId, termination);
    return { item: null, finished: true, reason: termination };
  }

  const recentlyServed = await recentlyServedIds(studentId, 20);
  const recentMisconceptions = await recentMisconceptionCodes(studentId);
  const meanExposure = await meanExposureFor(attempt.courseId);
  const answeredInRunIds = answered.map((a) => a.questionId);

  // The served topic is not recorded separately: the question carries its own
  // topic_id, so analytics read it from there rather than from the run.
  let chosen: Awaited<ReturnType<typeof selectNext>> = null;
  let sawAnyCandidate = false;

  for (const topicId of ranked) {
    const candidates = await loadCandidates(attempt.courseId, topicId);
    if (candidates.length === 0) continue;
    sawAnyCandidate = true;

    // The Bloom cap is re-derived per topic: it depends on this student's
    // mastery of *that* topic and on that topic's CLO ceiling, so carrying the
    // lead topic's cap across would serve items above what the student has
    // shown they can handle.
    const candidate = selectNext(candidates, {
      pKnown: topicId === leadTopicId ? pKnown : await getTopicMastery(studentId, topicId),
      recentlyServedIds: recentlyServed,
      answeredInRunIds,
      recentMisconceptionCodes: recentMisconceptions,
      cloBloomCeiling: await cloCeilingForTopic(topicId),
      meanExposure,
    });

    if (candidate) {
      chosen = candidate;
      break;
    }
  }

  if (!chosen) {
    await finishAttempt(studentId, attemptId, "count");
    return {
      item: null,
      finished: true,
      reason: sawAnyCandidate
        ? "no approved item sits at or below the Bloom level this student has reached"
        : "no approved items are available for this topic",
    };
  }

  const [inserted] = await db
    .insert(attemptItems)
    .values({
      attemptId,
      questionId: chosen.item.id,
      ordinal: answered.length,
      servedDifficulty: chosen.item.difficultyElo,
    })
    .returning();
  if (!inserted) throw new Error("failed to record the served item");

  await db
    .update(questions)
    .set({ timesServed: sql`${questions.timesServed} + 1` })
    .where(eq(questions.id, chosen.item.id));

  const question = await loadQuestion(chosen.item.id);
  return { item: await toServedItem(inserted, question, attempt), finished: false };
}

export interface AnswerResult {
  correct: boolean;
  correctKey: string | null;
  explanation: string;
  /** Present on an incorrect MCQ answer with a mapped misconception. */
  misconception: { code: string; description: string; remediation: string } | null;
  feedback: {
    likelyReasoning: string;
    whereItFails: string;
    correctReasoning: string;
    nextStep: string;
    citations: Array<{
      chunkId: string;
      materialTitle: string;
      sectionPath: string | null;
      pageFrom: number | null;
      pageTo: number | null;
    }>;
  } | null;
  masteryBefore: number;
  masteryAfter: number;
  pointsAwarded: number;
  pointsReason: string;
  newBadges: string[];
  streak: { current: number; longest: number };
  planRegenerated: boolean;
}

export async function submitAnswer(
  studentId: string,
  input: z.infer<typeof answerSchema>,
): Promise<AnswerResult> {
  const correlationId = newCorrelationId();

  const [row] = await db
    .select({
      attemptItem: attemptItems,
      attempt: attempts,
      question: questions,
    })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .innerJoin(questions, eq(questions.id, attemptItems.questionId))
    .where(eq(attemptItems.id, input.attemptItemId))
    .limit(1);

  if (!row) throw new NotFoundError("Attempt item");
  if (row.attempt.studentId !== studentId) {
    // Ownership is re-checked here as well as in the guard: this path writes
    // mastery state, and a mismatch must never be recoverable.
    throw new NotFoundError("Attempt item");
  }
  if (row.attemptItem.answeredAt) {
    throw new ConflictError("This item has already been answered.");
  }

  const question = row.question;
  const options = (question.options ?? []) as QuestionOption[];
  const correctOption = options.find((o) => o.correct) ?? null;

  const correct =
    question.type === "mcq"
      ? correctOption?.key === input.response.trim().toUpperCase()
      : // Free-text items are not auto-marked: correctness is left null until a
        // teacher marks them, and they do not move the mastery estimate.
        null;

  const chosenOption =
    question.type === "mcq"
      ? options.find((o) => o.key === input.response.trim().toUpperCase()) ?? null
      : null;

  let misconceptionRow: {
    id: string;
    code: string;
    description: string;
    remediation: string;
  } | null = null;

  if (correct === false && chosenOption?.misconceptionCode) {
    const [found] = await db
      .select({
        id: misconceptions.id,
        code: misconceptions.code,
        description: misconceptions.description,
        remediation: misconceptions.remediation,
      })
      .from(misconceptions)
      .where(eq(misconceptions.code, chosenOption.misconceptionCode))
      .limit(1);
    misconceptionRow = found ?? null;
  }

  const masteryBefore = await getTopicMastery(studentId, question.topicId);
  let masteryAfter = masteryBefore;

  if (correct !== null) {
    const pGuess = guessRateFor(question.type, options.length || 4);
    masteryAfter = bktUpdate(masteryBefore, correct, { ...DEFAULT_BKT, pGuess });

    await db
      .insert(topicMastery)
      .values({
        studentId,
        topicId: question.topicId,
        pKnown: masteryAfter,
        observations: 1,
        lastCorrect: correct,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [topicMastery.studentId, topicMastery.topicId],
        set: {
          pKnown: masteryAfter,
          observations: sql`${topicMastery.observations} + 1`,
          lastCorrect: correct,
          updatedAt: new Date(),
        },
      });

    // Elo: a correct answer makes the item easier, an incorrect one harder.
    const newDifficulty = eloUpdate(
      question.difficultyElo,
      masteryBefore,
      correct,
      question.timesServed,
    );
    await db
      .update(questions)
      .set({
        difficultyElo: newDifficulty,
        timesCorrect: correct
          ? sql`${questions.timesCorrect} + 1`
          : questions.timesCorrect,
      })
      .where(eq(questions.id, question.id));

    await recomputeCloMastery(studentId, question.topicId);
  }

  let hitCount = 0;
  if (misconceptionRow) {
    const [hit] = await db
      .insert(misconceptionHits)
      .values({
        studentId,
        misconceptionId: misconceptionRow.id,
        count: 1,
        lastHitAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [misconceptionHits.studentId, misconceptionHits.misconceptionId],
        set: {
          count: sql`${misconceptionHits.count} + 1`,
          lastHitAt: new Date(),
          clearedAt: null,
        },
      })
      .returning();
    hitCount = hit?.count ?? 1;
  }

  const feedback =
    correct === false
      ? await generateFeedback({
          question,
          options,
          chosenKey: input.response.trim().toUpperCase(),
          correctKey: correctOption?.key ?? "",
          misconception: misconceptionRow,
          hitCount,
          correlationId,
          studentId,
        })
      : null;

  await db
    .update(attemptItems)
    .set({
      response: input.response,
      correct,
      misconceptionId: misconceptionRow?.id ?? null,
      feedback: feedback ? { kind: "adaptive", ...feedback } : null,
      responseMs: input.responseMs ?? null,
      answeredAt: new Date(),
    })
    .where(eq(attemptItems.id, input.attemptItemId));

  await db
    .update(attempts)
    .set({ itemsAnswered: sql`${attempts.itemsAnswered} + 1` })
    .where(eq(attempts.id, row.attempt.id));

  // Gamification.
  let pointsAwarded = 0;
  let pointsReason = "";
  const newBadges: string[] = [];

  if (correct === true) {
    const award = await awardForCorrectAnswer({
      studentId,
      questionId: question.id,
      difficultyElo: question.difficultyElo,
      topicPKnown: masteryBefore,
      masteryHigh: env.MASTERY_HIGH,
    });
    pointsAwarded = award.pointsAwarded;
    pointsReason = award.reason;

    // Clearing a misconception: previously hit, now answered correctly on the
    // same topic.
    const cleared = await clearMisconceptionsForTopic(studentId, question.topicId);
    if (cleared > 0 && (await awardBadge(studentId, "misconception_cleared"))) {
      newBadges.push("misconception_cleared");
    }
  }

  const streak = await touchStreak(studentId);
  if (streak.current >= 7 && (await awardBadge(studentId, "streak_7"))) {
    newBadges.push("streak_7");
  }

  if (
    masteryAfter >= env.MASTERY_HIGH &&
    masteryBefore < env.MASTERY_HIGH &&
    (await awardBadge(studentId, "first_clo_mastered"))
  ) {
    newBadges.push("first_clo_mastered");
  }

  // The plan is regenerated when mastery crosses the threshold, or when a
  // misconception escalates to remediation — the two things that change the
  // ordering (§8.5).
  const crossedThreshold =
    (masteryBefore < env.MASTERY_THRESHOLD) !== (masteryAfter < env.MASTERY_THRESHOLD);
  const escalated = hitCount === 3;
  let planRegenerated = false;

  if (crossedThreshold || escalated) {
    try {
      await regeneratePlan(
        studentId,
        row.attempt.courseId,
        escalated
          ? `Remediation added: ${misconceptionRow?.code ?? "a misconception"} triggered ${hitCount} times`
          : `Mastery on this topic moved ${masteryBefore < masteryAfter ? "above" : "below"} the ${env.MASTERY_THRESHOLD} threshold`,
      );
      planRegenerated = true;
    } catch (error: unknown) {
      logger.warn("plan regeneration failed after answer", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    correct: correct === true,
    correctKey: correctOption?.key ?? null,
    explanation: question.explanation,
    misconception: misconceptionRow
      ? {
          code: misconceptionRow.code,
          description: misconceptionRow.description,
          remediation: misconceptionRow.remediation,
        }
      : null,
    feedback,
    masteryBefore,
    masteryAfter,
    pointsAwarded,
    pointsReason,
    newBadges,
    streak: { current: streak.current, longest: streak.longest },
    planRegenerated,
  };
}

async function generateFeedback(input: {
  question: typeof questions.$inferSelect;
  options: QuestionOption[];
  chosenKey: string;
  correctKey: string;
  misconception: { code: string; description: string; remediation: string } | null;
  hitCount: number;
  correlationId: string;
  studentId: string;
}): Promise<AnswerResult["feedback"]> {
  if (!hasAnthropicKey()) {
    // Without a key the system still runs; the student gets the authored
    // remediation rather than a generated explanation, and it says so.
    return input.misconception
      ? {
          likelyReasoning: input.misconception.description,
          whereItFails: input.misconception.description,
          correctReasoning: input.misconception.remediation,
          nextStep: input.misconception.remediation,
          citations: [],
        }
      : null;
  }

  try {
    const retrieval = await retrieve(
      input.question.stem,
      {
        courseId: input.question.courseId,
        topicIds: [input.question.topicId],
        cloIds: [input.question.cloId],
      },
      { finalK: 5 },
    );

    const courseContext = await loadCourseContext(input.question.courseId);
    const { system } = assemblePrompt(courseContext, feedbackTaskBlock());

    const result = await callStructured(feedbackSchema, {
      tier: "generation",
      system,
      user: feedbackUserBlock({
        stem: input.question.stem,
        options: input.options.map((o) => ({
          key: o.key,
          text: o.text,
          correct: o.correct,
        })),
        chosenKey: input.chosenKey,
        correctKey: input.correctKey,
        misconception: input.misconception,
        explanation: input.question.explanation,
        context: retrieval.results,
        hitCount: input.hitCount,
      }),
      auditAction: "feedback.generate",
      resourceType: "question",
      resourceId: input.question.id,
      retrievedChunkIds: retrieval.results.map((r) => r.id),
      correlationId: input.correlationId,
      // The acting student is recorded as the actor, but nothing identifying
      // is sent in the prompt itself (NFR-SEC-006).
      actorId: input.studentId,
      actorRole: "student",
    });

    if (result.refused || !result.data) return null;

    const cited = retrieval.results.filter((r) => result.data?.citedChunkIds.includes(r.id));
    return {
      likelyReasoning: result.data.likelyReasoning,
      whereItFails: result.data.whereItFails,
      correctReasoning: result.data.correctReasoning,
      nextStep: result.data.nextStep,
      citations: cited.map((c) => ({
        chunkId: c.id,
        materialTitle: c.materialTitle,
        sectionPath: c.sectionPath,
        pageFrom: c.pageFrom,
        pageTo: c.pageTo,
      })),
    };
  } catch (error: unknown) {
    logger.warn("feedback generation failed", {
      correlationId: input.correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function finishAttempt(
  studentId: string,
  attemptId: string,
  reason: "count" | "mastery" | "exit",
): Promise<{ score: number; itemsAnswered: number }> {
  const attempt = await loadAttempt(studentId, attemptId);

  const [summary] = await db
    .select({
      answered: sql<number>`count(*) FILTER (WHERE ${attemptItems.answeredAt} IS NOT NULL)::int`,
      correct: sql<number>`count(*) FILTER (WHERE ${attemptItems.correct})::int`,
    })
    .from(attemptItems)
    .where(eq(attemptItems.attemptId, attemptId));

  const answered = Number(summary?.answered ?? 0);
  const correct = Number(summary?.correct ?? 0);
  const score = answered > 0 ? correct / answered : 0;

  // Every termination path persists a summary (FR-STU-007).
  await db
    .update(attempts)
    .set({
      score,
      itemsAnswered: answered,
      terminationReason: reason,
      finishedAt: attempt.finishedAt ?? new Date(),
    })
    .where(eq(attempts.id, attemptId));

  return { score, itemsAnswered: answered };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function loadAttempt(studentId: string, attemptId: string) {
  const [attempt] = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.id, attemptId), eq(attempts.studentId, studentId)))
    .limit(1);
  if (!attempt) throw new NotFoundError("Attempt");
  return attempt;
}

async function loadQuestion(questionId: string) {
  const [row] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
  if (!row) throw new NotFoundError("Question");
  return row;
}

async function toServedItem(
  item: typeof attemptItems.$inferSelect,
  question: typeof questions.$inferSelect,
  attempt: typeof attempts.$inferSelect,
): Promise<ServedItem> {
  const [topic] = await db
    .select({ title: topics.title })
    .from(topics)
    .where(eq(topics.id, question.topicId))
    .limit(1);

  const options = (question.options ?? []) as QuestionOption[];

  return {
    attemptItemId: item.id,
    questionId: question.id,
    type: question.type,
    stem: question.stem,
    // `correct` and `rationale` are deliberately absent: shipping them to the
    // client would put the answer key in the browser.
    options:
      question.type === "mcq"
        ? options.map((o) => ({ key: o.key, text: o.text }))
        : null,
    ordinal: item.ordinal,
    topicTitle: topic?.title ?? "",
    bloomLevel: question.targetBloom,
    servedDifficulty: item.servedDifficulty ?? question.difficultyElo,
    itemsPlanned: attempt.itemsPlanned,
    itemsAnswered: attempt.itemsAnswered,
  };
}

async function loadCandidates(courseId: string, topicId: string): Promise<CandidateItem[]> {
  const rows = await db
    .select({
      id: questions.id,
      topicId: questions.topicId,
      targetBloom: questions.targetBloom,
      difficultyElo: questions.difficultyElo,
      timesServed: questions.timesServed,
      options: questions.options,
    })
    .from(questions)
    .where(
      and(
        eq(questions.courseId, courseId),
        eq(questions.topicId, topicId),
        // FR-STU-004: only approved items, enforced in the query itself.
        eq(questions.status, "approved"),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    topicId: row.topicId,
    targetBloom: row.targetBloom,
    difficultyElo: row.difficultyElo,
    timesServed: row.timesServed,
    misconceptionCodes: ((row.options ?? []) as QuestionOption[])
      .map((o) => o.misconceptionCode)
      .filter((code): code is string => typeof code === "string"),
  }));
}

async function getTopicMastery(studentId: string, topicId: string): Promise<number> {
  const [row] = await db
    .select({ pKnown: topicMastery.pKnown })
    .from(topicMastery)
    .where(and(eq(topicMastery.studentId, studentId), eq(topicMastery.topicId, topicId)))
    .limit(1);
  return row?.pKnown ?? env.BKT_P_INIT;
}

/**
 * Topics with an approved item, weakest mastery first.
 *
 * Returns the whole ranking rather than just the head so the caller can move on
 * when the weakest topic happens to hold nothing at the student's current Bloom
 * cap. Picking only the head made a thin bank look like a broken engine: a new
 * student, capped at Bloom 1, would be handed the weakest topic, find its only
 * item sitting at Bloom 3, and have the run end before a single question.
 */
async function rankTopicsByWeakness(studentId: string, courseId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT t.id
    FROM topics t
    LEFT JOIN topic_mastery tm ON tm.topic_id = t.id AND tm.student_id = ${studentId}
    WHERE t.course_id = ${courseId}
      AND EXISTS (
        SELECT 1 FROM questions q
        WHERE q.topic_id = t.id AND q.status = 'approved'
      )
    ORDER BY COALESCE(tm.p_known, 0) ASC, t.ordinal ASC
  `);
  return [...rows].map((r) => r.id);
}

async function cloCeilingForTopic(topicId: string): Promise<number> {
  const [row] = await db
    .select({ bloomLevel: clos.bloomLevel })
    .from(cloTopics)
    .innerJoin(clos, eq(clos.id, cloTopics.cloId))
    .where(eq(cloTopics.topicId, topicId))
    .orderBy(desc(clos.bloomLevel))
    .limit(1);
  return row?.bloomLevel ?? 6;
}

async function recentlyServedIds(studentId: string, limit: number): Promise<string[]> {
  const rows = await db
    .select({ questionId: attemptItems.questionId })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .where(eq(attempts.studentId, studentId))
    .orderBy(desc(attemptItems.servedAt))
    .limit(limit);
  return rows.map((r) => r.questionId);
}

async function recentMisconceptionCodes(studentId: string): Promise<string[]> {
  const rows = await db
    .select({ code: misconceptions.code })
    .from(misconceptionHits)
    .innerJoin(misconceptions, eq(misconceptions.id, misconceptionHits.misconceptionId))
    .where(
      and(
        eq(misconceptionHits.studentId, studentId),
        sql`${misconceptionHits.clearedAt} IS NULL`,
      ),
    )
    .orderBy(desc(misconceptionHits.lastHitAt))
    .limit(10);
  return rows.map((r) => r.code);
}

async function meanExposureFor(courseId: string): Promise<number> {
  const [row] = await db
    .select({ mean: sql<number>`COALESCE(avg(${questions.timesServed}), 1)::real` })
    .from(questions)
    .where(and(eq(questions.courseId, courseId), eq(questions.status, "approved")));
  return Math.max(Number(row?.mean ?? 1), 1);
}

/** Recomputes CLO mastery from its constituent topics (§8.1). */
async function recomputeCloMastery(studentId: string, topicId: string): Promise<void> {
  const cloRows = await db
    .select({ cloId: cloTopics.cloId })
    .from(cloTopics)
    .where(eq(cloTopics.topicId, topicId));

  for (const { cloId } of cloRows) {
    const topicRows = await db
      .select({
        pKnown: topicMastery.pKnown,
        observations: topicMastery.observations,
      })
      .from(cloTopics)
      .leftJoin(
        topicMastery,
        and(
          eq(topicMastery.topicId, cloTopics.topicId),
          eq(topicMastery.studentId, studentId),
        ),
      )
      .where(eq(cloTopics.cloId, cloId));

    const value = cloMasteryFrom(
      topicRows.map((r) => ({
        pKnown: r.pKnown ?? 0,
        observations: r.observations ?? 0,
      })),
    );

    await db
      .insert(cloMastery)
      .values({ studentId, cloId, pKnown: value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [cloMastery.studentId, cloMastery.cloId],
        set: { pKnown: value, updatedAt: new Date() },
      });
  }
}

/** Marks misconceptions on this topic cleared after a correct answer. */
async function clearMisconceptionsForTopic(
  studentId: string,
  topicId: string,
): Promise<number> {
  const rows = await db
    .update(misconceptionHits)
    .set({ clearedAt: new Date() })
    .where(
      and(
        eq(misconceptionHits.studentId, studentId),
        // Only ones still outstanding; re-clearing an already-cleared hit would
        // inflate the "misconception cleared" badge.
        sql`${misconceptionHits.clearedAt} IS NULL`,
        sql`${misconceptionHits.misconceptionId} IN (
          SELECT id FROM misconceptions WHERE topic_id = ${topicId}
        )`,
      ),
    )
    .returning({ id: misconceptionHits.misconceptionId });
  return rows.length;
}
