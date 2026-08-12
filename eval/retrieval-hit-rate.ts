import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { getEmbeddingProvider } from "@/intelligence/embeddings";
import { retrieve } from "@/intelligence/retrieval";
import { goldPath, notAvailable, ratio, readJsonl, type EvalSection, type Metric } from "./shared";

/**
 * Retrieval hit-rate@k and MRR against a labelled query set (FR-INT-046).
 *
 * Drives the same `retrieve()` the teacher engine uses, so what is measured is
 * what actually runs — not a parallel implementation that could drift.
 */

interface RetrievalGoldRow {
  query: string;
  /** Chunk ids that count as relevant. */
  relevantChunkIds: string[];
  topicCode?: string;
  bloomBand?: [number, number];
}

export async function runRetrievalHitRate(courseCode = "CS-201"): Promise<EvalSection> {
  const notes: string[] = [];
  const gold = await readJsonl<RetrievalGoldRow>(goldPath("retrieval-queries.jsonl"));

  if (gold.length === 0) {
    return {
      script: "retrieval-hit-rate",
      metrics: [
        notAvailable(
          "Retrieval hit-rate@8",
          `${goldPath("retrieval-queries.jsonl")} is absent or empty; requirements.md §4.3 asks for ≥40 labelled queries`,
          "≥ 85 %",
        ),
      ],
      notes: ["Author the labelled query set to make this metric reportable."],
    };
  }

  if (gold.length < 40) {
    notes.push(
      `Query set has ${gold.length} queries; requirements.md §4.3 specifies at least 40.`,
    );
  }

  const provider = await getEmbeddingProvider();
  if (provider.id === "local") {
    /*
     * design.md §16.3: the local provider is a hashed n-gram approximation with
     * no semantic capability. Reporting a hit-rate measured on it as though it
     * represented the system's retrieval quality would be misleading, so the
     * caveat travels with the number rather than living only in the README.
     */
    notes.push(
      "EMBEDDING_PROVIDER=local — this figure is a FLOOR, not a representative result. " +
        "The local provider is a deterministic hashed n-gram approximation with no semantic " +
        "capability. Re-run with a real embedding provider before reporting retrieval quality.",
    );
  }

  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.code, courseCode))
    .limit(1);
  if (!course) {
    return {
      script: "retrieval-hit-rate",
      metrics: [notAvailable("Retrieval hit-rate@8", `course ${courseCode} not seeded`)],
      notes,
    };
  }

  let hitsAt1 = 0;
  let hitsAt3 = 0;
  let hitsAt8 = 0;
  let reciprocalRankSum = 0;
  let evaluated = 0;

  for (const row of gold) {
    const response = await retrieve(
      row.query,
      {
        courseId: course.id,
        ...(row.bloomBand ? { bloomBand: row.bloomBand } : {}),
      },
      { finalK: 8 },
    );

    const relevant = new Set(row.relevantChunkIds);
    const ranked = response.results.map((r) => r.id);
    const firstHitIndex = ranked.findIndex((id) => relevant.has(id));

    evaluated += 1;
    if (firstHitIndex === 0) hitsAt1 += 1;
    if (firstHitIndex >= 0 && firstHitIndex < 3) hitsAt3 += 1;
    if (firstHitIndex >= 0 && firstHitIndex < 8) hitsAt8 += 1;
    if (firstHitIndex >= 0) reciprocalRankSum += 1 / (firstHitIndex + 1);
  }

  const mrr: Metric = {
    name: "Retrieval MRR",
    value: evaluated === 0 ? null : reciprocalRankSum / evaluated,
    unit: "ratio",
    n: evaluated,
    ...(evaluated === 0 ? { unavailableReason: "no queries evaluated" } : {}),
  };

  return {
    script: "retrieval-hit-rate",
    metrics: [
      ratio("Retrieval hit-rate@1", hitsAt1, evaluated),
      ratio("Retrieval hit-rate@3", hitsAt3, evaluated),
      ratio("Retrieval hit-rate@8", hitsAt8, evaluated, "≥ 85 %"),
      mrr,
    ],
    notes: [...notes, `Embedding provider: ${provider.id} (${provider.model})`],
  };
}
