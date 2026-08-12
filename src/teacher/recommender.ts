import { z } from "zod";
import { retrieve } from "@/intelligence/retrieval";
import type { RetrievalResult } from "@/intelligence/retrieval/types";

/**
 * Metadata-filtered resource recommendation (FR-TCH-040, FR-TCH-041).
 *
 * Deliberately not an LLM call: the LOM metadata already encodes topic, Bloom
 * level, difficulty and format, so filtered retrieval answers the question
 * directly. Asking a model to pick from the same filtered set would add cost
 * and latency, and would make the ranking unexplainable.
 */

export const recommendRequestSchema = z.object({
  courseId: z.string().uuid(),
  topicIds: z.array(z.string().uuid()).optional(),
  cloIds: z.array(z.string().uuid()).optional(),
  bloomLevel: z.number().int().min(1).max(6).optional(),
  difficultyBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  lomFormats: z
    .array(
      z.enum([
        "definition",
        "worked_example",
        "proof",
        "exercise",
        "figure",
        "code",
        "narrative",
      ]),
    )
    .optional(),
  /** Free-text steer; falls back to the topic titles when absent. */
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(30).default(10),
});

export type RecommendRequest = z.infer<typeof recommendRequestSchema>;

export interface Recommendation {
  chunkId: string;
  text: string;
  /** Everything needed to render the LOM tags and the locator (FR-TCH-041). */
  materialTitle: string;
  sectionPath: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  topicCode: string | null;
  topicTitle: string | null;
  bloomLevel: number | null;
  difficulty: number | null;
  lomFormat: string | null;
  resourceType: string | null;
  tagConfidence: number | null;
  verified: boolean;
  score: number;
  /** Why this was surfaced — the filters it satisfied. */
  matchedOn: string[];
}

export async function recommend(input: RecommendRequest): Promise<Recommendation[]> {
  const parsed = recommendRequestSchema.parse(input);

  const results = await retrieve(
    parsed.query ?? "core explanation and worked examples",
    {
      courseId: parsed.courseId,
      ...(parsed.topicIds ? { topicIds: parsed.topicIds } : {}),
      ...(parsed.cloIds ? { cloIds: parsed.cloIds } : {}),
      // A single requested level is widened by one below: material that
      // supports reaching a level is legitimately recommended for it.
      ...(parsed.bloomLevel
        ? { bloomBand: [Math.max(1, parsed.bloomLevel - 1), parsed.bloomLevel] as [number, number] }
        : {}),
      ...(parsed.difficultyBand ? { difficultyBand: parsed.difficultyBand } : {}),
      ...(parsed.lomFormats ? { lomFormats: parsed.lomFormats } : {}),
    },
    { finalK: parsed.limit },
  );

  return results.results.map((r) => ({
    chunkId: r.id,
    text: r.text,
    materialTitle: r.materialTitle,
    sectionPath: r.sectionPath,
    pageFrom: r.pageFrom,
    pageTo: r.pageTo,
    topicCode: r.topicCode,
    topicTitle: r.topicTitle,
    bloomLevel: r.bloomLevel,
    difficulty: r.difficulty,
    lomFormat: r.lomFormat,
    resourceType: r.resourceType,
    tagConfidence: r.tagConfidence,
    verified: r.verified,
    score: r.score,
    matchedOn: describeMatch(r, parsed),
  }));
}

/** Makes the ranking legible rather than a bare score. */
function describeMatch(result: RetrievalResult, request: RecommendRequest): string[] {
  const reasons: string[] = [];
  if (request.bloomLevel && result.bloomLevel === request.bloomLevel) {
    reasons.push(`Bloom ${result.bloomLevel} exactly`);
  } else if (result.bloomLevel) {
    reasons.push(`Bloom ${result.bloomLevel}`);
  }
  if (result.lomFormat) reasons.push(result.lomFormat.replace(/_/g, " "));
  if (result.verified) reasons.push("human-verified tag");
  reasons.push(...result.channels.map((c) => `${c.channel} rank ${c.rank}`));
  return reasons;
}
