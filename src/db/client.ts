import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Database client, constructed lazily on first use.
 *
 * Opening a TCP pool as a side effect of `import` would mean that merely
 * importing a module which happens to reference the database — even to use a
 * pure function declared alongside a query — connects, and fails hard when the
 * environment is not configured. Deferring construction to first property
 * access keeps imports free of side effects and lets pure logic be unit-tested
 * without a database or a populated `.env`.
 */

const globalForDb = globalThis as unknown as {
  __dualEngineSql?: ReturnType<typeof postgres>;
  __dualEngineDb?: PostgresJsDatabase<typeof schema>;
};

function createSql(): ReturnType<typeof postgres> {
  return postgres(env.DATABASE_URL, {
    /**
     * Concurrency of the pool. Ten is right for a real server; the local
     * PGlite dev database (scripts/local-db.ts) accepts a single connection
     * and resets any others, so DATABASE_POOL_MAX=1 is set in that mode.
     * postgres.js then queues statements on the one connection rather than
     * opening more.
     */
    max: env.DATABASE_POOL_MAX,
    idle_timeout: 20,
    // Drizzle's `vector` type sends and receives the pgvector text form;
    // postgres.js must not try to parse it as an array.
    types: {},
  });
}

function realSql(): ReturnType<typeof postgres> {
  const existing = globalForDb.__dualEngineSql;
  if (existing) return existing;
  const created = createSql();
  // Cached on globalThis so Next.js dev-mode module reloading does not leak a
  // pool per edit and exhaust Postgres connections.
  globalForDb.__dualEngineSql = created;
  return created;
}

function realDb(): PostgresJsDatabase<typeof schema> {
  const existing = globalForDb.__dualEngineDb;
  if (existing) return existing;
  const created = drizzle(realSql(), { schema });
  globalForDb.__dualEngineDb = created;
  return created;
}

/** Raw postgres.js tag, for the few places a Postgres feature demands it. */
export const sql = new Proxy((() => undefined) as unknown as ReturnType<typeof postgres>, {
  get: (_t, prop) => Reflect.get(realSql(), prop) as unknown,
  apply: (_t, thisArg, args) =>
    Reflect.apply(realSql() as unknown as (...a: unknown[]) => unknown, thisArg, args),
});

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get: (_t, prop) => Reflect.get(realDb(), prop) as unknown,
});

export type Db = PostgresJsDatabase<typeof schema>;
export { schema };
