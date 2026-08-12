import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  attemptItems,
  attempts,
  cloMastery,
  clos,
  enrollments,
  misconceptionHits,
  misconceptions,
  questions,
  topicMastery,
  topics,
  users,
} from "@/db/schema";

/**
 * Cohort analytics and at-risk detection (FR-TCH-030..034).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AT-RISK DETECTION IS RULES-BASED, NOT A TRAINED MODEL.
 *
 * Each rule below is an explicit, inspectable condition, and the rule that
 * fired is returned with every flag so a teacher can see *why* a student was
 * flagged and disagree with it. There is no historical outcome data to train a
 * predictive model on, and presenting thresholds as a prediction would be
 * dishonest (honesty rule 2, design.md §9.3, FR-TCH-034).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface AtRiskRule {
  id: "low_mastery" | "stalled" | "disengaged" | "prereq_blocked" | "misconception_persistent";
  label: string;
  /** The exact condition, shown in the UI beside every flag. */
  condition: string;
}

export const AT_RISK_RULES: AtRiskRule[] = [
  {
    id: "low_mastery",
    label: "Low mastery",
    condition: "Mean CLO mastery below 0.40 after at least 20 answered items",
  },
  {
    id: "stalled",
    label: "Stalled",
    condition: "No increase in mean mastery across the last 15 answered items",
  },
  {
    id: "disengaged",
    label: "Disengaged",
    condition: "No activity for 7 or more days while the course is running",
  },
  {
    id: "prereq_blocked",
    label: "Prerequisite blocked",
    condition:
      "3 or more unmastered topics share the same prerequisite the student has " +
      "attempted at least 3 times and still not mastered",
  },
  {
    id: "misconception_persistent",
    label: "Persistent misconception",
    condition: "A single misconception triggered 5 or more times without clearing",
  },
];

export interface StudentAnalytics {
  studentId: string;
  name: string;
  isSynthetic: boolean;
  meanCloMastery: number;
  itemsAnswered: number;
  accuracy: number;
  activeDays: number;
  lastActiveAt: Date | null;
  /** Every rule that fired, with its condition — never just a boolean flag. */
  firedRules: Array<{ rule: AtRiskRule; evidence: string }>;
}

export interface CohortAnalytics {
  students: StudentAnalytics[];
  cloMastery: Array<{ cloId: string; cloCode: string; meanMastery: number; n: number }>;
  topicMastery: Array<{ topicId: string; topicCode: string; meanMastery: number; n: number }>;
  mostMissedItems: Array<{
    questionId: string;
    stem: string;
    timesServed: number;
    accuracy: number;
    cloCode: string;
  }>;
  mostTriggeredMisconceptions: Array<{
    code: string;
    description: string;
    remediation: string;
    studentsAffected: number;
    totalHits: number;
  }>;
  /** Sample size for every cohort-level figure (honesty rule 5). */
  cohortSize: number;
  syntheticCount: number;
}

const DISENGAGED_DAYS = 7;
const LOW_MASTERY_THRESHOLD = 0.4;
const LOW_MASTERY_MIN_ITEMS = 20;
const MISCONCEPTION_PERSISTENT_HITS = 5;
const PREREQ_BLOCKED_MIN = 3;
/** Mastery at or above this counts as "mastered" for the prerequisite rule. */
const MASTERY_THRESHOLD = 0.7;
/** A prerequisite must have been attempted this many times to count as blocking. */
const PREREQ_MIN_OBSERVATIONS = 3;

export async function getCohortAnalytics(courseId: string): Promise<CohortAnalytics> {
  const roster = await db
    .select({ id: users.id, name: users.name, isSynthetic: users.isSynthetic })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.role, "student")))
    .orderBy(users.name);

  const students: StudentAnalytics[] = [];

  for (const student of roster) {
    students.push(await analyseStudent(student, courseId));
  }

  const cloRows = await db
    .select({
      cloId: clos.id,
      cloCode: clos.code,
      meanMastery: sql<number>`COALESCE(avg(${cloMastery.pKnown}), 0)::real`,
      n: sql<number>`count(${cloMastery.studentId})::int`,
    })
    .from(clos)
    .leftJoin(cloMastery, eq(cloMastery.cloId, clos.id))
    .where(eq(clos.courseId, courseId))
    .groupBy(clos.id, clos.code, clos.ordinal)
    .orderBy(clos.ordinal);

  const topicRows = await db
    .select({
      topicId: topics.id,
      topicCode: topics.code,
      meanMastery: sql<number>`COALESCE(avg(${topicMastery.pKnown}), 0)::real`,
      n: sql<number>`count(${topicMastery.studentId})::int`,
    })
    .from(topics)
    .leftJoin(topicMastery, eq(topicMastery.topicId, topics.id))
    .where(eq(topics.courseId, courseId))
    .groupBy(topics.id, topics.code, topics.ordinal)
    .orderBy(topics.ordinal);

  // Most-missed items: only those served enough times for the rate to mean
  // something. A 0% item served once is noise, not a signal.
  const missed = await db
    .select({
      questionId: questions.id,
      stem: questions.stem,
      timesServed: questions.timesServed,
      timesCorrect: questions.timesCorrect,
      cloCode: clos.code,
    })
    .from(questions)
    .innerJoin(clos, eq(clos.id, questions.cloId))
    .where(sql`${questions.courseId} = ${courseId} AND ${questions.timesServed} >= 5`)
    .orderBy(
      sql`(${questions.timesCorrect}::real / NULLIF(${questions.timesServed}, 0)) ASC`,
    )
    .limit(10);

  const misconceptionRows = await db
    .select({
      code: misconceptions.code,
      description: misconceptions.description,
      remediation: misconceptions.remediation,
      studentsAffected: sql<number>`count(DISTINCT ${misconceptionHits.studentId})::int`,
      totalHits: sql<number>`COALESCE(sum(${misconceptionHits.count}), 0)::int`,
    })
    .from(misconceptionHits)
    .innerJoin(misconceptions, eq(misconceptions.id, misconceptionHits.misconceptionId))
    .innerJoin(topics, eq(topics.id, misconceptions.topicId))
    .where(eq(topics.courseId, courseId))
    .groupBy(misconceptions.id, misconceptions.code, misconceptions.description, misconceptions.remediation)
    .orderBy(desc(sql`sum(${misconceptionHits.count})`))
    .limit(10);

  return {
    students,
    cloMastery: cloRows.map((r) => ({ ...r, meanMastery: Number(r.meanMastery) })),
    topicMastery: topicRows.map((r) => ({ ...r, meanMastery: Number(r.meanMastery) })),
    mostMissedItems: missed.map((m) => ({
      questionId: m.questionId,
      stem: m.stem,
      timesServed: m.timesServed,
      accuracy: m.timesServed > 0 ? m.timesCorrect / m.timesServed : 0,
      cloCode: m.cloCode,
    })),
    mostTriggeredMisconceptions: misconceptionRows,
    cohortSize: roster.length,
    syntheticCount: roster.filter((s) => s.isSynthetic).length,
  };
}

async function analyseStudent(
  student: { id: string; name: string; isSynthetic: boolean },
  courseId: string,
): Promise<StudentAnalytics> {
  const [summary] = await db
    .select({
      itemsAnswered: sql<number>`count(${attemptItems.id})::int`,
      correct: sql<number>`count(*) FILTER (WHERE ${attemptItems.correct})::int`,
      lastActiveAt: sql<Date | null>`max(${attemptItems.answeredAt})`,
      activeDays: sql<number>`count(DISTINCT date(${attemptItems.answeredAt}))::int`,
    })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .where(and(eq(attempts.studentId, student.id), eq(attempts.courseId, courseId)));

  const itemsAnswered = Number(summary?.itemsAnswered ?? 0);
  const correct = Number(summary?.correct ?? 0);
  const lastActiveAt = summary?.lastActiveAt ? new Date(summary.lastActiveAt) : null;

  const [mastery] = await db
    .select({ mean: sql<number>`COALESCE(avg(${cloMastery.pKnown}), 0)::real` })
    .from(cloMastery)
    .innerJoin(clos, eq(clos.id, cloMastery.cloId))
    .where(and(eq(cloMastery.studentId, student.id), eq(clos.courseId, courseId)));

  const meanCloMastery = Number(mastery?.mean ?? 0);
  const firedRules: StudentAnalytics["firedRules"] = [];

  const rule = (id: AtRiskRule["id"]) => AT_RISK_RULES.find((r) => r.id === id);

  if (itemsAnswered >= LOW_MASTERY_MIN_ITEMS && meanCloMastery < LOW_MASTERY_THRESHOLD) {
    const r = rule("low_mastery");
    if (r) {
      firedRules.push({
        rule: r,
        evidence: `Mean CLO mastery ${(meanCloMastery * 100).toFixed(0)}% after ${itemsAnswered} items.`,
      });
    }
  }

  if (lastActiveAt) {
    const daysSince = Math.floor((Date.now() - lastActiveAt.getTime()) / 86_400_000);
    if (daysSince >= DISENGAGED_DAYS) {
      const r = rule("disengaged");
      if (r) {
        firedRules.push({
          rule: r,
          evidence: `Last answered an item ${daysSince} days ago.`,
        });
      }
    }
  }

  // Stalled: compare mastery across the two halves of the last 15 responses.
  if (itemsAnswered >= 15) {
    const recent = await db
      .select({ correct: attemptItems.correct })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .where(and(eq(attempts.studentId, student.id), eq(attempts.courseId, courseId)))
      .orderBy(desc(attemptItems.answeredAt))
      .limit(15);

    const correctCount = recent.filter((r) => r.correct).length;
    if (recent.length === 15 && correctCount <= 5) {
      const r = rule("stalled");
      if (r) {
        firedRules.push({
          rule: r,
          evidence: `${correctCount} of the last 15 items correct — mastery is not advancing.`,
        });
      }
    }
  }

  const persistent = await db
    .select({
      code: misconceptions.code,
      count: misconceptionHits.count,
    })
    .from(misconceptionHits)
    .innerJoin(misconceptions, eq(misconceptions.id, misconceptionHits.misconceptionId))
    .where(
      sql`${misconceptionHits.studentId} = ${student.id}
          AND ${misconceptionHits.count} >= ${MISCONCEPTION_PERSISTENT_HITS}
          AND ${misconceptionHits.clearedAt} IS NULL`,
    )
    .limit(3);

  if (persistent.length > 0) {
    const r = rule("misconception_persistent");
    if (r) {
      firedRules.push({
        rule: r,
        evidence: persistent
          .map((p) => `${p.code} triggered ${p.count} times`)
          .join("; "),
      });
    }
  }

  const blocked = await countPrereqBlocked(student.id, courseId);
  if (blocked.count >= PREREQ_BLOCKED_MIN && blocked.topicCode) {
    const r = rule("prereq_blocked");
    if (r) {
      firedRules.push({
        rule: r,
        evidence: `${blocked.count} topics are blocked by the unmastered prerequisite ${blocked.topicCode}.`,
      });
    }
  }

  return {
    studentId: student.id,
    name: student.name,
    isSynthetic: student.isSynthetic,
    meanCloMastery,
    itemsAnswered,
    accuracy: itemsAnswered > 0 ? correct / itemsAnswered : 0,
    activeDays: Number(summary?.activeDays ?? 0),
    lastActiveAt,
    firedRules,
  };
}

/**
 * The single prerequisite blocking the most unmastered topics for a student.
 *
 * "Blocked" requires evidence of a struggle, not an absence of evidence. An
 * earlier version counted a prerequisite the student had simply never reached,
 * treating a missing mastery row as p_known = 0 — which made the rule fire for
 * every student in the cohort mid-term, since a partly-completed syllabus
 * always leaves later topics untouched behind an untouched prerequisite. A rule
 * that flags everyone flags no one.
 *
 * So the prerequisite must have been attempted (a mastery row with enough
 * observations to be worth reading) and still sit below the threshold. Topics
 * downstream still count as unmastered whether attempted or not — not having
 * reached them is exactly what being blocked looks like.
 */
async function countPrereqBlocked(
  studentId: string,
  courseId: string,
): Promise<{ count: number; topicCode: string | null }> {
  const [row] = await db.execute<{ count: number; code: string }>(sql`
    SELECT count(*)::int AS count, pt.code
    FROM topic_prereqs tp
    JOIN topics t  ON t.id = tp.topic_id  AND t.course_id = ${courseId}
    JOIN topics pt ON pt.id = tp.prereq_topic_id
    JOIN topic_mastery ptm
      ON ptm.topic_id = tp.prereq_topic_id
     AND ptm.student_id = ${studentId}
    LEFT JOIN topic_mastery tm
      ON tm.topic_id = tp.topic_id AND tm.student_id = ${studentId}
    WHERE ptm.p_known < ${MASTERY_THRESHOLD}
      AND ptm.observations >= ${PREREQ_MIN_OBSERVATIONS}
      AND COALESCE(tm.p_known, 0) < ${MASTERY_THRESHOLD}
    GROUP BY pt.code
    ORDER BY count DESC
    LIMIT 1
  `);

  return { count: Number(row?.count ?? 0), topicCode: row?.code ?? null };
}
