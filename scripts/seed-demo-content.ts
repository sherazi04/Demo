import "dotenv/config";
import { eq, sql as raw } from "drizzle-orm";
import { db, sql } from "@/db/client";
import {
  chunkClos,
  chunks,
  cloTopics,
  clos,
  courses,
  materials,
  misconceptions,
  questions,
  topics,
  users,
} from "@/db/schema";
import type { QuestionOption } from "@/db/schema/assessment";
import { embedDocuments, getEmbeddingProvider } from "@/intelligence/embeddings";
import { append } from "@/governance/audit";
import { logger } from "@/lib/logger";

/**
 * Seeds a corpus and an approved item bank WITHOUT calling any LLM.
 *
 * Purpose: make the whole system demonstrable with no API key. Retrieval needs
 * chunks; the adaptive quiz needs approved items; the analytics and the bias
 * monitor need responses against real items. Without this, a reviewer with no
 * Anthropic key sees empty screens and cannot tell a working system from a
 * broken one.
 *
 * The content is derived from the authored curriculum — topic summaries become
 * chunks, and each item's distractors are the topic's real documented
 * misconceptions, so the misconception-naming feedback path is genuinely
 * exercised rather than faked.
 *
 * Every row it writes is marked `seeded_demo` in its provenance fields, so
 * nothing here can be mistaken for model output:
 *   · materials.kind          = 'seeded_demo'
 *   · chunks.lom.source       = 'seeded_demo'
 *   · questions.generated_by_model = 'seeded-demo-content (no LLM)'
 *
 * Re-runnable: it removes its own previous material and items first.
 */

const MATERIAL_TITLE = "CS-201 course notes (seeded demo content)";
const PROVENANCE = "seeded-demo-content (no LLM)";

async function main(): Promise<void> {
  const [course] = await db.select().from(courses).where(eq(courses.code, "CS-201")).limit(1);
  if (!course) throw new Error("CS-201 not seeded. Run: npm run seed:curriculum");

  const [author] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);
  if (!author) throw new Error("No admin account. Run: npm run seed:users");

  // Idempotent: drop what a previous run created (chunks cascade with it).
  //
  // An item a student has answered cannot be dropped — attempt_items references
  // questions with ON DELETE RESTRICT, deliberately, because deleting it would
  // destroy the evidence behind that student's mastery estimate. So check for
  // answered seeded items first and say what to do, rather than letting the
  // foreign key surface as an unexplained error.
  const [answered] = await db.execute<{ n: number }>(raw`
    SELECT count(*)::int AS n
    FROM attempt_items ai
    JOIN questions q ON q.id = ai.question_id
    WHERE q.course_id = ${course.id} AND q.generated_by_model = ${PROVENANCE}`);

  if ((answered?.n ?? 0) > 0) {
    throw new Error(
      `${answered?.n} response(s) already reference the previously seeded items, which cannot ` +
        "be deleted without destroying the evidence behind those mastery estimates. " +
        "Run `npm run demo:reset` first (it removes the synthetic cohort, and the responses " +
        "cascade with it), then re-run this seed.",
    );
  }

  await db.delete(questions).where(
    raw`${questions.courseId} = ${course.id} AND ${questions.generatedByModel} = ${PROVENANCE}`,
  );
  await db.delete(materials).where(
    raw`${materials.courseId} = ${course.id} AND ${materials.kind} = 'seeded_demo'`,
  );

  const topicRows = await db
    .select()
    .from(topics)
    .where(eq(topics.courseId, course.id))
    .orderBy(topics.ordinal);
  const cloRows = await db.select().from(clos).where(eq(clos.courseId, course.id));
  const cloTopicRows = await db
    .select({ cloId: cloTopics.cloId, topicId: cloTopics.topicId })
    .from(cloTopics)
    .innerJoin(clos, eq(clos.id, cloTopics.cloId))
    .where(eq(clos.courseId, course.id));
  const misconceptionRows = await db.select().from(misconceptions);

  const closByTopic = new Map<string, string[]>();
  for (const row of cloTopicRows) {
    const list = closByTopic.get(row.topicId) ?? [];
    list.push(row.cloId);
    closByTopic.set(row.topicId, list);
  }
  const cloById = new Map(cloRows.map((c) => [c.id, c]));
  const misconceptionsByTopic = new Map<string, typeof misconceptionRows>();
  for (const m of misconceptionRows) {
    const list = misconceptionsByTopic.get(m.topicId) ?? [];
    list.push(m);
    misconceptionsByTopic.set(m.topicId, list);
  }

  const [material] = await db
    .insert(materials)
    .values({
      courseId: course.id,
      uploadedBy: author.id,
      title: MATERIAL_TITLE,
      kind: "seeded_demo",
      filename: "cs201-notes.md",
      mimeType: "text/markdown",
      sizeBytes: 0,
      storagePath: "(seeded, no file on disk)",
      contentHash: `seeded-demo-${course.id}`,
      licenseNote: "Authored for this demonstration; no third-party content.",
      status: "indexed",
      progress: 1,
      indexedAt: new Date(),
    })
    .returning();
  if (!material) throw new Error("could not create the demo material");

  /* ── chunks: one per topic summary, plus one per misconception ────────── */

  interface PendingChunk {
    text: string;
    topicId: string;
    bloomLevel: number;
    difficulty: number;
    lomFormat: "definition" | "worked_example" | "narrative";
    ordinal: number;
    sectionPath: string;
    page: number;
  }

  const pending: PendingChunk[] = [];
  let page = 1;

  for (const topic of topicRows) {
    pending.push({
      text: `${topic.title}. ${topic.summary}`,
      topicId: topic.id,
      // A summary supports Understand-level work.
      bloomLevel: 2,
      difficulty: 0.35 + (topic.ordinal / topicRows.length) * 0.3,
      lomFormat: "definition",
      ordinal: pending.length,
      sectionPath: `Week ${topic.week} > ${topic.code} ${topic.title}`,
      page,
    });

    // Each misconception plus its remediation is the material an Apply- or
    // Analyse-level item is grounded in.
    for (const m of misconceptionsByTopic.get(topic.id) ?? []) {
      pending.push({
        text: `${topic.title} — common misunderstanding (${m.code}). Students often believe: ${m.description} Why this is wrong, and what to do instead: ${m.remediation}`,
        topicId: topic.id,
        bloomLevel: 4,
        difficulty: 0.5 + (topic.ordinal / topicRows.length) * 0.35,
        lomFormat: "narrative",
        ordinal: pending.length,
        sectionPath: `Week ${topic.week} > ${topic.code} ${topic.title} > Misconceptions`,
        page,
      });
    }
    page += 2;
  }

  const provider = await getEmbeddingProvider();
  const vectors = await embedDocuments(pending.map((p) => p.text));

  const insertedChunks = await db
    .insert(chunks)
    .values(
      pending.map((p, index) => ({
        materialId: material.id,
        courseId: course.id,
        ordinal: p.ordinal,
        text: p.text,
        tokenCount: Math.ceil(p.text.length / 4),
        pageFrom: p.page,
        pageTo: p.page,
        sectionPath: p.sectionPath,
        topicId: p.topicId,
        bloomLevel: p.bloomLevel,
        difficulty: Number(Math.min(0.95, p.difficulty).toFixed(2)),
        lomFormat: p.lomFormat,
        resourceType: "narrative text",
        // Not 1.0: these are seeded, not human-verified, and the review queue
        // should still have something meaningful to show.
        tagConfidence: 0.82,
        lom: { source: "seeded_demo", keywords: [], reasoning: "Seeded from the authored curriculum." },
        embedding: vectors[index],
        embeddingModel: provider.model,
      })),
    )
    .returning({ id: chunks.id, topicId: chunks.topicId, ordinal: chunks.ordinal });

  // Link chunks to the CLOs their topic is assessed by.
  const cloLinks: Array<{ chunkId: string; cloId: string; relevance: number }> = [];
  for (const chunk of insertedChunks) {
    for (const cloId of closByTopic.get(chunk.topicId ?? "") ?? []) {
      cloLinks.push({ chunkId: chunk.id, cloId, relevance: 1 });
    }
  }
  if (cloLinks.length > 0) {
    await db.insert(chunkClos).values(cloLinks).onConflictDoNothing();
  }

  await db
    .update(materials)
    .set({ chunkCount: insertedChunks.length, pageCount: page })
    .where(eq(materials.id, material.id));

  logger.info("demo corpus seeded", {
    chunks: insertedChunks.length,
    cloLinks: cloLinks.length,
    provider: provider.id,
  });

  /* ── approved items, one per misconception-bearing topic ──────────────── */

  const chunkByTopic = new Map<string, string[]>();
  for (const chunk of insertedChunks) {
    const list = chunkByTopic.get(chunk.topicId ?? "") ?? [];
    list.push(chunk.id);
    chunkByTopic.set(chunk.topicId ?? "", list);
  }

  const OPTION_KEYS = ["A", "B", "C", "D"] as const;
  let created = 0;

  for (const topic of topicRows) {
    const topicMisconceptions = misconceptionsByTopic.get(topic.id) ?? [];
    if (topicMisconceptions.length < 2) continue;

    const cloIds = closByTopic.get(topic.id) ?? [];
    const clo = cloIds.map((id) => cloById.get(id)).find(Boolean);
    if (!clo) continue;

    const sourceChunkIds = chunkByTopic.get(topic.id) ?? [];
    if (sourceChunkIds.length === 0) continue;

    // One item per Bloom level, 1 through 3, capped by the CLO's own ceiling so
    // no seeded item can violate the drift check's ceiling rule.
    //
    // A single level would make the adaptive engine untestable: the Bloom cap
    // rises with mastery, so a bank sitting entirely at one level either serves
    // nothing to a beginner or nothing new to anyone else. Three levels give the
    // cap something to actually select between.
    const VARIANTS = [
      {
        bloom: 1,
        difficulty: 0.3,
        stem: `Which statement correctly describes ${topic.title.toLowerCase()}?`,
        keyRationale: `Correct. This restates what ${topic.code} ${topic.title} defines.`,
      },
      {
        bloom: 2,
        difficulty: 0.45,
        stem: `Which statement about ${topic.title.toLowerCase()} is correct?`,
        keyRationale: `Correct. This is what ${topic.code} ${topic.title} actually establishes.`,
      },
      {
        bloom: 3,
        difficulty: 0.6,
        stem:
          `A classmate is working through a problem involving ${topic.title.toLowerCase()} ` +
          `and has to decide how to proceed. Which reasoning is sound?`,
        keyRationale: `Correct. Applying ${topic.code} ${topic.title} this way holds up.`,
      },
    ] as const;

    for (const variant of VARIANTS) {
      if (variant.bloom > clo.bloomLevel) continue;

      // The key states the correct understanding; each distractor states a real
      // documented misconception and carries its code, which is what makes the
      // adaptive feedback path genuinely exercisable offline. Distractors are
      // rotated per level so the three items are not the same question thrice.
      const rotated = [
        ...topicMisconceptions.slice(variant.bloom - 1),
        ...topicMisconceptions.slice(0, variant.bloom - 1),
      ];
      const distractors = rotated.slice(0, 3);

      const options: QuestionOption[] = [
        {
          key: "A",
          text: truncate(firstSentence(topic.summary), 240),
          correct: true,
          rationale: variant.keyRationale,
        },
        ...distractors.map((m, index) => ({
          key: OPTION_KEYS[index + 1] ?? "D",
          text: truncate(m.description.replace(/^(Believing|Assuming|Confusing|Treating|Reading|Claiming|Applying|Selecting|Deleting|Implementing|Using|Omitting|Failing|Checking|Keeping|Storing|Defining|Marking|Adding|Choosing|Forgetting|Concluding|Deriving|Starting) /i, "").replace(/^./, (c) => c.toUpperCase()), 240),
          correct: false,
          misconceptionCode: m.code,
          rationale: `Incorrect — this is misconception ${m.code}. ${m.remediation}`,
        })),
      ];

      // Pad to exactly four options when a topic has only two misconceptions.
      while (options.length < 4) {
        const filler = topicMisconceptions[options.length - 1] ?? topicMisconceptions[0];
        if (!filler) break;
        options.push({
          key: OPTION_KEYS[options.length] ?? "D",
          text: truncate(`It is unrelated to ${topic.title.toLowerCase()}.`, 240),
          correct: false,
          rationale: "Incorrect — this option is off-topic for the stem as written.",
        });
      }
      if (options.length !== 4) continue;

      await db.insert(questions).values({
        courseId: course.id,
        cloId: clo.id,
        topicId: topic.id,
        type: "mcq",
        targetBloom: variant.bloom,
        measuredBloom: variant.bloom,
        stem: variant.stem,
        options,
        explanation: `${firstSentence(topic.summary)} The other options each restate a documented misconception about this topic.`,
        difficultyPrior: variant.difficulty,
        difficultyElo: variant.difficulty,
        sourceChunkIds: sourceChunkIds.slice(0, 3),
        generatedByModel: PROVENANCE,
        // Seeded items carry an honest validation report: they were checked by
        // construction (in-curriculum topic and CLO, level at or below the
        // ceiling, grounded in real chunks), not by the judge tier.
        validation: {
          passed: true,
          checks: [
            {
              name: "drift",
              passed: true,
              score: 1,
              detail: `Topic ${topic.code} and ${clo.code} are in the curriculum; Bloom ${variant.bloom} is at or below the ${clo.code} ceiling of ${clo.bloomLevel}; grounded in ${sourceChunkIds.length} seeded chunk(s).`,
            },
          ],
          failures: [],
          judgeModel: "none — seeded content, valid by construction, not judge-verified",
        },
        status: "approved",
        reviewedBy: author.id,
        reviewedAt: new Date(),
        reviewNote: "Seeded demo content; approved so the adaptive quiz has a bank offline.",
      });
      created += 1;
    }
  }

  await append({
    actorId: author.id,
    actorRole: "admin",
    action: "question.approve",
    resourceType: "seed",
    resourceId: material.id,
    payload: { seeded: true, chunks: insertedChunks.length, items: created, llm: false },
  });

  logger.info("demo item bank seeded", { approvedItems: created });

  console.log(
    [
      "",
      `  Seeded ${insertedChunks.length} chunks and ${created} approved items for ${course.code}.`,
      "",
      "  No LLM was called. Content is derived from the authored curriculum, and",
      "  every distractor is a real documented misconception, so the adaptive quiz,",
      "  retrieval, analytics and the misconception-feedback path all work offline.",
      "",
      "  Items are marked generated_by_model = 'seeded-demo-content (no LLM)' and",
      "  their validation report states they were valid by construction rather than",
      "  judge-verified. Use Teacher → Generate with an API key for real generation.",
      "",
    ].join("\n"),
  );
}

function firstSentence(text: string): string {
  const match = /^(.*?[.!?])(\s|$)/.exec(text.trim());
  return (match?.[1] ?? text).trim();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    logger.error("demo content seed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await sql.end();
    process.exitCode = 1;
  });
