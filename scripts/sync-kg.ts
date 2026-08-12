import "dotenv/config";
import { sql } from "@/db/client";
import { closeDriver } from "@/intelligence/kg/driver";
import { syncKnowledgeGraph } from "@/intelligence/kg/sync";
import { detectPrereqCycles } from "@/intelligence/kg/queries";
import { logger } from "@/lib/logger";

/**
 * Rebuilds Neo4j from Postgres. Safe to run repeatedly and after every
 * ingestion batch (FR-INT-032).
 */
async function main(): Promise<void> {
  const courseCode = process.argv[2];
  await syncKnowledgeGraph(courseCode);

  // The seeder already rejects cycles, but the graph is where the check is
  // cheap and authoritative — re-run it against what was actually written.
  const cycles = await detectPrereqCycles();
  if (cycles.length > 0) {
    throw new Error(`prerequisite cycle detected in graph, topics: ${cycles.join(", ")}`);
  }
  logger.info("prerequisite graph verified acyclic");
}

/**
 * Neo4j is an optional dependency: retrieval degrades to dense + lexical when
 * the graph is unreachable, and says so. Treating "no Neo4j" as a fatal error
 * here would make `npm run bootstrap` fail on a machine that can still run the
 * whole system — so an unreachable server is reported and skipped, while a
 * server that *is* reachable and then fails still fails the command.
 */
function isUnreachable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /ServiceUnavailable|Failed to connect|ECONNREFUSED|ENOTFOUND|Could not perform discovery/i.test(
      message,
    ) || (error as { code?: string })?.code === "ServiceUnavailable"
  );
}

main()
  .then(async () => {
    await closeDriver();
    await sql.end();
  })
  .catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);

    if (isUnreachable(error)) {
      logger.warn("neo4j unreachable — knowledge graph not synced", { error: message });
      console.log(
        [
          "",
          "  Neo4j is not reachable, so the knowledge graph was not synced.",
          "",
          "  This is not fatal. The curriculum graph is stored in Postgres and is the",
          "  source of truth; Neo4j is a projection used for multi-hop expansion during",
          "  retrieval. Without it, retrieval runs dense + lexical only and reports",
          "  `graph: unavailable` in its diagnostics rather than pretending otherwise.",
          "",
          "  To enable graph expansion, start Neo4j and re-run: npm run sync:kg",
          "",
        ].join("\n"),
      );
      await closeDriver().catch(() => undefined);
      await sql.end();
      return;
    }

    logger.error("kg sync failed", { error: message });
    await closeDriver().catch(() => undefined);
    await sql.end();
    process.exitCode = 1;
  });
