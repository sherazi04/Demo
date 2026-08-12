import type { CandidateItem, CheckResult, ValidationContext } from "./types";

/**
 * `drift` — set membership against the curriculum spine (FR-VAL-007).
 *
 * Free: no LLM call, no embedding, just lookups. Runs first and short-circuits
 * the rest, because an item about a topic that does not exist cannot
 * meaningfully be scored for Bloom level or CLO alignment — spending judge
 * calls on it would be measuring the wrong thing.
 */
export function driftCheck(item: CandidateItem, context: ValidationContext): CheckResult {
  const failures: string[] = [];

  if (!context.validTopicCodes.has(context.topicCode)) {
    failures.push(`topic "${context.topicCode}" is not in the approved curriculum`);
  }
  if (!context.validCloCodes.has(context.cloCode)) {
    failures.push(`CLO "${context.cloCode}" is not in the approved curriculum`);
  }

  // An item may not be requested above its CLO's ceiling: the outcome defines
  // the highest cognitive level it is willing to claim to assess.
  if (context.targetBloom > context.cloBloomLevel) {
    failures.push(
      `requested Bloom ${context.targetBloom} exceeds ${context.cloCode}'s ceiling of ${context.cloBloomLevel}`,
    );
  }

  // Every cited chunk must be one the generator was actually given. A citation
  // to anything else is a fabricated provenance claim, which is worse than no
  // citation at all because it looks verified.
  const provided = new Set(context.sourceChunks.map((c) => c.id));
  const invented = item.citedChunkIds.filter((id) => !provided.has(id));
  if (invented.length > 0) {
    failures.push(
      `cites ${invented.length} chunk id(s) that were not in the provided context: ${invented
        .slice(0, 3)
        .join(", ")}`,
    );
  }

  if (item.citedChunkIds.length === 0) {
    failures.push("cites no source chunks");
  }

  const passed = failures.length === 0;
  return {
    name: "drift",
    passed,
    score: passed ? 1 : 0,
    detail: passed
      ? `topic ${context.topicCode} and ${context.cloCode} are in the curriculum; all ${item.citedChunkIds.length} citation(s) resolve to provided context`
      : failures.join("; "),
    fatal: !passed,
  };
}
