import type { QuestionOption, ValidationCheck, ValidationReport } from "@/db/schema/assessment";
import type { RetrievalResult } from "@/intelligence/retrieval/types";

export type { ValidationCheck, ValidationReport };

/** The item under validation, before it has an id. */
export interface CandidateItem {
  type: "mcq" | "saq";
  stem: string;
  options?: QuestionOption[];
  referenceAnswer?: string | null;
  rubric?: Array<{ criterion: string; points: number }> | null;
  explanation: string;
  difficultyPrior: number;
  citedChunkIds: string[];
}

/** Everything the checks need about the curriculum position of the item. */
export interface ValidationContext {
  courseId: string;
  cloId: string;
  cloCode: string;
  cloStatement: string;
  cloBloomLevel: number;
  topicId: string;
  topicCode: string;
  topicTitle: string;
  /** The Bloom level the blueprint asked for. */
  targetBloom: number;
  /** The chunks the generator was given — groundedness sees only these. */
  sourceChunks: RetrievalResult[];
  misconceptions: Array<{ code: string; description: string }>;
  /** Valid codes for the drift check. */
  validTopicCodes: Set<string>;
  validCloCodes: Set<string>;
  correlationId?: string;
  actorId?: string | null;
}

export interface CheckResult extends ValidationCheck {
  /** Short-circuits the remaining checks — only `drift` sets this. */
  fatal?: boolean;
}

export type CheckName = ValidationCheck["name"];
