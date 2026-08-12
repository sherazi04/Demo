import neo4j, { type Driver, type Session } from "neo4j-driver";
import { env } from "@/lib/env";

/**
 * Neo4j is a *derived read model* — Postgres is the source of truth (design.md
 * §5.2). Nothing here may be the only copy of anything.
 */

const globalForNeo4j = globalThis as unknown as { __dualEngineNeo4j?: Driver };

function createDriver(): Driver {
  return neo4j.driver(
    env.NEO4J_URI,
    neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
    { maxConnectionPoolSize: 20, disableLosslessIntegers: true },
  );
}

export function getDriver(): Driver {
  const existing = globalForNeo4j.__dualEngineNeo4j;
  if (existing) return existing;
  const driver = createDriver();
  if (env.NODE_ENV !== "production") globalForNeo4j.__dualEngineNeo4j = driver;
  return driver;
}

/** Runs `fn` with a session and always closes it. */
export async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const session = getDriver().session();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

/** Convenience for read-only Cypher returning plain records. */
export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  return withSession(async (session) => {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject() as T);
  });
}

export async function closeDriver(): Promise<void> {
  const driver = globalForNeo4j.__dualEngineNeo4j;
  if (driver) {
    await driver.close();
    globalForNeo4j.__dualEngineNeo4j = undefined;
  }
}

/**
 * True when Neo4j is reachable. The retrieval pipeline degrades to
 * dense + lexical fusion without graph expansion rather than failing outright,
 * so this is checked rather than assumed.
 */
export async function isReachable(): Promise<boolean> {
  try {
    await getDriver().verifyConnectivity();
    return true;
  } catch {
    return false;
  }
}
