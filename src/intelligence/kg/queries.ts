import { runQuery } from "./driver";

/**
 * The graph queries the system actually uses (design.md §5.3).
 *
 * Variable-length patterns cannot take a parameterised upper bound in Cypher,
 * so `hops` is interpolated — every call site clamps it to a small integer
 * first via `clampHops`, and it is never taken from user input unvalidated.
 */

function clampHops(hops: number): number {
  if (!Number.isFinite(hops)) return 1;
  return Math.max(1, Math.min(5, Math.trunc(hops)));
}

/** Everything `topicId` transitively depends on. */
export async function prerequisiteClosure(topicId: string, hops = 5): Promise<string[]> {
  const n = clampHops(hops);
  const rows = await runQuery<{ id: string }>(
    `MATCH (p:Topic)-[:PREREQ_OF*1..${n}]->(t:Topic {id: $id})
     RETURN DISTINCT p.id AS id`,
    { id: topicId },
  );
  return rows.map((r) => r.id);
}

/** Everything that transitively depends on `topicId`. */
export async function forwardDependents(topicId: string, hops = 5): Promise<string[]> {
  const n = clampHops(hops);
  const rows = await runQuery<{ id: string }>(
    `MATCH (t:Topic {id: $id})-[:PREREQ_OF*1..${n}]->(d:Topic)
     RETURN DISTINCT d.id AS id`,
    { id: topicId },
  );
  return rows.map((r) => r.id);
}

/** Topics a CLO is assessed by — its sibling set. */
export async function cloSiblingTopics(cloId: string): Promise<string[]> {
  const rows = await runQuery<{ id: string }>(
    `MATCH (c:CLO {id: $id})-[:ASSESSED_BY]->(t:Topic) RETURN t.id AS id`,
    { id: cloId },
  );
  return rows.map((r) => r.id);
}

/**
 * Graph expansion for Graph RAG (§6.4 step 4): from the topics of the dense and
 * lexical hits, walk PREREQ_OF and ASSESSED_BY to pull in neighbouring topics.
 */
export async function expandTopics(seedTopicIds: string[], hops = 1): Promise<string[]> {
  if (seedTopicIds.length === 0) return [];
  const n = clampHops(hops);
  const rows = await runQuery<{ id: string }>(
    `MATCH (t:Topic) WHERE t.id IN $seeds
     MATCH (t)-[:PREREQ_OF|ASSESSED_BY*0..${n}]-(n2:Topic)
     RETURN DISTINCT n2.id AS id`,
    { seeds: seedTopicIds },
  );
  return rows.map((r) => r.id);
}

export interface CloPloTrace {
  ploId: string;
  ploCode: string;
  strength: number;
}

/** The CLO→PLO contribution path, used by the curriculum matrix view. */
export async function cloPloTrace(cloId: string): Promise<CloPloTrace[]> {
  return runQuery<CloPloTrace>(
    `MATCH (c:CLO {id: $id})-[m:MAPS_TO]->(p:PLO)
     RETURN p.id AS ploId, p.code AS ploCode, m.strength AS strength
     ORDER BY p.code`,
    { id: cloId },
  );
}

/** Topics with no indexed learning object — a corpus coverage gap (§10.4). */
export async function topicsWithoutCoverage(courseId: string): Promise<string[]> {
  const rows = await runQuery<{ id: string }>(
    `MATCH (c:Course {id: $courseId})-[:COVERS]->(t:Topic)
     WHERE NOT EXISTS { MATCH (:LearningObject)-[:ABOUT]->(t) }
     RETURN t.id AS id`,
    { courseId },
  );
  return rows.map((r) => r.id);
}

/**
 * Self-reachability check for the curriculum validation console. Must return
 * zero rows; anything else is a cycle the seeder should never have allowed.
 */
export async function detectPrereqCycles(): Promise<string[]> {
  const rows = await runQuery<{ id: string }>(
    `MATCH (t:Topic)-[:PREREQ_OF*1..]->(t) RETURN DISTINCT t.id AS id`,
  );
  return rows.map((r) => r.id);
}

/**
 * Does a path exist from this CLO to this topic? Backs the graph half of the
 * `clo_alignment` validation check (§7).
 */
export async function cloAssessesTopic(cloId: string, topicId: string): Promise<boolean> {
  const rows = await runQuery<{ ok: boolean }>(
    `MATCH (c:CLO {id: $cloId})
     RETURN EXISTS { MATCH (c)-[:ASSESSED_BY]->(:Topic {id: $topicId}) } AS ok`,
    { cloId, topicId },
  );
  return rows[0]?.ok === true;
}

/** Chunk ids ABOUT any of the given topics — the graph-only candidate set. */
export async function learningObjectsForTopics(
  topicIds: string[],
  limit: number,
): Promise<string[]> {
  if (topicIds.length === 0) return [];
  const rows = await runQuery<{ id: string }>(
    `MATCH (lo:LearningObject)-[:ABOUT]->(t:Topic)
     WHERE t.id IN $topicIds
     RETURN DISTINCT lo.id AS id
     LIMIT toInteger($limit)`,
    { topicIds, limit },
  );
  return rows.map((r) => r.id);
}
