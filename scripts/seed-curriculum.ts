import "dotenv/config";
import { eq, sql as raw } from "drizzle-orm";
import { curriculum } from "@data/curriculum";
import { db, sql } from "@/db/client";
import {
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
import { formatProblems, validateSeed } from "@/curriculum/validate-seed";
import { logger } from "@/lib/logger";

/**
 * Loads the declarative curriculum spine into Postgres (FR-INT-001..007).
 *
 * Idempotent: every write is an upsert keyed on the natural code, so re-running
 * after editing a statement updates in place rather than duplicating. Runs
 * inside one transaction — a partially-seeded curriculum would leave the drift
 * check validating against an incomplete spine, which is worse than no spine.
 */
async function main(): Promise<void> {
  const problems = validateSeed();
  if (problems.length > 0) {
    // Nothing has been written at this point, and nothing will be.
    throw new Error(`Curriculum seed is invalid:\n${formatProblems(problems)}`);
  }
  logger.info("seed validated", {
    topics: curriculum.topics.length,
    clos: curriculum.clos.length,
    plos: curriculum.plos.length,
    prereqs: curriculum.prereqs.length,
    misconceptions: curriculum.misconceptions.length,
  });

  await db.transaction(async (tx) => {
    const [programRow] = await tx
      .insert(programs)
      .values({
        code: curriculum.program.code,
        title: curriculum.program.title,
        accreditationBody: curriculum.program.accreditationBody,
      })
      .onConflictDoUpdate({
        target: programs.code,
        set: {
          title: curriculum.program.title,
          accreditationBody: curriculum.program.accreditationBody,
        },
      })
      .returning();
    if (!programRow) throw new Error("failed to upsert program");

    await tx
      .insert(plos)
      .values(
        curriculum.plos.map((p) => ({
          programId: programRow.id,
          code: p.code,
          statement: p.statement,
          ordinal: p.ordinal,
        })),
      )
      .onConflictDoUpdate({
        target: [plos.programId, plos.code],
        set: {
          statement: raw`excluded.statement`,
          ordinal: raw`excluded.ordinal`,
        },
      });

    const [courseRow] = await tx
      .insert(courses)
      .values({
        programId: programRow.id,
        code: curriculum.course.code,
        title: curriculum.course.title,
        creditHours: curriculum.course.creditHours,
        weeks: curriculum.course.weeks,
      })
      .onConflictDoUpdate({
        target: courses.code,
        set: {
          title: curriculum.course.title,
          creditHours: curriculum.course.creditHours,
          weeks: curriculum.course.weeks,
        },
      })
      .returning();
    if (!courseRow) throw new Error("failed to upsert course");

    await tx
      .insert(clos)
      .values(
        curriculum.clos.map((c) => ({
          courseId: courseRow.id,
          code: c.code,
          statement: c.statement,
          bloomLevel: c.bloomLevel,
          weight: c.weight,
          ordinal: c.ordinal,
        })),
      )
      .onConflictDoUpdate({
        target: [clos.courseId, clos.code],
        set: {
          statement: raw`excluded.statement`,
          bloomLevel: raw`excluded.bloom_level`,
          weight: raw`excluded.weight`,
          ordinal: raw`excluded.ordinal`,
        },
      });

    await tx
      .insert(topics)
      .values(
        curriculum.topics.map((t) => ({
          courseId: courseRow.id,
          code: t.code,
          title: t.title,
          week: t.week,
          ordinal: t.ordinal,
          summary: t.summary,
        })),
      )
      .onConflictDoUpdate({
        target: [topics.courseId, topics.code],
        set: {
          title: raw`excluded.title`,
          week: raw`excluded.week`,
          ordinal: raw`excluded.ordinal`,
          summary: raw`excluded.summary`,
        },
      });

    // Resolve natural codes to ids once, then build the join tables.
    const cloRows = await tx.select().from(clos).where(eq(clos.courseId, courseRow.id));
    const topicRows = await tx.select().from(topics).where(eq(topics.courseId, courseRow.id));
    const ploRows = await tx.select().from(plos).where(eq(plos.programId, programRow.id));

    const cloId = new Map(cloRows.map((r) => [r.code, r.id]));
    const topicId = new Map(topicRows.map((r) => [r.code, r.id]));
    const ploId = new Map(ploRows.map((r) => [r.code, r.id]));

    const need = <T>(map: Map<string, T>, code: string, label: string): T => {
      const value = map.get(code);
      if (value === undefined) throw new Error(`${label} "${code}" missing after upsert`);
      return value;
    };

    /**
     * Join tables are replaced wholesale rather than upserted: an edge removed
     * from the seed file must disappear from the database, or the CLO↔PLO
     * matrix silently accumulates edges no author can see.
     */
    await tx.delete(cloPloMap).where(
      raw`${cloPloMap.cloId} IN (SELECT id FROM clos WHERE course_id = ${courseRow.id})`,
    );
    await tx.insert(cloPloMap).values(
      curriculum.cloPloMap.map((m) => ({
        cloId: need(cloId, m.clo, "CLO"),
        ploId: need(ploId, m.plo, "PLO"),
        strength: m.strength,
      })),
    );

    await tx.delete(cloTopics).where(
      raw`${cloTopics.cloId} IN (SELECT id FROM clos WHERE course_id = ${courseRow.id})`,
    );
    await tx.insert(cloTopics).values(
      curriculum.cloTopics.map((m) => ({
        cloId: need(cloId, m.clo, "CLO"),
        topicId: need(topicId, m.topic, "topic"),
      })),
    );

    await tx.delete(topicPrereqs).where(
      raw`${topicPrereqs.topicId} IN (SELECT id FROM topics WHERE course_id = ${courseRow.id})`,
    );
    await tx.insert(topicPrereqs).values(
      curriculum.prereqs.map((p) => ({
        topicId: need(topicId, p.topic, "topic"),
        prereqTopicId: need(topicId, p.prereq, "topic"),
      })),
    );

    await tx
      .insert(misconceptions)
      .values(
        curriculum.misconceptions.map((m) => ({
          topicId: need(topicId, m.topic, "topic"),
          code: m.code,
          description: m.description,
          remediation: m.remediation,
        })),
      )
      .onConflictDoUpdate({
        target: misconceptions.code,
        set: {
          topicId: raw`excluded.topic_id`,
          description: raw`excluded.description`,
          remediation: raw`excluded.remediation`,
        },
      });

    logger.info("curriculum seeded", {
      program: programRow.code,
      course: courseRow.code,
      plos: curriculum.plos.length,
      clos: curriculum.clos.length,
      topics: curriculum.topics.length,
      cloPloEdges: curriculum.cloPloMap.length,
      cloTopicEdges: curriculum.cloTopics.length,
      prereqEdges: curriculum.prereqs.length,
      misconceptions: curriculum.misconceptions.length,
    });
  });
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    logger.error("curriculum seed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await sql.end();
    process.exitCode = 1;
  });
