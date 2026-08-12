import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Shared helpers for the evaluation harness (design.md §13).
 *
 * Two rules are enforced here rather than left to each script:
 *
 *   1. Every figure is reported with its sample size. `Metric` has no shape
 *      that permits omitting `n`.
 *   2. A missing gold set reports "no gold data", never a number. Fabricating
 *      a metric from an empty set is the single worst thing this harness could
 *      do, so `notAvailable()` is the only way to produce a result without one.
 */

export interface Metric {
  name: string;
  /** Null when there is no gold data — never zero as a stand-in. */
  value: number | null;
  unit: "ratio" | "percent" | "count";
  /** Sample size. Always printed next to the value. */
  n: number;
  target?: string;
  /** Present when `value` is null: why the metric could not be computed. */
  unavailableReason?: string;
  detail?: Record<string, unknown>;
}

export function notAvailable(name: string, reason: string, target?: string): Metric {
  return { name, value: null, unit: "ratio", n: 0, target, unavailableReason: reason };
}

export function ratio(
  name: string,
  numerator: number,
  denominator: number,
  target?: string,
  detail?: Record<string, unknown>,
): Metric {
  if (denominator === 0) {
    return notAvailable(name, "no samples available", target);
  }
  return {
    name,
    value: numerator / denominator,
    unit: "ratio",
    n: denominator,
    target,
    detail,
  };
}

export function formatMetric(metric: Metric): string {
  if (metric.value === null) {
    return `${metric.name}: no gold data — ${metric.unavailableReason ?? "unavailable"} (n = 0)`;
  }
  const value =
    metric.unit === "percent" || metric.unit === "ratio"
      ? `${(metric.value * 100).toFixed(1)}%`
      : String(metric.value);
  return `${metric.name}: ${value} (n = ${metric.n})${metric.target ? ` · target ${metric.target}` : ""}`;
}

/** Reads a JSONL gold file, returning [] when it does not exist. */
export async function readJsonl<T>(relativePath: string): Promise<T[]> {
  const path = resolve(process.cwd(), relativePath);
  if (!existsSync(path)) return [];

  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        throw new Error(`${relativePath}: line ${index + 1} is not valid JSON`);
      }
    });
}

export function goldPath(name: string): string {
  return `data/gold/${name}`;
}

/**
 * The out-of-reach list from requirements.md §6.2, reproduced verbatim.
 *
 * The report prints this every run. It is not a disclaimer to be trimmed when
 * the output gets long: the risk it addresses (R7) is a reader taking a demo
 * metric for an efficacy result, and that risk is highest precisely when the
 * measured numbers look good.
 */
export const OUT_OF_REACH: readonly string[] = [
  "Learning gain (e.g. \"18 % improvement\")",
  "Quiz-quality uplift versus a human baseline (e.g. \"+25 %\")",
  "Recommendation relevance as a user-rated score at scale",
  "Lecture-planning time reduction as a statistically supported figure (a small n≈5 usability study may be reported, clearly labelled as underpowered)",
];

export interface EvalSection {
  script: string;
  metrics: Metric[];
  notes: string[];
}
