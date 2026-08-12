import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { logger } from "@/lib/logger";

/**
 * Runs every pending migration in drizzle/, including the hand-written
 * audit-immutability trigger. Idempotent — safe to re-run.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to run migrations");

  // `max: 1` because migrations must run serially on one connection.
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    logger.info("migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  logger.error("migration failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
