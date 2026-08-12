/**
 * Reciprocal Rank Fusion (design.md §6.4 step 5).
 *
 * RRF combines ranked lists without needing their scores to be comparable —
 * a cosine distance and a trigram similarity are on entirely different scales,
 * so score-level fusion would silently let one channel dominate. RRF uses only
 * positions, which is exactly what makes it robust here.
 *
 *     score(d) = Σ over lists i of  1 / (k + rank_i(d))
 */

export type RetrievalChannel = "dense" | "lexical" | "graph";

export interface RankedList {
  channel: RetrievalChannel;
  /** Chunk ids, best first. */
  ids: string[];
  /**
   * Added to every rank in this list before fusion. Graph-only hits arrive
   * without a relevance score of their own, so they enter behind the ranked
   * channels rather than competing head-on with them.
   */
  rankPenalty?: number;
}

export interface FusedHit {
  id: string;
  score: number;
  /** Which channels surfaced this chunk, and at what rank — shown in diagnostics. */
  channels: Array<{ channel: RetrievalChannel; rank: number }>;
}

export function reciprocalRankFusion(
  lists: readonly RankedList[],
  k = 60,
): FusedHit[] {
  const accumulated = new Map<string, FusedHit>();

  for (const list of lists) {
    const penalty = list.rankPenalty ?? 0;

    list.ids.forEach((id, index) => {
      // Ranks are 1-based: a 0-based rank would make the top hit's contribution
      // 1/k, identical to no rank at all in the k-dominated tail.
      const rank = index + 1;
      const contribution = 1 / (k + rank + penalty);

      const existing = accumulated.get(id);
      if (existing) {
        existing.score += contribution;
        existing.channels.push({ channel: list.channel, rank });
      } else {
        accumulated.set(id, {
          id,
          score: contribution,
          channels: [{ channel: list.channel, rank }],
        });
      }
    });
  }

  return [...accumulated.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break: more channels agreeing wins, then id order, so
    // the same corpus and query always produce the same ordering.
    if (b.channels.length !== a.channels.length) return b.channels.length - a.channels.length;
    return a.id.localeCompare(b.id);
  });
}
