import "dotenv/config";
import { and, eq, sql as raw, type SQL } from "drizzle-orm";
import { db, sql } from "@/db/client";
import {
  assessmentItems,
  assessments,
  attempts,
  courses,
  enrollments,
  ingestJobs,
  materials,
  questions,
  systemConfig,
  users,
} from "@/db/schema";
import { hashPassword } from "@/auth/password";
import { nextItem, startAttempt, submitAnswer } from "@/student/quiz";
import { awardBadge, setLeaderboardOptIn } from "@/student/gamification";
import { regeneratePlan } from "@/student/learning-plan";
import { append } from "@/governance/audit";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

/**
 * Test accounts and demo data for the sections a fresh install leaves empty.
 *
 *   npm run seed:accounts
 *
 * Creates one signed-in-able account per role and fills the panels that have
 * nothing to show without teacher activity: an assessment, the runtime config
 * table, ingestion job history, badges and a leaderboard opt-in.
 *
 * The student's history is produced by *running the real engine* — start an
 * attempt, take what the selector serves, submit an answer — rather than by
 * writing mastery rows directly. Hand-written rows would look right on screen
 * and be internally inconsistent: a mastery figure that no sequence of answers
 * could have produced, misconception hits that match no response, points that
 * do not add up. Everything here is reachable by clicking.
 *
 * Idempotent: re-running replaces what a previous run created.
 */

/** Meets the 12-character policy; documented in the README and printed below. */
const PASSWORD = "DemoPass!2025";

const ACCOUNTS = [
  {
    email: "teacher@example.edu",
    name: "Dr Amara Okafor",
    role: "teacher" as const,
    enrolAs: "teacher" as const,
  },
  {
    email: "student@example.edu",
    name: "Sara Ahmed",
    role: "student" as const,
    enrolAs: "student" as const,
  },
  {
    email: "student2@example.edu",
    name: "Bilal Hussain",
    role: "student" as const,
    enrolAs: "student" as const,
  },
];

async function main(): Promise<void> {
  const [course] = await db.select().from(courses).where(eq(courses.code, "CS-201")).limit(1);
  if (!course) throw new Error("CS-201 not seeded. Run: npm run bootstrap");

  const [admin] = await db
    .select()
    .from(users)
    .where(eq(users.email, env.BOOTSTRAP_ADMIN_EMAIL))
    .limit(1);
  if (!admin) throw new Error("No bootstrap admin. Run: npm run seed:users");

  const passwordHash = await hashPassword(PASSWORD);
  const created: Array<{ email: string; role: string; id: string }> = [];

  for (const account of ACCOUNTS) {
    // Update-or-insert rather than delete: these ids may already own attempts
    // and audit records, and removing an account that appears in the audit
    // trail is exactly what the governance layer refuses to allow elsewhere.
    //
    // Done as an explicit lookup, not ON CONFLICT: the uniqueness of an email
    // is enforced by an index on `lower(email)`, and an expression index cannot
    // be named as a conflict target by column.
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sqlLower(users.email), account.email.toLowerCase()))
      .limit(1);

    const [user] = existing
      ? await db
          .update(users)
          .set({ name: account.name, role: account.role, status: "active", passwordHash })
          .where(eq(users.id, existing.id))
          .returning()
      : await db
          .insert(users)
          .values({
            email: account.email,
            name: account.name,
            role: account.role,
            status: "active",
            passwordHash,
            isSynthetic: false,
          })
          .returning();
    if (!user) throw new Error(`failed to create ${account.email}`);

    await db
      .insert(enrollments)
      .values({ userId: user.id, courseId: course.id, role: account.enrolAs })
      .onConflictDoNothing();

    created.push({ email: account.email, role: account.role, id: user.id });
  }

  const teacher = created.find((c) => c.role === "teacher");
  const student = created.find((c) => c.email === "student@example.edu");
  if (!teacher || !student) throw new Error("account creation did not return both roles");

  logger.info("demo accounts created", { accounts: created.length });

  /* ── student activity, produced by the engine rather than written by hand ── */

  // Clear this student's prior demo run so the figures below are from one pass.
  // Attempt items, mastery, misconception hits and points cascade with it.
  await db.delete(attempts).where(eq(attempts.studentId, student.id));

  let answered = 0;
  let correct = 0;

  // Three sessions on different days would need clock control the engine does
  // not expose, so this is one longer session: enough responses to move mastery
  // off its prior, trigger misconception feedback, and fill the progress views.
  for (let session = 0; session < 3; session += 1) {
    const { attemptId } = await startAttempt(student.id, {
      courseId: course.id,
      itemsPlanned: 8,
    });

    for (;;) {
      const served = await nextItem(student.id, attemptId);
      if (!served.item || served.finished) break;

      const options = served.item.options ?? [];
      if (options.length === 0) break;

      // A realistic mix: mostly right, with wrong answers chosen deliberately
      // so the misconception path fires and the feedback view has content.
      const answerCorrectly = answered % 3 !== 1;
      const key = await pickOption(served.item.questionId, options, answerCorrectly);

      const result = await submitAnswer(student.id, {
        attemptItemId: served.item.attemptItemId,
        response: key,
        responseMs: 4000 + ((answered * 977) % 9000),
      });

      answered += 1;
      if (result.correct) correct += 1;
    }
  }

  await regeneratePlan(student.id, course.id, "seeded demo activity");

  // Badges are awarded through the real function, so the unique constraint and
  // the label lookup are both exercised.
  for (const code of ["first_clo_mastered", "misconception_cleared", "topic_perfect"] as const) {
    await awardBadge(student.id, code);
  }
  await setLeaderboardOptIn(student.id, true);

  const other = created.find((c) => c.email === "student2@example.edu");
  if (other) await setLeaderboardOptIn(other.id, false);

  logger.info("demo student activity seeded", { answered, correct });

  /* ── teacher-side content: a saved assessment ─────────────────────────── */

  await db.delete(assessments).where(eq(assessments.createdBy, teacher.id));

  const bank = await db
    .select({ id: questions.id, targetBloom: questions.targetBloom, cloId: questions.cloId })
    .from(questions)
    .where(and(eq(questions.courseId, course.id), eq(questions.status, "approved")))
    .orderBy(questions.targetBloom)
    .limit(10);

  if (bank.length > 0) {
    const [assessment] = await db
      .insert(assessments)
      .values({
        courseId: course.id,
        createdBy: teacher.id,
        title: "Week 6 formative check — sorting and searching",
        blueprint: {
          requestedItems: bank.length,
          bloomMix: { 1: 3, 2: 4, 3: 3 },
          note: "Assembled from the approved bank; not generated by a model.",
        },
        published: true,
      })
      .returning();

    if (assessment) {
      await db.insert(assessmentItems).values(
        bank.map((item, index) => ({
          assessmentId: assessment.id,
          questionId: item.id,
          ordinal: index,
          points: item.targetBloom >= 3 ? 2 : 1,
        })),
      );
    }
    logger.info("demo assessment created", { items: bank.length });
  }

  /* ── ingestion history for the seeded material ────────────────────────── */

  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.courseId, course.id))
    .limit(1);

  if (material) {
    await db.delete(ingestJobs).where(eq(ingestJobs.materialId, material.id));
    const STAGES = ["parse", "chunk", "tag", "embed", "index", "kg_link"] as const;
    await db.insert(ingestJobs).values(
      STAGES.map((stage) => ({
        materialId: material.id,
        stage,
        status: "done" as const,
        itemsTotal: material.chunkCount,
        itemsDone: material.chunkCount,
        attempts: 1,
        startedAt: material.createdAt,
        finishedAt: material.createdAt,
        // Says plainly where this row came from, so the Materials page does not
        // imply six stages ran that never did.
        message: "Recorded by seed:accounts for the seeded corpus; not a live ingestion run.",
      })),
    );
    logger.info("ingest job history seeded", { stages: STAGES.length });
  }

  /* ── runtime configuration, so Admin → Settings is not empty ──────────── */

  const CONFIG: Array<[string, unknown]> = [
    ["llm.generation.model", env.LLM_MODEL_GENERATION],
    ["llm.generation.effort", env.LLM_EFFORT_GENERATION],
    ["llm.judge.model", env.LLM_MODEL_JUDGE],
    ["llm.judge.effort", env.LLM_EFFORT_JUDGE],
    ["llm.bulk.model", env.LLM_MODEL_BULK],
    ["llm.bulk.effort", env.LLM_EFFORT_BULK],
    ["embedding.provider", env.EMBEDDING_PROVIDER],
    ["embedding.dimensions", env.EMBEDDING_DIMENSIONS],
    ["retrieval.vectorK", env.RETRIEVAL_VECTOR_K],
    ["retrieval.lexicalK", env.RETRIEVAL_LEXICAL_K],
    ["retrieval.graphHops", env.RETRIEVAL_GRAPH_HOPS],
    ["retrieval.graphK", env.RETRIEVAL_GRAPH_K],
    ["retrieval.finalK", env.RETRIEVAL_FINAL_K],
    ["retrieval.rrfK", env.RRF_K],
    ["retrieval.graphRankPenalty", env.RRF_GRAPH_RANK_PENALTY],
    ["retrieval.rerankEnabled", env.RERANK_ENABLED],
    ["validation.enforce", env.ENFORCE_VALIDATION],
    ["validation.cloAlignThreshold", env.CLO_ALIGN_THRESHOLD],
    ["validation.groundednessThreshold", env.GROUNDEDNESS_THRESHOLD],
    ["validation.distractorThreshold", env.DISTRACTOR_THRESHOLD],
    ["chunk.targetTokens", env.CHUNK_TARGET_TOKENS],
    ["chunk.overlapTokens", env.CHUNK_OVERLAP_TOKENS],
    ["chunk.minTokens", env.CHUNK_MIN_TOKENS],
  ];

  for (const [key, value] of CONFIG) {
    await db
      .insert(systemConfig)
      .values({ key, value, updatedBy: admin.id })
      .onConflictDoUpdate({ target: systemConfig.key, set: { value, updatedBy: admin.id } });
  }
  logger.info("runtime config seeded", { keys: CONFIG.length });

  await append({
    actorId: admin.id,
    actorRole: "admin",
    action: "user.create",
    resourceType: "seed",
    resourceId: course.id,
    payload: { seededAccounts: created.map((c) => c.email), demo: true },
  });

  console.log(
    [
      "",
      "  Demo accounts (all with the same password):",
      "",
      ...created.map((c) => `    ${c.role.padEnd(8)} ${c.email}`),
      `    admin    ${env.BOOTSTRAP_ADMIN_EMAIL}`,
      "",
      `  Password for the three above: ${PASSWORD}`,
      `  Admin password:               ${env.BOOTSTRAP_ADMIN_PASSWORD}`,
      "",
      `  ${created[1]?.email} answered ${answered} items (${correct} correct) through the real`,
      "  adaptive engine, so mastery, misconceptions, points, streak and the",
      "  learning plan are all consistent with a sequence you could reproduce.",
      "",
      "  These are test accounts with published passwords. Remove them before",
      "  any real use: npm run demo:reset does not touch them.",
      "",
    ].join("\n"),
  );
}

/** Matches the `lower(email)` expression the unique index is built on. */
function sqlLower(column: typeof users.email): SQL<string> {
  return raw<string>`lower(${column})`;
}

/** Chooses an option key, correct or not, by reading the stored answer key. */
async function pickOption(
  questionId: string,
  options: Array<{ key: string }>,
  wantCorrect: boolean,
): Promise<string> {
  const [row] = await db
    .select({ options: questions.options })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);

  const stored = (row?.options ?? []) as Array<{ key: string; correct?: boolean }>;
  const match = stored.find((o) => Boolean(o.correct) === wantCorrect);
  return match?.key ?? options[0]?.key ?? "A";
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    logger.error("demo account seed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await sql.end();
    process.exitCode = 1;
  });
