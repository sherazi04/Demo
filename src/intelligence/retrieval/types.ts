import { z } from "zod";
import type { RetrievalChannel } from "./fuse";

/**
 * Metadata pre-filter (FR-INT-040). Every field here is applied inside the same
 * SQL statement as the vector search — never as a post-filter on ANN results.
 */
export const retrievalFilterSchema = z.object({
  courseId: z.string().uuid(),
  topicIds: z.array(z.string().uuid()).optional(),
  cloIds: z.array(z.string().uuid()).optional(),
  /** Inclusive [min, max] Bloom band. */
  bloomBand: z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]).optional(),
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
  materialIds: z.array(z.string().uuid()).optional(),
  /** Excludes specific chunks — used to diversify across a generation run. */
  excludeChunkIds: z.array(z.string().uuid()).optional(),
  /** When true, only human-verified tags are trusted (FR-INT-024). */
  verifiedOnly: z.boolean().optional(),
  minTagConfidence: z.number().min(0).max(1).optional(),
});

export type RetrievalFilter = z.infer<typeof retrievalFilterSchema>;

export const retrievalOptionsSchema = z.object({
  vectorK: z.number().int().positive().max(500).optional(),
  lexicalK: z.number().int().positive().max(500).optional(),
  graphHops: z.number().int().min(0).max(5).optional(),
  graphK: z.number().int().min(0).max(200).optional(),
  finalK: z.number().int().positive().max(100).optional(),
  rrfK: z.number().int().positive().optional(),
  rerank: z.boolean().optional(),
  /** Disables graph expansion — used by the eval harness to isolate channels. */
  disableGraph: z.boolean().optional(),
});

export type RetrievalOptions = z.infer<typeof retrievalOptionsSchema>;

/**
 * One assembled result. Every consumer receives the chunk id and a source
 * locator, which is what makes citation and groundedness checking possible at
 * all (FR-INT-044).
 */
export interface RetrievalResult {
  id: string;
  text: string;
  score: number;
  channels: Array<{ channel: RetrievalChannel; rank: number }>;

  materialId: string;
  materialTitle: string;
  topicId: string | null;
  topicCode: string | null;
  topicTitle: string | null;
  cloIds: string[];
  bloomLevel: number | null;
  difficulty: number | null;
  lomFormat: string | null;
  resourceType: string | null;
  tagConfidence: number | null;
  verified: boolean;

  pageFrom: number | null;
  pageTo: number | null;
  sectionPath: string | null;
}

export interface RetrievalDiagnostics {
  query: string;
  filter: RetrievalFilter;
  embeddingProvider: string;
  embeddingModel: string;
  denseCount: number;
  lexicalCount: number;
  graphCount: number;
  graphExpandedTopicIds: string[];
  fusedCount: number;
  returnedCount: number;
  reranked: boolean;
  timings: {
    embedMs: number;
    denseMs: number;
    lexicalMs: number;
    graphMs: number;
    assembleMs: number;
    totalMs: number;
  };
}

export interface RetrievalResponse {
  results: RetrievalResult[];
  diagnostics: RetrievalDiagnostics;
}
