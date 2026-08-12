import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  attemptItems,
  attempts,
  cloMastery,
  clos,
  questions,
  topicMastery,
  topics,
} from "@/db/schema";

/**
 * Per-CLO and per-topic progress, plus attempt history (FR-STU-040, FR-STU-041).
 *
 * Every function here takes `studentId` explicitly and filters on it. There is
 * no "current user" implicit in this module — the caller has already passed the
 * guard, and making the scope a parameter keeps a cross-student leak from being
 * one forgotten `where` away.
 */

export interface CloProgress {
  cloId: string;
  code: string;
  statement: string;
  bloomLevel: number;
  mastery: number;
  /** Observations across the CLO's topics — the sample size behind the figure. */
  observations: number;
}

export interface TopicProgress {
  topicId: string;
  code: string;
  title: string;
  week: number;
  mastery: number;
  observations: number;
  lastCorrect: boolean | null;
}

export async function getCloProgress(
  studentId: string,
  courseId: string,
): Promise<CloProgress[]> {
  const rows = await db
    .select({
      cloId: clos.id,
      code: clos.code,
      statement: clos.statement,
      bloomLevel: clos.bloomLevel,
      mastery: cloMastery.pKnown,
    })
    .from(clos)
    .leftJoin(
      cloMastery,
      and(eq(cloMastery.cloId, clos.id), eq(cloMastery.studentId, studentId)),
    )
    .where(eq(clos.courseId, courseId))
    .orderBy(clos.ordinal);

  const observations = await db
    .select({
      cloId: questions.cloId,
      count: sql<number>`count(*)::int`,
    })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .innerJoin(questions, eq(questions.id, attemptItems.questionId))
    .where(and(eq(attempts.studentId, studentId), eq(attempts.courseId, courseId)))
    .groupBy(questions.cloId);

  const byClo = new Map(observations.map((o) => [o.cloId, Number(o.count)]));

  return rows.map((row) => ({
    cloId: row.cloId,
    code: row.code,
    statement: row.statement,
    bloomLevel: row.bloomLevel,
    mastery: row.mastery ?? 0,
    observations: byClo.get(row.cloId) ?? 0,
  }));
}

export async function getTopicProgress(
  studentId: string,
  courseId: string,
): Promise<TopicProgress[]> {
  const rows = await db
    .select({
      topicId: topics.id,
      code: topics.code,
      title: topics.title,
      week: topics.week,
      mastery: topicMastery.pKnown,
      observations: topicMastery.observations,
      lastCorrect: topicMastery.lastCorrect,
    })
    .from(topics)
    .leftJoin(
      topicMastery,
      and(eq(topicMastery.topicId, topics.id), eq(topicMastery.studentId, studentId)),
    )
    .where(eq(topics.courseId, courseId))
    .orderBy(topics.ordinal);

  return rows.map((row) => ({
    topicId: row.topicId,
    code: row.code,
    title: row.title,
    week: row.week,
    mastery: row.mastery ?? 0,
    observations: row.observations ?? 0,
    lastCorrect: row.lastCorrect,
  }));
}

export interface AttemptSummary {
  attemptId: string;
  startedAt: Date;
  finishedAt: Date | null;
  itemsAnswered: number;
  itemsPlanned: number;
  score: number | null;
  terminationReason: string | null;
}

export async function getAttemptHistory(
  studentId: string,
  courseId: string,
  limit = 20,
): Promise<AttemptSummary[]> {
  const rows = await db
    .select({
      attemptId: attempts.id,
      startedAt: attempts.startedAt,
      finishedAt: attempts.finishedAt,
      itemsAnswered: attempts.itemsAnswered,
      itemsPlanned: attempts.itemsPlanned,
      score: attempts.score,
      terminationReason: attempts.terminationReason,
    })
    .from(attempts)
    .where(and(eq(attempts.studentId, studentId), eq(attempts.courseId, courseId)))
    .orderBy(desc(attempts.startedAt))
    .limit(limit);

  return rows;
}

export interface AttemptDetailItem {
  ordinal: number;
  stem: string;
  response: string | null;
  correct: boolean | null;
  servedDifficulty: number | null;
  topicTitle: string;
  bloomLevel: number;
  answeredAt: Date | null;
}

/** Per-item outcomes for one attempt (FR-STU-041). */
export async function getAttemptDetail(
  studentId: string,
  attemptId: string,
): Promise<AttemptDetailItem[]> {
  const rows = await db
    .select({
      ordinal: attemptItems.ordinal,
      stem: questions.stem,
      response: attemptItems.response,
      correct: attemptItems.correct,
      servedDifficulty: attemptItems.servedDifficulty,
      topicTitle: topics.title,
      bloomLevel: questions.targetBloom,
      answeredAt: attemptItems.answeredAt,
    })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .innerJoin(questions, eq(questions.id, attemptItems.questionId))
    .innerJoin(topics, eq(topics.id, questions.topicId))
    // Scoped to the owning student, so an attempt id from elsewhere returns
    // nothing rather than another student's answers.
    .where(and(eq(attemptItems.attemptId, attemptId), eq(attempts.studentId, studentId)))
    .orderBy(attemptItems.ordinal);

  return rows;
}
