import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  chunkClos,
  chunks,
  cloPloMap,
  cloTopics,
  clos,
  courses,
  misconceptions,
  plos,
  programs,
  topicPrereqs,
  topics,
} from "@/db/schema";
import { withSession } from "./driver";
import { logger } from "@/lib/logger";

/**
 * Rebuilds the Neo4j read model from Postgres (FR-INT-032).
 *
 * Idempotent by construction: every node and relationship is MERGEd on its
 * Postgres id, then orphans whose source row no longer exists are deleted. The
 * whole graph can be dropped and this command restores it exactly.
 */

export interface SyncResult {
  programs: number;
  plos: number;
  courses: number;
  clos: number;
  topics: number;
  misconceptions: number;
  learningObjects: number;
  deletedOrphans: number;
}

async function applyConstraints(): Promise<void> {
  const path = fileURLToPath(new URL("./schema.cypher", import.meta.url));
  const text = await readFile(path, "utf8");
  const statements = text
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);

  await withSession(async (session) => {
    for (const statement of statements) {
      await session.run(statement);
    }
  });
}

export async function syncKnowledgeGraph(courseCode?: string): Promise<SyncResult> {
  await applyConstraints();

  const courseRows = courseCode
    ? await db.select().from(courses).where(eq(courses.code, courseCode))
    : await db.select().from(courses);
  if (courseRows.length === 0) {
    throw new Error(courseCode ? `course ${courseCode} not found` : "no courses to sync");
  }

  const programRows = await db.select().from(programs);
  const ploRows = await db.select().from(plos);
  const cloRows = await db.select().from(clos);
  const topicRows = await db.select().from(topics);
  const misconceptionRows = await db.select().from(misconceptions);
  const cloPloRows = await db.select().from(cloPloMap);
  const cloTopicRows = await db.select().from(cloTopics);
  const prereqRows = await db.select().from(topicPrereqs);

  // Only chunks that have been tagged with a topic become LearningObjects —
  // an untagged chunk has nothing to attach to and would create a dangling node.
  const chunkRows = await db
    .select({
      id: chunks.id,
      topicId: chunks.topicId,
      bloomLevel: chunks.bloomLevel,
      difficulty: chunks.difficulty,
      lomFormat: chunks.lomFormat,
      materialId: chunks.materialId,
    })
    .from(chunks)
    .where(isNotNull(chunks.topicId));

  const chunkCloRows = await db.select().from(chunkClos);

  await withSession(async (session) => {
    await session.executeWrite(async (tx) => {
      await tx.run(
        `UNWIND $rows AS r
         MERGE (n:Program {id: r.id})
         SET n.code = r.code, n.title = r.title`,
        { rows: programRows.map((p) => ({ id: p.id, code: p.code, title: p.title })) },
      );

      await tx.run(
        `UNWIND $rows AS r
         MERGE (n:PLO {id: r.id})
         SET n.code = r.code, n.statement = r.statement, n.ordinal = r.ordinal
         WITH n, r MATCH (p:Program {id: r.programId})
         MERGE (p)-[:HAS_PLO]->(n)`,
        {
          rows: ploRows.map((p) => ({
            id: p.id,
            programId: p.programId,
            code: p.code,
            statement: p.statement,
            ordinal: p.ordinal,
          })),
        },
      );

      await tx.run(
        `UNWIND $rows AS r
         MERGE (n:Course {id: r.id})
         SET n.code = r.code, n.title = r.title
         WITH n, r MATCH (p:Program {id: r.programId})
         MERGE (p)-[:OFFERS]->(n)`,
        {
          rows: courseRows.map((c) => ({
            id: c.id,
            programId: c.programId,
            code: c.code,
            title: c.title,
          })),
        },
      );

      await tx.run(
        `UNWIND $rows AS r
         MERGE (n:CLO {id: r.id})
         SET n.code = r.code, n.statement = r.statement,
             n.bloomLevel = r.bloomLevel, n.weight = r.weight
         WITH n, r MATCH (c:Course {id: r.courseId})
         MERGE (c)-[:HAS_CLO]->(n)`,
        {
          rows: cloRows.map((c) => ({
            id: c.id,
            courseId: c.courseId,
            code: c.code,
            statement: c.statement,
            bloomLevel: c.bloomLevel,
            weight: c.weight,
          })),
        },
      );

      await tx.run(
        `UNWIND $rows AS r
         MERGE (n:Topic {id: r.id})
         SET n.code = r.code, n.title = r.title, n.week = r.week,
             n.ordinal = r.ordinal, n.summary = r.summary
         WITH n, r MATCH (c:Course {id: r.courseId})
         MERGE (c)-[:COVERS]->(n)`,
        {
          rows: topicRows.map((t) => ({
            id: t.id,
            courseId: t.courseId,
            code: t.code,
            title: t.title,
            week: t.week,
            ordinal: t.ordinal,
            summary: t.summary,
          })),
        },
      );

      await tx.run(
        `UNWIND $rows AS r
         MERGE (n:Misconception {id: r.id})
         SET n.code = r.code, n.description = r.description, n.remediation = r.remediation
         WITH n, r MATCH (t:Topic {id: r.topicId})
         MERGE (t)-[:HAS_MISCONCEPTION]->(n)`,
        {
          rows: misconceptionRows.map((m) => ({
            id: m.id,
            topicId: m.topicId,
            code: m.code,
            description: m.description,
            remediation: m.remediation,
          })),
        },
      );

      await tx.run(
        `UNWIND $rows AS r
         MATCH (c:CLO {id: r.cloId}), (p:PLO {id: r.ploId})
         MERGE (c)-[m:MAPS_TO]->(p) SET m.strength = r.strength`,
        { rows: cloPloRows },
      );

      await tx.run(
        `UNWIND $rows AS r
         MATCH (c:CLO {id: r.cloId}), (t:Topic {id: r.topicId})
         MERGE (c)-[:ASSESSED_BY]->(t)`,
        { rows: cloTopicRows },
      );

      // Edge direction: prerequisite -> dependent, so `PREREQ_OF` reads
      // naturally and the closure query in §5.3 matches as written.
      await tx.run(
        `UNWIND $rows AS r
         MATCH (p:Topic {id: r.prereqTopicId}), (t:Topic {id: r.topicId})
         MERGE (p)-[:PREREQ_OF]->(t)`,
        { rows: prereqRows },
      );

      await tx.run(
        `UNWIND $rows AS r
         MERGE (n:LearningObject {id: r.id})
         SET n.bloomLevel = r.bloomLevel, n.difficulty = r.difficulty,
             n.lomFormat = r.lomFormat, n.materialId = r.materialId
         WITH n, r MATCH (t:Topic {id: r.topicId})
         MERGE (n)-[:ABOUT]->(t)`,
        { rows: chunkRows },
      );

      await tx.run(
        `UNWIND $rows AS r
         MATCH (lo:LearningObject {id: r.chunkId}), (c:CLO {id: r.cloId})
         MERGE (lo)-[e:EVIDENCE_FOR]->(c) SET e.relevance = r.relevance`,
        { rows: chunkCloRows },
      );
    });
  });

  // Orphan sweep: anything in the graph whose Postgres row is gone.
  const deleted = await withSession(async (session) => {
    const result = await session.executeWrite(async (tx) => {
      const res = await tx.run(
        `MATCH (n)
         WHERE (n:Program OR n:PLO OR n:Course OR n:CLO OR n:Topic
                OR n:Misconception OR n:LearningObject)
           AND NOT n.id IN $liveIds
         DETACH DELETE n
         RETURN count(n) AS deleted`,
        {
          liveIds: [
            ...programRows.map((r) => r.id),
            ...ploRows.map((r) => r.id),
            ...courseRows.map((r) => r.id),
            ...cloRows.map((r) => r.id),
            ...topicRows.map((r) => r.id),
            ...misconceptionRows.map((r) => r.id),
            ...chunkRows.map((r) => r.id),
          ],
        },
      );
      return Number(res.records[0]?.get("deleted") ?? 0);
    });
    return result;
  });

  const summary: SyncResult = {
    programs: programRows.length,
    plos: ploRows.length,
    courses: courseRows.length,
    clos: cloRows.length,
    topics: topicRows.length,
    misconceptions: misconceptionRows.length,
    learningObjects: chunkRows.length,
    deletedOrphans: deleted,
  };
  logger.info("knowledge graph synced", { ...summary });
  return summary;
}
