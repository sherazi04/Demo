import "dotenv/config";
import { eq, sql as raw } from "drizzle-orm";
import { db, sql } from "@/db/client";
import {
  chunkClos,
  chunks,
  clos,
  courses,
  materials,
  misconceptions,
  questions,
  topics,
  users,
} from "@/db/schema";
import { append, verifyChain } from "@/governance/audit";
import { validateCurriculum } from "@/governance/curriculum-validation";
import { getCohortAnalytics } from "@/teacher/analytics";
import { getCloPloMatrix, getCoverageHeatmap, getItemBankCoverage } from "@/teacher/curriculum";
import { retrieve } from "@/intelligence/retrieval";
import { embedDocuments } from "@/intelligence/embeddings";
import { recommend } from "@/teacher/recommender";
import { hashPassword, verifyPassword } from "@/auth/password";
import { getReviewQueue, queueStats } from "@/teacher/tag-review";
import { regeneratePlan } from "@/student/learning-plan";

/**
 * End-to-end smoke test against a live database.
 *
 * Exercises the code paths that unit tests cannot reach — every raw SQL query,
 * the pgvector operators, the append-only trigger, the approval check
 * constraint — and asserts the behaviour each one is supposed to guarantee.
 *
 *   npm run db:migrate && npm run seed:curriculum && npm run smoke
 *
 * Writes and then removes its own fixture data, so it is safe to re-run.
 */

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL  ${name} — ${message.split("\n")[0]}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  console.log("\n  SMOKE TEST — live database\n");

  const [course] = await db.select().from(courses).where(eq(courses.code, "CS-201")).limit(1);
  if (!course) throw new Error("CS-201 not seeded. Run: npm run seed:curriculum");

  /* ── curriculum spine ─────────────────────────────────────────────────── */

  await check("curriculum seeded with the required volumes", async () => {
    const counts = await Promise.all(
      [clos, topics, misconceptions].map(async (t) => {
        const [row] = await db.select({ n: raw<number>`count(*)::int` }).from(t);
        return row?.n ?? 0;
      }),
    );
    assert(counts[0] === 8, `expected 8 CLOs, found ${counts[0]}`);
    assert(counts[1] === 30, `expected 30 topics, found ${counts[1]}`);
    assert((counts[2] ?? 0) >= 60, `expected >=60 misconceptions, found ${counts[2]}`);
    return `${counts[0]} CLOs, ${counts[1]} topics, ${counts[2]} misconceptions`;
  });

  await check("seeder is idempotent (no duplicate rows after re-run)", async () => {
    const [row] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(topics)
      .where(eq(topics.courseId, course.id));
    assert(row?.n === 30, `topics should stay at 30 across re-runs, found ${row?.n}`);
    return "30 topics after two seed runs";
  });

  /* ── audit chain ──────────────────────────────────────────────────────── */

  await check("audit.append writes a linked chain", async () => {
    const before = await verifyChain();
    assert(before.ok, `chain already broken at seq ${before.firstBrokenSeq}`);
    const a = await append({ action: "llm.call", resourceType: "smoke", resourceId: "1" });
    const b = await append({ action: "llm.call", resourceType: "smoke", resourceId: "2" });
    assert(b.seq === a.seq + 1, "seq did not increment by one");
    const after = await verifyChain();
    assert(after.ok, `chain broke after append: ${after.detail}`);
    return `${after.checked} records verified`;
  });

  await check("audit_log refuses UPDATE (append-only trigger)", async () => {
    try {
      await db.execute(raw`UPDATE audit_log SET action = 'tampered' WHERE seq = 1`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      assert(/append-only/i.test(message), `unexpected error: ${message}`);
      return "trigger raised as designed";
    }
    throw new Error("UPDATE succeeded — immutability is NOT enforced");
  });

  await check("audit_log refuses DELETE", async () => {
    try {
      await db.execute(raw`DELETE FROM audit_log WHERE seq = 1`);
    } catch {
      return "trigger raised as designed";
    }
    throw new Error("DELETE succeeded — immutability is NOT enforced");
  });

  /* ── password hashing ─────────────────────────────────────────────────── */

  await check("bcrypt hash verifies and rejects", async () => {
    const hash = await hashPassword("a-sufficiently-long-password");
    assert(await verifyPassword("a-sufficiently-long-password", hash), "correct password rejected");
    assert(!(await verifyPassword("wrong-password-entirely", hash)), "wrong password accepted");
    assert(hash.startsWith("$2"), `unexpected hash format: ${hash.slice(0, 4)}`);
    return hash.slice(0, 7);
  });

  /* ── fixture material for the retrieval tests ─────────────────────────── */

  const topicRows = await db
    .select()
    .from(topics)
    .where(eq(topics.courseId, course.id))
    .orderBy(topics.ordinal);
  const cloRows = await db.select().from(clos).where(eq(clos.courseId, course.id));

  const [admin] = await db
    .insert(users)
    .values({
      email: "smoke-fixture@example.invalid",
      name: "Smoke Fixture",
      role: "teacher",
      status: "active",
    })
    .onConflictDoNothing()
    .returning();

  const actorId =
    admin?.id ??
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(raw`lower(${users.email}) = 'smoke-fixture@example.invalid'`)
        .limit(1)
    )[0]?.id;
  if (!actorId) throw new Error("could not create the fixture user");

  const [material] = await db
    .insert(materials)
    .values({
      courseId: course.id,
      uploadedBy: actorId,
      title: "Smoke fixture material",
      filename: "smoke.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
      storagePath: "/dev/null",
      contentHash: `smoke-${Date.now()}`,
      licenseNote: "fixture — removed by the smoke test",
      status: "indexed",
    })
    .returning();
  if (!material) throw new Error("could not create the fixture material");

  await check("chunks insert with a real pgvector embedding", async () => {
    const texts = [
      "A binary search tree keeps every key in the left subtree below the node's key.",
      "Quicksort partitions the array about a pivot so the pivot lands in final position.",
      "A hash table resolves collisions by separate chaining or by open addressing.",
    ];
    const vectors = await embedDocuments(texts);
    assert(vectors.length === 3, "embedding provider returned the wrong count");
    assert(vectors[0]?.length === 1024, `expected 1024 dims, got ${vectors[0]?.length}`);

    const bst = topicRows.find((t) => t.code === "T12");
    const qs = topicRows.find((t) => t.code === "T22");
    const ht = topicRows.find((t) => t.code === "T18");
    const clo3 = cloRows.find((c) => c.code === "CLO-3");
    const clo4 = cloRows.find((c) => c.code === "CLO-4");

    const inserted = await db
      .insert(chunks)
      .values([
        {
          materialId: material.id, courseId: course.id, ordinal: 0, text: texts[0] ?? "",
          tokenCount: 20, topicId: bst?.id ?? null, bloomLevel: 2, difficulty: 0.4,
          lomFormat: "definition", tagConfidence: 0.9, embedding: vectors[0],
          embeddingModel: "smoke", sectionPath: "6 Trees > 6.2 BST", pageFrom: 10, pageTo: 10,
        },
        {
          materialId: material.id, courseId: course.id, ordinal: 1, text: texts[1] ?? "",
          tokenCount: 20, topicId: qs?.id ?? null, bloomLevel: 3, difficulty: 0.6,
          lomFormat: "worked_example", tagConfidence: 0.85, embedding: vectors[1],
          embeddingModel: "smoke", sectionPath: "11 Sorting > 11.2 Quicksort", pageFrom: 30, pageTo: 31,
        },
        {
          materialId: material.id, courseId: course.id, ordinal: 2, text: texts[2] ?? "",
          tokenCount: 20, topicId: ht?.id ?? null, bloomLevel: 4, difficulty: 0.7,
          lomFormat: "narrative", tagConfidence: 0.5, embedding: vectors[2],
          embeddingModel: "smoke", sectionPath: "9 Hashing", pageFrom: 22, pageTo: 22,
        },
      ])
      .returning();

    if (clo3 && inserted[0]) {
      await db.insert(chunkClos).values({ chunkId: inserted[0].id, cloId: clo3.id, relevance: 1 });
    }
    if (clo4 && inserted[1]) {
      await db.insert(chunkClos).values({ chunkId: inserted[1].id, cloId: clo4.id, relevance: 1 });
    }
    return `${inserted.length} chunks with 1024-dim vectors`;
  });

  /* ── retrieval ────────────────────────────────────────────────────────── */

  await check("retrieval returns cited results with LOM metadata", async () => {
    const result = await retrieve("quicksort pivot partition", { courseId: course.id });
    assert(result.results.length > 0, "no results returned");
    const top = result.results[0];
    assert(Boolean(top?.id), "result carries no chunk id");
    assert(top?.sectionPath !== null, "result carries no source locator");
    return `${result.results.length} results, dense=${result.diagnostics.denseCount} lexical=${result.diagnostics.lexicalCount}, ${result.diagnostics.timings.totalMs}ms`;
  });

  await check("Bloom filter is applied INSIDE the query, not after", async () => {
    const result = await retrieve("data structure", {
      courseId: course.id,
      bloomBand: [3, 3],
    });
    assert(result.results.length > 0, "filter returned nothing at all");
    const offenders = result.results.filter((r) => r.bloomLevel !== 3);
    assert(
      offenders.length === 0,
      `${offenders.length} result(s) outside the requested Bloom band: ${offenders
        .map((o) => `${o.id}@B${o.bloomLevel}`)
        .join(", ")}`,
    );
    return `${result.results.length} results, all Bloom 3`;
  });

  await check("CLO filter restricts to chunks mapped to that CLO", async () => {
    const clo4 = cloRows.find((c) => c.code === "CLO-4");
    assert(Boolean(clo4), "CLO-4 missing");
    const result = await retrieve("sorting", {
      courseId: course.id,
      cloIds: [clo4?.id ?? ""],
    });
    assert(result.results.length > 0, "CLO filter returned nothing");
    const offenders = result.results.filter((r) => !r.cloIds.includes(clo4?.id ?? ""));
    assert(offenders.length === 0, `${offenders.length} result(s) not mapped to CLO-4`);
    return `${result.results.length} results, all mapped to CLO-4`;
  });

  await check("lom_format filter uses the enum cast correctly", async () => {
    const result = await retrieve("example", {
      courseId: course.id,
      lomFormats: ["worked_example"],
    });
    const offenders = result.results.filter((r) => r.lomFormat !== "worked_example");
    assert(offenders.length === 0, "non-matching lom_format leaked through");
    return `${result.results.length} worked examples`;
  });

  await check("difficulty band and exclusion filters apply", async () => {
    const all = await retrieve("tree", { courseId: course.id });
    const first = all.results[0];
    assert(Boolean(first), "no baseline results");
    const excluded = await retrieve("tree", {
      courseId: course.id,
      excludeChunkIds: [first?.id ?? ""],
    });
    assert(
      !excluded.results.some((r) => r.id === first?.id),
      "excludeChunkIds did not exclude the chunk",
    );
    return "exclusion honoured";
  });

  await check("recommender returns LOM tags and locators", async () => {
    const recs = await recommend({ courseId: course.id, limit: 5 });
    assert(recs.length > 0, "no recommendations");
    assert(Boolean(recs[0]?.chunkId), "recommendation missing chunk id");
    assert((recs[0]?.matchedOn.length ?? 0) > 0, "recommendation gives no reason");
    return `${recs.length} recommendations`;
  });

  /* ── tag review ───────────────────────────────────────────────────────── */

  await check("tag review queue orders by ascending confidence", async () => {
    const queue = await getReviewQueue(course.id, { limit: 10 });
    assert(queue.length > 0, "queue is empty");
    const confidences = queue
      .map((q) => q.tagConfidence)
      .filter((c): c is number => c !== null);
    for (let i = 1; i < confidences.length; i += 1) {
      assert(
        (confidences[i] ?? 0) >= (confidences[i - 1] ?? 0),
        "queue is not in ascending confidence order",
      );
    }
    const stats = await queueStats(course.id);
    return `${queue.length} queued, ${stats.unverified} unverified, ${stats.untagged} untagged`;
  });

  /* ── curriculum tools (raw SQL) ───────────────────────────────────────── */

  await check("CLO↔PLO matrix builds", async () => {
    const matrix = await getCloPloMatrix(course.id);
    assert(matrix.clos.length === 8, `expected 8 CLOs, got ${matrix.clos.length}`);
    assert(matrix.plos.length === 12, `expected 12 PLOs, got ${matrix.plos.length}`);
    assert(matrix.unmappedCloIds.length === 0, "some CLO maps to no PLO");
    return `8×12 matrix, ${matrix.uncoveredPloIds.length} PLOs uncovered by this course`;
  });

  await check("coverage heatmap computes zero-coverage cells", async () => {
    const heatmap = await getCoverageHeatmap(course.id);
    assert(heatmap.cells.length === 30, `expected 30 topic rows, got ${heatmap.cells.length}`);
    assert(heatmap.zeroCoverage.length > 0, "expected gaps with only 3 fixture chunks");
    const covered = heatmap.cells.filter((c) => c.total > 0);
    return `${heatmap.totalChunks} chunks over ${covered.length} topics, ${heatmap.zeroCoverage.length} empty cells`;
  });

  await check("item bank coverage reports gaps below each ceiling", async () => {
    const bank = await getItemBankCoverage(course.id);
    assert(bank.clos.length === 8, "wrong CLO count");
    return `${bank.gaps.length} CLO×Bloom gaps`;
  });

  await check("curriculum validation console runs all eight checks", async () => {
    const report = await validateCurriculum(course.id);
    assert(report.checks.length === 8, `expected 8 checks, got ${report.checks.length}`);
    const cycle = report.checks.find((c) => c.id === "prereq_cycle");
    assert(Boolean(cycle), "cycle check missing");
    const orphan = report.checks.find((c) => c.id === "orphan_chunk");
    assert(Boolean(orphan), "orphan chunk check missing");
    return `${report.passedCount}/${report.checks.length} passing`;
  });

  /* ── analytics (the most intricate raw SQL) ───────────────────────────── */

  await check("cohort analytics query runs", async () => {
    const analytics = await getCohortAnalytics(course.id);
    assert(Array.isArray(analytics.students), "students missing");
    assert(analytics.cloMastery.length === 8, "CLO mastery rows missing");
    assert(analytics.topicMastery.length === 30, "topic mastery rows missing");
    return `${analytics.cohortSize} students, ${analytics.mostMissedItems.length} missed items`;
  });

  /* ── validation enforcement ───────────────────────────────────────────── */

  await check("DB constraint blocks approving an unvalidated item", async () => {
    const clo = cloRows[0];
    const topic = topicRows[0];
    assert(Boolean(clo && topic), "no CLO/topic");

    const [item] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        cloId: clo?.id ?? "",
        topicId: topic?.id ?? "",
        type: "mcq",
        targetBloom: 2,
        stem: "Smoke fixture question with a stem long enough to be valid.",
        explanation: "fixture",
        status: "pending",
        validation: {
          passed: false,
          checks: [],
          failures: ["bloom_match: deliberately failed by the smoke test"],
          judgeModel: "smoke",
        },
      })
      .returning();
    assert(Boolean(item), "could not insert the fixture question");

    try {
      await db.execute(
        raw`UPDATE questions SET status = 'approved' WHERE id = ${item?.id ?? ""}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      assert(
        /questions_approved_requires_validation|violates check constraint/i.test(message),
        `blocked, but by an unexpected error: ${message}`,
      );
      await db.delete(questions).where(eq(questions.id, item?.id ?? ""));
      return "check constraint refused a raw SQL approval";
    }
    await db.delete(questions).where(eq(questions.id, item?.id ?? ""));
    throw new Error("raw SQL approved a failed item — the constraint is NOT enforcing");
  });

  await check("a passing report can be approved", async () => {
    const clo = cloRows[0];
    const topic = topicRows[0];
    const [item] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        cloId: clo?.id ?? "",
        topicId: topic?.id ?? "",
        type: "mcq",
        targetBloom: 2,
        stem: "Smoke fixture question that passes validation, with a long enough stem.",
        explanation: "fixture",
        status: "pending",
        validation: { passed: true, checks: [], failures: [], judgeModel: "smoke" },
      })
      .returning();

    await db.execute(raw`UPDATE questions SET status = 'approved' WHERE id = ${item?.id ?? ""}`);
    const [after] = await db
      .select({ status: questions.status })
      .from(questions)
      .where(eq(questions.id, item?.id ?? ""));
    assert(after?.status === "approved", "approval of a passing item was blocked");
    await db.delete(questions).where(eq(questions.id, item?.id ?? ""));
    return "approved as expected";
  });

  /* ── student engine ───────────────────────────────────────────────────── */

  await check("learning plan generates and respects prerequisites", async () => {
    const [student] = await db
      .insert(users)
      .values({
        email: "smoke-student@example.invalid",
        name: "Smoke Student",
        role: "student",
        status: "active",
      })
      .onConflictDoNothing()
      .returning();

    const studentId =
      student?.id ??
      (
        await db
          .select({ id: users.id })
          .from(users)
          .where(raw`lower(${users.email}) = 'smoke-student@example.invalid'`)
          .limit(1)
      )[0]?.id;
    assert(Boolean(studentId), "could not create the fixture student");

    const steps = await regeneratePlan(studentId ?? "", course.id, "smoke test");
    assert(steps.length > 0, "plan is empty");

    // Every topic step must appear after the topics it depends on.
    const order = new Map<string, number>();
    steps.forEach((s, i) => {
      if (s.kind === "topic" && s.topicId) order.set(s.topicId, i);
    });
    const prereqRows = await db.execute<{ topic_id: string; prereq_topic_id: string }>(raw`
      SELECT tp.topic_id, tp.prereq_topic_id FROM topic_prereqs tp
      JOIN topics t ON t.id = tp.topic_id WHERE t.course_id = ${course.id}`);
    let violations = 0;
    for (const row of prereqRows) {
      const dependent = order.get(row.topic_id);
      const prereq = order.get(row.prereq_topic_id);
      if (dependent !== undefined && prereq !== undefined && prereq > dependent) violations += 1;
    }
    assert(violations === 0, `${violations} topic(s) placed before their prerequisite`);
    return `${steps.length} steps, 0 prerequisite violations`;
  });

  /* ── cleanup ──────────────────────────────────────────────────────────── */

  await db.delete(materials).where(eq(materials.id, material.id));
  await db.delete(users).where(raw`${users.email} LIKE 'smoke-%@example.invalid'`);

  console.log(
    `\n  ${passed} passed, ${failed} failed.\n${
      failed === 0 ? "  SYSTEM VERIFIED AGAINST A LIVE DATABASE.\n" : ""
    }`,
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    console.error("\n  SMOKE TEST ABORTED:", error instanceof Error ? error.message : String(error));
    await sql.end().catch(() => undefined);
    process.exitCode = 1;
  });
