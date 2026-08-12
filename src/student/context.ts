import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { courses, enrollments } from "@/db/schema";
import { requireUser, type AuthedUser } from "@/auth/guard";
import { NotFoundError } from "@/lib/errors";

/**
 * Resolves the course a student is enrolled in.
 *
 * Derived from the enrolment rather than taken from the request, so a student
 * cannot reach another course by changing an id — the guard then re-checks
 * ownership on every row it returns.
 */
export interface StudentCourse {
  id: string;
  code: string;
  title: string;
  weeks: number;
}

/**
 * Non-throwing variant, for pages.
 *
 * A route handler answering 404 to an unenrolled student is correct. A *page*
 * doing the same crashes the render, so a real account that simply has not been
 * enrolled yet meets a stack trace instead of a sentence telling them what to
 * do. Pages use this and render an explanatory panel; route handlers keep the
 * throwing version below.
 */
export async function currentStudentCourseOrNull(): Promise<
  { actor: AuthedUser; course: StudentCourse } | { actor: AuthedUser; course: null }
> {
  const actor = await requireUser();

  const [course] = await db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      weeks: courses.weeks,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(enrollments.userId, actor.id))
    .orderBy(courses.code)
    .limit(1);

  return course ? { actor, course } : { actor, course: null };
}

export async function currentStudentCourse(): Promise<{
  actor: AuthedUser;
  course: StudentCourse;
}> {
  const resolved = await currentStudentCourseOrNull();

  if (!resolved.course) {
    throw new NotFoundError(
      "No course. An administrator needs to enrol this account on a course",
    );
  }

  return { actor: resolved.actor, course: resolved.course };
}
