import { getConfig } from "@/lib/config";
import type { Effort } from "@/lib/env";

/**
 * Three independently configurable tiers (FR-INT-050, FR-INT-051).
 *
 * They are separate so an operator can move `bulk` to a cheaper model without
 * touching generation quality, and so `judge` can be pinned independently of
 * `generation` — a judge that moves whenever the generator moves is not an
 * independent check.
 */
export type Tier = "generation" | "judge" | "bulk";

export interface TierSettings {
  tier: Tier;
  model: string;
  effort: Effort;
}

export async function resolveTier(tier: Tier): Promise<TierSettings> {
  const config = await getConfig();
  switch (tier) {
    case "generation":
      return {
        tier,
        model: config["llm.generation.model"],
        effort: config["llm.generation.effort"],
      };
    case "judge":
      return { tier, model: config["llm.judge.model"], effort: config["llm.judge.effort"] };
    case "bulk":
      return { tier, model: config["llm.bulk.model"], effort: config["llm.bulk.effort"] };
  }
}
