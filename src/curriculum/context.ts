import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clos, courses, topics } from "@/db/schema";
import type { CourseContext } from "@/intelligence/llm/prompts/shared";

/**
 * Loads the cached-prefix course context (design.md §6.2 system[1]).
 *
 * Lives here rather than in the ingest pipeline because every generative
 * feature needs it — the assessment generator, the lecture co-pilot and the
 * feedback engine all do — and importing it from `ingest/pipeline.ts` dragged
 * the PDF, DOCX and PPTX parsers into every one of those bundles.
 *
 * Ordering is fixed and deterministic: rows returned in a different order would
 * change the rendered bytes and silently break the prompt cache without
 * changing the meaning.
 */
export async function loadCourseContext(courseId: string): Promise<CourseContext> {
  const [course] = await db
    .select({ code: courses.code, title: courses.title })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  if (!course) throw new Error(`course ${courseId} not found`);

  const cloRows = await db
    .select({ code: clos.code, statement: clos.statement, bloomLevel: clos.bloomLevel })
    .from(clos)
    .where(eq(clos.courseId, courseId))
    .orderBy(clos.ordinal);

  const topicRows = await db
    .select({ code: topics.code, title: topics.title, week: topics.week })
    .from(topics)
    .where(eq(topics.courseId, courseId))
    .orderBy(topics.ordinal);

  return {
    courseCode: course.code,
    courseTitle: course.title,
    clos: cloRows,
    topics: topicRows,
  };
}

export type { CourseContext };
