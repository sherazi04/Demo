import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { sql } from "@/db/client";
import { closeDriver } from "@/intelligence/kg/driver";
import { logger } from "@/lib/logger";
import { runBloomAccuracy } from "./bloom-accuracy";
import { runCloPrecision } from "./clo-precision";
import { runGroundedness } from "./groundedness";
import { runRetrievalHitRate } from "./retrieval-hit-rate";
import { formatMetric, OUT_OF_REACH, type EvalSection, type Metric } from "./shared";

/**
 * `npm run eval` — one command, machine-readable output (NFR-OBS-004).
 *
 * Writes eval/report.json and eval/report.md. Every figure carries its sample
 * size, a metric with no gold data reports "no gold data" rather than a number,
 * and the out-of-reach list from requirements.md §6.2 is reproduced verbatim in
 * both outputs.
 */

interface Report {
  generatedAt: string;
  sections: EvalSection[];
  measured: Metric[];
  unavailable: Metric[];
  outOfReach: readonly string[];
  banner: string;
}

const BANNER =
  "MEASURED RESULTS vs HYPOTHESES — the figures below are demonstration metrics " +
  "computed on this system's own gold sets. They say nothing about learning " +
  "outcomes. The items under 'Not measurable from this demonstration' require a " +
  "controlled study with a baseline, a sample-size calculation and ethics approval.";

async function main(): Promise<void> {
  const sections: EvalSection[] = [];

  // Each section is isolated: one failing metric must not abort the run, or a
  // missing gold set would take the whole report with it.
  for (const [name, run] of [
    ["bloom-accuracy", runBloomAccuracy],
    ["retrieval-hit-rate", runRetrievalHitRate],
    ["clo-precision", runCloPrecision],
    ["groundedness", runGroundedness],
  ] as const) {
    try {
      sections.push(await run());
    } catch (error: unknown) {
      sections.push({ script: name, metrics: [], notes: [describeFailure(error)] });
    }
  }

  const allMetrics = sections.flatMap((s) => s.metrics);
  const report: Report = {
    generatedAt: new Date().toISOString(),
    sections,
    measured: allMetrics.filter((m) => m.value !== null),
    unavailable: allMetrics.filter((m) => m.value === null),
    outOfReach: OUT_OF_REACH,
    banner: BANNER,
  };

  await writeFile("eval/report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile("eval/report.md", renderMarkdown(report), "utf8");

  console.log(renderConsole(report));
}

/**
 * Postgres driver errors often carry an empty `message` and put the useful
 * information in `code` — "Failed to run: " with nothing after it tells the
 * reader nothing, and the most common cause by far is simply that the database
 * is not running.
 */
function describeFailure(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null;

  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return `Could not reach the database (${code}). Start the stack with \`docker compose up -d\` and run \`npm run db:migrate\`.`;
  }

  const message = error instanceof Error && error.message ? error.message : null;
  if (message) return `Failed to run: ${message}`;
  return `Failed to run: ${code ? `${code} — ` : ""}the database is likely unreachable. Start it with \`docker compose up -d\`.`;
}

function renderConsole(report: Report): string {
  const lines: string[] = ["", "═".repeat(78), " EVALUATION REPORT", "═".repeat(78), ""];

  for (const section of report.sections) {
    lines.push(`── ${section.script} ${"─".repeat(Math.max(0, 60 - section.script.length))}`);
    if (section.metrics.length === 0) lines.push("  (no metrics produced)");
    for (const metric of section.metrics) lines.push(`  ${formatMetric(metric)}`);
    for (const note of section.notes) lines.push(`  · ${note}`);
    lines.push("");
  }

  lines.push("Not measurable from this demonstration (requirements.md §6.2):");
  for (const item of OUT_OF_REACH) lines.push(`  · ${item}`);
  lines.push("", BANNER, "");
  return lines.join("\n");
}

function renderMarkdown(report: Report): string {
  const lines: string[] = [
    "# Evaluation report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `> ${BANNER}`,
    "",
    "## Measured",
    "",
    "| Metric | Value | Sample size | Target |",
    "|---|---|---|---|",
  ];

  for (const metric of report.measured) {
    const value =
      metric.unit === "count"
        ? String(metric.value)
        : `${((metric.value ?? 0) * 100).toFixed(1)}%`;
    lines.push(`| ${metric.name} | ${value} | n = ${metric.n} | ${metric.target ?? "—"} |`);
  }
  if (report.measured.length === 0) {
    lines.push("| _none_ | — | n = 0 | — |");
  }

  if (report.unavailable.length > 0) {
    lines.push("", "## Not computed", "", "| Metric | Why | Target |", "|---|---|---|");
    for (const metric of report.unavailable) {
      lines.push(
        `| ${metric.name} | ${metric.unavailableReason ?? "unavailable"} | ${metric.target ?? "—"} |`,
      );
    }
  }

  const notes = report.sections.flatMap((s) => s.notes.map((n) => `- **${s.script}**: ${n}`));
  if (notes.length > 0) {
    lines.push("", "## Notes and caveats", "", ...notes);
  }

  lines.push(
    "",
    "## Not measurable from this demonstration",
    "",
    "Reproduced verbatim from `requirements.md` §6.2. These require a controlled study with a baseline, a sample-size calculation, and ethics approval.",
    "",
  );
  for (const item of OUT_OF_REACH) lines.push(`- ${item}`);
  lines.push("");

  return lines.join("\n");
}

main()
  .then(async () => {
    await closeDriver().catch(() => undefined);
    await sql.end().catch(() => undefined);
  })
  .catch(async (error: unknown) => {
    logger.error("eval run failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await closeDriver().catch(() => undefined);
    await sql.end().catch(() => undefined);
    process.exitCode = 1;
  });
