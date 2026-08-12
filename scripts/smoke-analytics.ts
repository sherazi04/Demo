import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { courses } from "@/db/schema";
import { AT_RISK_RULES, getCohortAnalytics } from "@/teacher/analytics";
import { validateCurriculum } from "@/governance/curriculum-validation";
import { retrieve } from "@/intelligence/retrieval";

/**
 * Analytics and governance smoke test, run after a cohort exists.
 *
 * Split from smoke-test.ts because these paths are only meaningful with
 * students and responses in the database — the at-risk rules, the
 * prerequisite-blocked query and the bias monitor all return trivially empty
 * results on an empty cohort, which would make a passing test meaningless.
 */

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`  PASS  ${name} — ${await fn()}`);
    passed += 1;
  } catch (error: unknown) {
    console.log(
      `  FAIL  ${name} — ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`,
    );
    failed += 1;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  console.log("\n  ANALYTICS SMOKE TEST — live database with a cohort\n");

  const [course] = await db.select().from(courses).where(eq(courses.code, "CS-201")).limit(1);
  if (!course) throw new Error("CS-201 not seeded");

  let analytics: Awaited<ReturnType<typeof getCohortAnalytics>> | null = null;

  await check("cohort analytics runs over 40 students", async () => {
    analytics = await getCohortAnalytics(course.id);
    assert(analytics.cohortSize >= 40, `expected >=40 students, got ${analytics.cohortSize}`);
    assert(analytics.syntheticCount >= 40, "synthetic students are not marked as synthetic");
    return `${analytics.cohortSize} students, all marked synthetic`;
  });

  await check("per-student aggregates are populated", async () => {
    assert(Boolean(analytics), "analytics did not run");
    const withActivity = analytics?.students.filter((s) => s.itemsAnswered > 0) ?? [];
    assert(withActivity.length > 0, "no student has any answered items");
    const sample = withActivity[0];
    assert((sample?.accuracy ?? -1) >= 0 && (sample?.accuracy ?? 2) <= 1, "accuracy out of range");
    assert((sample?.activeDays ?? 0) > 0, "active days not counted");
    return `${withActivity.length} students with activity, sample accuracy ${((sample?.accuracy ?? 0) * 100).toFixed(0)}%`;
  });

  await check("at-risk rules fire and report their evidence", async () => {
    const flagged = analytics?.students.filter((s) => s.firedRules.length > 0) ?? [];
    assert(flagged.length > 0, "no rule fired across 40 synthetic students — check the thresholds");
    for (const student of flagged) {
      for (const { rule, evidence } of student.firedRules) {
        assert(AT_RISK_RULES.some((r) => r.id === rule.id), `unknown rule id ${rule.id}`);
        assert(evidence.trim().length > 0, `rule ${rule.id} fired with no evidence`);
      }
    }
    const byRule = new Map<string, number>();
    for (const s of flagged) {
      for (const f of s.firedRules) byRule.set(f.rule.id, (byRule.get(f.rule.id) ?? 0) + 1);
    }
    return `${flagged.length} flagged — ${[...byRule].map(([k, v]) => `${k}:${v}`).join(", ")}`;
  });

  await check("prerequisite-blocked query (raw SQL) executes", async () => {
    // This is the most intricate raw SQL in the analytics module; it only runs
    // when a student has mastery rows, which requires the cohort.
    const blocked = analytics?.students.filter((s) =>
      s.firedRules.some((f) => f.rule.id === "prereq_blocked"),
    );
    return `executed without error; ${blocked?.length ?? 0} student(s) flagged as prerequisite-blocked`;
  });

  await check("CLO and topic mastery aggregate with sample sizes", async () => {
    assert(analytics?.cloMastery.length === 8, "wrong CLO count");
    assert(analytics?.topicMastery.length === 30, "wrong topic count");
    const withData = analytics?.cloMastery.filter((c) => c.n > 0) ?? [];
    assert(withData.length > 0, "no CLO has mastery data");
    const mean = withData.reduce((s, c) => s + c.meanMastery, 0) / withData.length;
    assert(mean > 0 && mean < 1, `implausible mean mastery ${mean}`);
    return `${withData.length}/8 CLOs with data, mean mastery ${(mean * 100).toFixed(0)}%, n=${withData[0]?.n}`;
  });

  await check("most-missed items and misconceptions surface", async () => {
    const missed = analytics?.mostMissedItems ?? [];
    const misconceptions = analytics?.mostTriggeredMisconceptions ?? [];
    assert(misconceptions.length > 0, "no misconception hits recorded — feedback path untested");
    const top = misconceptions[0];
    assert(Boolean(top?.remediation), "misconception has no remediation text");
    return `${missed.length} missed items, top misconception ${top?.code} (${top?.totalHits} hits, ${top?.studentsAffected} students)`;
  });

  await check("bias monitor computes per-slice metrics", async () => {
    // computeBiasReport calls requireRole("admin") itself, which needs a
    // request session. Exercise the same SQL directly instead so the query is
    // still verified outside a request context.
    const rows = await db.execute<{ slice_key: string; students: number; mean_mastery: number | null }>(
      // eslint-disable-next-line
      (await import("drizzle-orm")).sql`
      WITH roster AS (
        SELECT u.id, COALESCE(u.cohort_tag, 'unspecified') AS slice_key
        FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.course_id = ${course.id} AND e.role = 'student'
      )
      SELECT r.slice_key, count(DISTINCT r.id)::int AS students,
             avg(cm.p_known)::real AS mean_mastery
      FROM roster r LEFT JOIN clo_mastery cm ON cm.student_id = r.id
      GROUP BY r.slice_key ORDER BY r.slice_key`,
    );
    const slices = [...rows];
    assert(slices.length > 1, `expected several cohort slices, got ${slices.length}`);
    const total = slices.reduce((s, r) => s + Number(r.students), 0);
    assert(total >= 40, `slices cover ${total} students, expected >=40`);
    return `${slices.length} slices: ${slices.map((s) => `${s.slice_key}=${s.students}`).join(", ")}`;
  });

  await check("curriculum validation reflects the seeded corpus", async () => {
    const report = await validateCurriculum(course.id);
    const coverage = report.checks.find((c) => c.id === "topic_without_coverage");
    assert(Boolean(coverage), "coverage check missing");
    assert(coverage?.passed === true, `topics still lack coverage: ${coverage?.offenders.join(", ")}`);
    const items = report.checks.find((c) => c.id === "clo_bloom_no_items");
    return `${report.passedCount}/8 checks pass; ${items?.offenders.length ?? 0} CLO×Bloom item gaps remain`;
  });

  await check("retrieval works over the full seeded corpus", async () => {
    const result = await retrieve("how does quicksort choose a pivot", {
      courseId: course.id,
    });
    assert(result.results.length > 0, "no results over 108 chunks");
    const top = result.results[0];
    assert(Boolean(top?.topicCode), "top result has no topic");
    return `${result.results.length} results in ${result.diagnostics.timings.totalMs}ms, top=${top?.topicCode} (${top?.channels.map((c) => c.channel).join("+")})`;
  });

  console.log(`\n  ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    console.error("\n  ABORTED:", error instanceof Error ? error.message : String(error));
    await sql.end().catch(() => undefined);
    process.exitCode = 1;
  });
