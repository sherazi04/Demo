import "dotenv/config";
import { and, eq, sql as raw } from "drizzle-orm";
import { db, sql } from "@/db/client";
import {
  attemptItems,
  attempts,
  cloMastery,
  cloTopics,
  clos,
  courses,
  enrollments,
  misconceptionHits,
  misconceptions,
  pointsLedger,
  questions,
  streaks,
  topicMastery,
  users,
} from "@/db/schema";
import type { QuestionOption } from "@/db/schema/assessment";
import { hashPassword } from "@/auth/password";
import { bktUpdate, guessRateFor, cloMasteryFrom, DEFAULT_BKT } from "@/student/bkt";
import { eloUpdate } from "@/student/elo";
import { expectedScore } from "@/student/elo";
import { pointsFor } from "@/student/gamification";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Synthetic cohort generator (requirements.md §4.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ROW THIS SCRIPT WRITES IS LABELLED SYNTHETIC.
 *
 * `users.is_synthetic` and `attempts.is_synthetic` are set on everything, and
 * the UI renders a persistent marker wherever such a record appears. This data
 * exercises the analytics, the bias monitor and the at-risk rules; it
 * demonstrates NOTHING about real learning, and any report drawn from it must
 * say so (R9, design.md §16.4).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const COHORT_SIZE = 40;
const SYNTHETIC_PASSWORD = "synthetic-cohort-not-for-login";
/** Length of the simulated term, in days. */
const TERM_DAYS = 70;

/** Behaviour profiles from requirements.md §4.4. */
type Profile = "consistent" | "cramming" | "declining" | "disengaged";

interface SyntheticStudent {
  name: string;
  email: string;
  cohortTag: string;
  profile: Profile;
  /** Latent ability in [0,1] — the ground truth responses are drawn against. */
  ability: number;
  /** How many days of activity, and how they are distributed. */
  sessionCount: number;
}

/**
 * Deterministic PRNG (mulberry32). A fixed seed means the cohort is
 * reproducible: two people running the demo see the same numbers, and a
 * regression in the analytics is distinguishable from a different random draw.
 */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20260101);

/** Box–Muller, so ability is normally distributed rather than uniform. */
function normal(mean: number, sd: number): number {
  const u1 = Math.max(random(), 1e-9);
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

const FIRST_NAMES = [
  "Amara", "Bilal", "Chen", "Dara", "Elif", "Farid", "Gita", "Hana", "Idris", "Jun",
  "Kavya", "Liang", "Mira", "Nadia", "Omar", "Priya", "Quinn", "Rania", "Sofia", "Tariq",
  "Uzo", "Vera", "Wei", "Xochitl", "Yusuf", "Zara", "Anika", "Bruno", "Camila", "Dmitri",
  "Esan", "Fatima", "Giulia", "Hiroshi", "Ines", "Jamal", "Kiran", "Lena", "Mateo", "Noor",
];

const LAST_NAMES = [
  "Okafor", "Rahman", "Wei", "Singh", "Yilmaz", "Haddad", "Sharma", "Sato", "Diallo", "Park",
  "Nair", "Zhang", "Costa", "Petrov", "Hassan", "Patel", "Murphy", "Aziz", "Rossi", "Khan",
  "Eze", "Novak", "Lin", "Ramirez", "Demir", "Ahmed", "Ferrari", "Tanaka", "Silva", "Ivanov",
  "Adeyemi", "Bakr", "Conti", "Yamada", "Moreau", "Farah", "Reddy", "Weber", "Garcia", "Ali",
];

/** Coarse buckets read only by the bias monitor (FR-GOV-012). */
const COHORT_TAGS = ["group-a", "group-b", "group-c", "unspecified"];

function buildCohort(): SyntheticStudent[] {
  const students: SyntheticStudent[] = [];

  for (let i = 0; i < COHORT_SIZE; i += 1) {
    // Realistic spread: centred slightly below the midpoint, clipped to a band
    // that keeps every student answering *some* questions correctly.
    const ability = Math.max(0.12, Math.min(0.92, normal(0.52, 0.18)));

    const roll = random();
    const profile: Profile =
      roll < 0.45 ? "consistent" : roll < 0.7 ? "cramming" : roll < 0.88 ? "declining" : "disengaged";

    const sessionCount =
      profile === "disengaged"
        ? 1 + Math.floor(random() * 2)
        : profile === "cramming"
          ? 2 + Math.floor(random() * 2)
          : 5 + Math.floor(random() * 6);

    const first = FIRST_NAMES[i % FIRST_NAMES.length] ?? "Student";
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length] ?? "Synthetic";

    students.push({
      name: `${first} ${last}`,
      email: `synthetic.${i + 1}@example.edu`,
      cohortTag: COHORT_TAGS[i % COHORT_TAGS.length] ?? "unspecified",
      profile,
      ability,
      sessionCount,
    });
  }

  return students;
}

/**
 * Ability at the time of one response, given the profile.
 *
 * This is what makes the four profiles distinguishable in the analytics rather
 * than just labels: `declining` genuinely gets worse over the term, so the
 * `stalled` at-risk rule has something real to detect.
 */
function abilityAt(student: SyntheticStudent, progress: number): number {
  switch (student.profile) {
    case "consistent":
      // Steady improvement across the term.
      return Math.min(0.97, student.ability + progress * 0.18);
    case "cramming":
      // Flat, then a late surge — most activity bunched at the end.
      return Math.min(0.97, student.ability + (progress > 0.7 ? 0.22 : 0.02));
    case "declining":
      // Starts adequate, falls away.
      return Math.max(0.05, student.ability - progress * 0.3);
    case "disengaged":
      // Little movement in either direction.
      return student.ability;
  }
}

async function main(): Promise<void> {
  const [course] = await db
    .select({ id: courses.id, code: courses.code })
    .from(courses)
    .limit(1);
  if (!course) {
    throw new Error("No course found. Run `npm run seed:curriculum` first.");
  }

  const approved = await db
    .select({
      id: questions.id,
      topicId: questions.topicId,
      cloId: questions.cloId,
      type: questions.type,
      targetBloom: questions.targetBloom,
      difficultyElo: questions.difficultyElo,
      options: questions.options,
    })
    .from(questions)
    .where(and(eq(questions.courseId, course.id), eq(questions.status, "approved")));

  if (approved.length === 0) {
    throw new Error(
      "No approved items in the bank. Generate and approve an assessment before seeding a cohort — " +
        "responses have to be against real items for the analytics to mean anything.",
    );
  }

  logger.info("seeding synthetic cohort", {
    students: COHORT_SIZE,
    approvedItems: approved.length,
    course: course.code,
  });

  const misconceptionRows = await db
    .select({ id: misconceptions.id, code: misconceptions.code })
    .from(misconceptions);
  const misconceptionByCode = new Map(misconceptionRows.map((m) => [m.code, m.id]));

  const cohort = buildCohort();
  const passwordHash = await hashPassword(SYNTHETIC_PASSWORD);
  const termStart = Date.now() - TERM_DAYS * 86_400_000;

  /*
   * Idempotency by construction: remove the previous synthetic cohort first.
   *
   * Without this the insert below hits `onConflictDoNothing`, returns no row,
   * and every existing student is silently skipped — leaving a stale cohort
   * with the old dates while the script reports success. Deleting the users
   * cascades to their attempts, mastery, ledger and streaks.
   */
  const removed = await db
    .delete(users)
    .where(eq(users.isSynthetic, true))
    .returning({ id: users.id });
  if (removed.length > 0) {
    logger.info("removed the previous synthetic cohort", { students: removed.length });
  }

  for (const student of cohort) {
    const [user] = await db
      .insert(users)
      .values({
        email: student.email,
        name: student.name,
        role: "student",
        // Suspended: these accounts must never be usable to log in.
        status: "suspended",
        passwordHash,
        cohortTag: student.cohortTag,
        isSynthetic: true,
      })
      .onConflictDoNothing()
      .returning();

    if (!user) continue;

    await db
      .insert(enrollments)
      .values({ userId: user.id, courseId: course.id, role: "student" })
      .onConflictDoNothing();

    const masteryByTopic = new Map<string, { pKnown: number; observations: number }>();
    let lastActive = termStart;

    for (let session = 0; session < student.sessionCount; session += 1) {
      const progress = student.sessionCount > 1 ? session / (student.sessionCount - 1) : 0;

      /*
       * Activity must run right up to the present for the `disengaged` rule to
       * discriminate. An earlier version stopped ~10 days short of today, which
       * tripped the 7-day rule for every profile and made the flag useless —
       * the rule looked broken when it was the simulated calendar that was.
       *
       * `consistent` and `cramming` therefore finish within the last day or
       * two; `declining` tails off a fortnight back; `disengaged` stops early
       * and is the profile the rule should actually catch.
       */
      const span = TERM_DAYS - 2;
      const dayOffset =
        student.profile === "cramming"
          ? Math.floor(span * 0.65) + Math.floor(progress * (span * 0.35))
          : student.profile === "declining"
            ? Math.floor(progress * (span - 14))
            : student.profile === "disengaged"
              ? Math.floor(progress * (span * 0.3))
              : Math.floor(progress * span);
      const startedAt = new Date(termStart + dayOffset * 86_400_000 + random() * 3_600_000);
      lastActive = Math.max(lastActive, startedAt.getTime());

      const itemsPlanned = 6 + Math.floor(random() * 5);
      const [attempt] = await db
        .insert(attempts)
        .values({
          studentId: user.id,
          courseId: course.id,
          mode: "adaptive",
          itemsPlanned,
          startedAt,
          isSynthetic: true,
        })
        .returning();
      if (!attempt) continue;

      let answered = 0;
      let correctCount = 0;

      for (let n = 0; n < itemsPlanned; n += 1) {
        const question = approved[Math.floor(random() * approved.length)];
        if (!question) continue;

        const current = masteryByTopic.get(question.topicId) ?? {
          pKnown: env.BKT_P_INIT,
          observations: 0,
        };
        const ability = abilityAt(student, progress);

        // Response is probabilistic on latent ability versus item difficulty —
        // the same logistic the Elo update uses, so the two agree.
        const pCorrect = expectedScore(ability, question.difficultyElo);
        const correct = random() < pCorrect;

        const options = (question.options ?? []) as QuestionOption[];
        const correctOption = options.find((o) => o.correct);

        // Misconception-biased distractor selection: a wrong answer is far more
        // likely to land on a distractor targeting a real misconception than on
        // an arbitrary one.
        let chosen: QuestionOption | undefined;
        if (correct) {
          chosen = correctOption;
        } else {
          const distractors = options.filter((o) => !o.correct);
          const mapped = distractors.filter((o) => o.misconceptionCode);
          const pool = mapped.length > 0 && random() < 0.75 ? mapped : distractors;
          chosen = pool[Math.floor(random() * pool.length)];
        }

        const answeredAt = new Date(startedAt.getTime() + n * 90_000 + random() * 60_000);
        const misconceptionId = chosen?.misconceptionCode
          ? (misconceptionByCode.get(chosen.misconceptionCode) ?? null)
          : null;

        await db.insert(attemptItems).values({
          attemptId: attempt.id,
          questionId: question.id,
          ordinal: n,
          response: chosen?.key ?? "A",
          correct,
          misconceptionId: correct ? null : misconceptionId,
          responseMs: 20_000 + Math.floor(random() * 90_000),
          servedDifficulty: question.difficultyElo,
          servedAt: answeredAt,
          answeredAt,
        });

        const pGuess = guessRateFor(question.type, options.length || 4);
        const updated = bktUpdate(current.pKnown, correct, { ...DEFAULT_BKT, pGuess });
        masteryByTopic.set(question.topicId, {
          pKnown: updated,
          observations: current.observations + 1,
        });

        // Elo moves too, so the item bank calibrates from this cohort exactly
        // as it would from real responses.
        await db
          .update(questions)
          .set({
            difficultyElo: eloUpdate(
              question.difficultyElo,
              current.pKnown,
              correct,
              0,
            ),
            timesServed: raw`${questions.timesServed} + 1`,
            timesCorrect: correct
              ? raw`${questions.timesCorrect} + 1`
              : questions.timesCorrect,
          })
          .where(eq(questions.id, question.id));

        if (!correct && misconceptionId) {
          await db
            .insert(misconceptionHits)
            .values({
              studentId: user.id,
              misconceptionId,
              count: 1,
              lastHitAt: answeredAt,
            })
            .onConflictDoUpdate({
              target: [misconceptionHits.studentId, misconceptionHits.misconceptionId],
              set: { count: raw`${misconceptionHits.count} + 1`, lastHitAt: answeredAt },
            });
        }

        if (correct) {
          correctCount += 1;
          await db
            .insert(pointsLedger)
            .values({
              studentId: user.id,
              delta: pointsFor(question.difficultyElo),
              reason: "correct_answer",
              questionId: question.id,
              createdAt: answeredAt,
            })
            .onConflictDoNothing();
        }
        answered += 1;
      }

      await db
        .update(attempts)
        .set({
          itemsAnswered: answered,
          score: answered > 0 ? correctCount / answered : 0,
          terminationReason: "count",
          finishedAt: new Date(startedAt.getTime() + answered * 100_000),
        })
        .where(eq(attempts.id, attempt.id));
    }

    // Persist final mastery state.
    for (const [topicId, state] of masteryByTopic) {
      await db
        .insert(topicMastery)
        .values({
          studentId: user.id,
          topicId,
          pKnown: state.pKnown,
          observations: state.observations,
          updatedAt: new Date(lastActive),
        })
        .onConflictDoUpdate({
          target: [topicMastery.studentId, topicMastery.topicId],
          set: { pKnown: state.pKnown, observations: state.observations },
        });
    }

    await recomputeAllCloMastery(user.id, course.id);

    await db
      .insert(streaks)
      .values({
        studentId: user.id,
        current: student.profile === "consistent" ? 3 + Math.floor(random() * 6) : 1,
        longest: student.profile === "consistent" ? 7 + Math.floor(random() * 5) : 2,
        lastActiveDate: new Date(lastActive).toISOString().slice(0, 10),
      })
      .onConflictDoNothing();
  }

  const profiles = cohort.reduce<Record<string, number>>((acc, s) => {
    acc[s.profile] = (acc[s.profile] ?? 0) + 1;
    return acc;
  }, {});

  logger.info("synthetic cohort seeded", {
    students: cohort.length,
    profiles,
    note: "All rows are labelled synthetic and demonstrate nothing about real learning.",
  });

  console.log(
    [
      "",
      `  Seeded ${cohort.length} synthetic students into ${course.code}.`,
      `  Profiles: ${Object.entries(profiles)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`,
      "",
      "  Every account is suspended and cannot log in.",
      "  Every record is labelled synthetic and carries a marker in the UI.",
      "  This data exercises the analytics and the bias monitor. It demonstrates",
      "  nothing about real learning and must not be reported as a result.",
      "",
    ].join("\n"),
  );
}

async function recomputeAllCloMastery(studentId: string, courseId: string): Promise<void> {
  const cloRows = await db
    .select({ id: clos.id })
    .from(clos)
    .where(eq(clos.courseId, courseId));

  for (const clo of cloRows) {
    const rows = await db
      .select({ pKnown: topicMastery.pKnown, observations: topicMastery.observations })
      .from(cloTopics)
      .leftJoin(
        topicMastery,
        and(
          eq(topicMastery.topicId, cloTopics.topicId),
          eq(topicMastery.studentId, studentId),
        ),
      )
      .where(eq(cloTopics.cloId, clo.id));

    const value = cloMasteryFrom(
      rows.map((r) => ({ pKnown: r.pKnown ?? 0, observations: r.observations ?? 0 })),
    );

    await db
      .insert(cloMastery)
      .values({ studentId, cloId: clo.id, pKnown: value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [cloMastery.studentId, cloMastery.cloId],
        set: { pKnown: value, updatedAt: new Date() },
      });
  }
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    logger.error("cohort seed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await sql.end();
    process.exitCode = 1;
  });
