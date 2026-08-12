import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/**
 * Local Postgres for development without Docker.
 *
 * Runs PGlite — a real PostgreSQL 16 compiled to WASM — and serves it over TCP
 * speaking the actual Postgres wire protocol. The app, the worker and
 * drizzle-kit all connect through `DATABASE_URL` exactly as they would to a
 * containerised server: no driver switch, no code path that only exists in
 * development.
 *
 * This is a convenience for machines without Docker, NOT a replacement for it.
 * PGlite is single-connection and single-process, so it serialises concurrent
 * queries — fine for a demo, wrong for anything load-bearing. `docker compose
 * up -d` remains the supported path and is what `.env.example` points at.
 *
 * Extensions match infra/postgres-init.sql: vector and pg_trgm. `pgcrypto` is
 * not loaded and is not needed — `gen_random_uuid()` has been core since
 * PostgreSQL 13.
 */

const DATA_DIR = resolve(process.env["LOCAL_DB_DIR"] ?? "./.localdb");
const PORT = Number(process.env["LOCAL_DB_PORT"] ?? 5433);
const HOST = process.env["LOCAL_DB_HOST"] ?? "127.0.0.1";

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  const db = await PGlite.create({
    dataDir: DATA_DIR,
    extensions: { vector, pg_trgm },
  });

  // Idempotent: matches infra/postgres-init.sql so the schema behaves
  // identically here and against a real server.
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await db.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");

  const server = new PGLiteSocketServer({ db, port: PORT, host: HOST });
  await server.start();

  const url = `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
  console.log(
    [
      "",
      `  Local Postgres ready on ${HOST}:${PORT}`,
      `  Data directory: ${DATA_DIR}`,
      "",
      "  Point DATABASE_URL at:",
      `    ${url}`,
      "",
      "  This is PGlite (PostgreSQL 16 in WASM) with vector and pg_trgm.",
      "  It is single-connection — use Docker for anything beyond the demo.",
      "",
      "  Leave this running; press Ctrl+C to stop.",
      "",
    ].join("\n"),
  );

  const shutdown = async (signal: string) => {
    console.log(`\n  ${signal} — stopping local database.`);
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(
    "\n  Local database failed to start:",
    error instanceof Error ? error.message : String(error),
    "\n",
  );
  process.exitCode = 1;
});
