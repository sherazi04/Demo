import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { loadCourseContext } from "@/curriculum/context";
import { tagBatch, TAG_BATCH_SIZE } from "@/intelligence/ingest/tag";
import { hasAnthropicKey } from "@/intelligence/llm/client";
import { goldPath, notAvailable, ratio, readJsonl, type EvalSection } from "./shared";

/**
 * Bloom classification accuracy against human labels (design.md §13).
 *
 * Runs the real tagger over the gold chunks and compares to the human label.
 * Reports accuracy, a per-level confusion matrix, and n.
 */

interface BloomGoldRow {
  chunkId?: string;
  text: string;
  /** The human label, 1–6. */
  bloomLevel: number;
  topicCode?: string;
}

export async function runBloomAccuracy(courseCode = "CS-201"): Promise<EvalSection> {
  const notes: string[] = [];
  const gold = await readJsonl<BloomGoldRow>(goldPath("bloom-gold.jsonl"));

  if (gold.length === 0) {
    return {
      script: "bloom-accuracy",
      metrics: [
        notAvailable(
          "Bloom classification accuracy",
          `${goldPath("bloom-gold.jsonl")} is absent or empty; requirements.md §4.3 asks for ≥150 human-labelled chunks`,
          "≥ 80 %",
        ),
      ],
      notes: ["Author the gold set to make this metric reportable."],
    };
  }

  if (gold.length < 150) {
    // Reported, not silently accepted: a small n is a caveat the reader needs,
    // and hiding it would make the figure look sturdier than it is.
    notes.push(
      `Gold set has ${gold.length} chunks; requirements.md §4.3 specifies at least 150. Treat this figure as indicative only.`,
    );
  }

  if (!hasAnthropicKey()) {
    return {
      script: "bloom-accuracy",
      metrics: [
        notAvailable(
          "Bloom classification accuracy",
          "ANTHROPIC_API_KEY is not set, so the tagger cannot be run",
          "≥ 80 %",
        ),
      ],
      notes,
    };
  }

  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.code, courseCode))
    .limit(1);
  if (!course) {
    return {
      script: "bloom-accuracy",
      metrics: [notAvailable("Bloom classification accuracy", `course ${courseCode} not seeded`)],
      notes,
    };
  }

  const context = await loadCourseContext(course.id);

  // 6×6 confusion matrix, indexed [human][machine].
  const confusion: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  let correct = 0;
  let scored = 0;

  for (let i = 0; i < gold.length; i += TAG_BATCH_SIZE) {
    const batch = gold.slice(i, i + TAG_BATCH_SIZE);
    const outcomes = await tagBatch(
      batch.map((row, index) => ({ chunkId: `gold-${i + index}`, text: row.text })),
      context,
    );

    for (const [index, outcome] of outcomes.entries()) {
      const expected = batch[index]?.bloomLevel;
      const actual = outcome.bloomLevel;
      if (!expected || !actual) continue;

      scored += 1;
      if (expected === actual) correct += 1;

      const row = confusion[expected - 1];
      if (row) row[actual - 1] = (row[actual - 1] ?? 0) + 1;
    }
  }

  return {
    script: "bloom-accuracy",
    metrics: [
      ratio("Bloom classification accuracy", correct, scored, "≥ 80 %", {
        confusionMatrix: confusion,
        legend: "rows = human label 1–6, columns = tagger output 1–6",
      }),
    ],
    notes,
  };
}
