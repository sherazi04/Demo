import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { badges, leaderboardOptin, pointsLedger, streaks, users } from "@/db/schema";
import { logger } from "@/lib/logger";

/**
 * Points, badges, streaks and the opt-in leaderboard (design.md §8.6,
 * FR-STU-050..054).
 *
 * Points live in an append-only ledger and the balance is always a SUM, never a
 * mutable counter — the award history stays auditable and cannot be silently
 * edited.
 */

export const BADGE_CODES = [
  "first_clo_mastered",
  "streak_7",
  "misconception_cleared",
  "topic_perfect",
  "prereq_unblocked",
] as const;

export type BadgeCode = (typeof BADGE_CODES)[number];

export const BADGE_LABELS: Record<BadgeCode, { title: string; description: string }> = {
  first_clo_mastered: {
    title: "First outcome mastered",
    description: "Reached 85% mastery on a course learning outcome.",
  },
  streak_7: {
    title: "Seven-day streak",
    description: "Answered at least one item on seven consecutive days.",
  },
  misconception_cleared: {
    title: "Misconception cleared",
    description: "Answered correctly on a topic where you previously held a misconception.",
  },
  topic_perfect: {
    title: "Perfect topic run",
    description: "Answered every item in a topic run correctly.",
  },
  prereq_unblocked: {
    title: "Prerequisite unblocked",
    description: "Mastered a prerequisite that was holding back later topics.",
  },
};

/** `round(10 × (0.5 + difficulty_elo))` — harder items are worth more. */
export function pointsFor(difficultyElo: number): number {
  return Math.round(10 * (0.5 + Math.max(0, Math.min(1, difficultyElo))));
}

export interface AwardResult {
  pointsAwarded: number;
  reason: string;
  newBadges: BadgeCode[];
  streak: { current: number; longest: number };
}

/**
 * Awards points for one correct answer.
 *
 * No-farming rules (FR-STU-054): zero points for an item already answered
 * correctly, and zero for a topic already at or above the high-mastery
 * threshold. The unique index on (student_id, question_id) enforces the first
 * at the database level too, so a concurrent double-submit cannot double-award.
 */
export async function awardForCorrectAnswer(input: {
  studentId: string;
  questionId: string;
  difficultyElo: number;
  topicPKnown: number;
  masteryHigh: number;
}): Promise<{ pointsAwarded: number; reason: string }> {
  if (input.topicPKnown >= input.masteryHigh) {
    return {
      pointsAwarded: 0,
      reason: "No points: this topic is already mastered.",
    };
  }

  const [existing] = await db
    .select({ id: pointsLedger.id })
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.studentId, input.studentId),
        eq(pointsLedger.questionId, input.questionId),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      pointsAwarded: 0,
      reason: "No points: you have already earned points for this item.",
    };
  }

  const delta = pointsFor(input.difficultyElo);

  try {
    await db.insert(pointsLedger).values({
      studentId: input.studentId,
      delta,
      reason: "correct_answer",
      questionId: input.questionId,
    });
  } catch {
    // The unique index rejected a concurrent duplicate — the correct outcome is
    // no award, not an error the student sees.
    return { pointsAwarded: 0, reason: "No points: already awarded for this item." };
  }

  return {
    pointsAwarded: delta,
    reason: `+${delta} points (difficulty ${input.difficultyElo.toFixed(2)})`,
  };
}

/** Balance is always a SUM over the ledger. */
export async function pointsBalance(studentId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(sum(${pointsLedger.delta}), 0)::int` })
    .from(pointsLedger)
    .where(eq(pointsLedger.studentId, studentId));
  return Number(row?.total ?? 0);
}

/**
 * Records activity for today and advances the streak.
 *
 * Uses calendar dates rather than 24-hour windows: a streak is a per-day
 * concept, and a student answering at 23:50 then 00:10 has been active on two
 * days, not one.
 */
export async function touchStreak(
  studentId: string,
  today = new Date(),
): Promise<{ current: number; longest: number; advanced: boolean }> {
  const todayStr = toDateString(today);

  const [existing] = await db
    .select()
    .from(streaks)
    .where(eq(streaks.studentId, studentId))
    .limit(1);

  if (!existing) {
    await db
      .insert(streaks)
      .values({ studentId, current: 1, longest: 1, lastActiveDate: todayStr })
      .onConflictDoNothing();
    return { current: 1, longest: 1, advanced: true };
  }

  if (existing.lastActiveDate === todayStr) {
    // Already counted today — the streak advances once per day, not per item.
    return { current: existing.current, longest: existing.longest, advanced: false };
  }

  const yesterdayStr = toDateString(new Date(today.getTime() - 86_400_000));
  const current = existing.lastActiveDate === yesterdayStr ? existing.current + 1 : 1;
  const longest = Math.max(current, existing.longest);

  await db
    .update(streaks)
    .set({ current, longest, lastActiveDate: todayStr })
    .where(eq(streaks.studentId, studentId));

  return { current, longest, advanced: true };
}

function toDateString(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

/** Awards a badge if not already held. Returns true when newly awarded. */
export async function awardBadge(studentId: string, code: BadgeCode): Promise<boolean> {
  try {
    const inserted = await db
      .insert(badges)
      .values({ studentId, code })
      .onConflictDoNothing()
      .returning();
    return inserted.length > 0;
  } catch (error: unknown) {
    logger.warn("badge award failed", {
      studentId,
      code,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function listBadges(studentId: string) {
  const rows = await db
    .select({ code: badges.code, awardedAt: badges.awardedAt })
    .from(badges)
    .where(eq(badges.studentId, studentId))
    .orderBy(badges.awardedAt);

  return rows.map((row) => ({
    code: row.code,
    awardedAt: row.awardedAt,
    ...(BADGE_LABELS[row.code as BadgeCode] ?? {
      title: row.code,
      description: "",
    }),
  }));
}

export async function getStreak(studentId: string) {
  const [row] = await db.select().from(streaks).where(eq(streaks.studentId, studentId)).limit(1);
  return { current: row?.current ?? 0, longest: row?.longest ?? 0, lastActiveDate: row?.lastActiveDate ?? null };
}

export async function setLeaderboardOptIn(studentId: string, optedIn: boolean): Promise<void> {
  await db
    .insert(leaderboardOptin)
    .values({ studentId, optedIn, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: leaderboardOptin.studentId,
      set: { optedIn, updatedAt: new Date() },
    });
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  displayName: string;
  points: number;
  isSelf: boolean;
}

/**
 * Cohort-scoped, opt-in leaderboard (FR-STU-053).
 *
 * A student who has not opted in cannot SEE the board and does not APPEAR on
 * it — both directions matter. Returning null rather than an empty array makes
 * that state explicit to the caller.
 */
export async function getLeaderboard(
  studentId: string,
): Promise<LeaderboardEntry[] | null> {
  const [self] = await db
    .select({ optedIn: leaderboardOptin.optedIn })
    .from(leaderboardOptin)
    .where(eq(leaderboardOptin.studentId, studentId))
    .limit(1);

  if (!self?.optedIn) return null;

  const rows = await db
    .select({
      studentId: pointsLedger.studentId,
      name: users.name,
      points: sql<number>`COALESCE(sum(${pointsLedger.delta}), 0)::int`,
    })
    .from(pointsLedger)
    .innerJoin(users, eq(users.id, pointsLedger.studentId))
    .innerJoin(leaderboardOptin, eq(leaderboardOptin.studentId, pointsLedger.studentId))
    .where(eq(leaderboardOptin.optedIn, true))
    .groupBy(pointsLedger.studentId, users.name)
    .orderBy(sql`sum(${pointsLedger.delta}) DESC`)
    .limit(20);

  return rows.map((row, index) => ({
    rank: index + 1,
    studentId: row.studentId,
    // Only the viewer's own name is shown in full; others are initials, so an
    // opt-in to ranking is not an opt-in to being identified by name.
    displayName: row.studentId === studentId ? row.name : initials(row.name),
    points: Number(row.points),
    isSelf: row.studentId === studentId,
  }));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
