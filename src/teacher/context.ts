import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { courses, enrollments } from "@/db/schema";
import { requireRole, type AuthedUser } from "@/auth/guard";
import { NotFoundError } from "@/lib/errors";

/**
 * Resolves the course a teacher is working in.
 *
 * The demo is single-course, but nothing here hardcodes CS-201: the teacher's
 * enrolment determines the course, so adding a second course needs no code
 * change (and an admin sees every course).
 */
export interface TeacherCourse {
  id: string;
  code: string;
  title: string;
  weeks: number;
}

/**
 * Non-throwing variant, for pages. See the note in `src/student/context.ts`:
 * an unenrolled teacher should be told to ask an administrator, not shown a
 * crashed render.
 */
export async function currentTeacherCourseOrNull(): Promise<
  { actor: AuthedUser; course: TeacherCourse } | { actor: AuthedUser; course: null }
> {
  const actor = await requireRole("teacher");

  const rows =
    actor.role === "admin"
      ? await db
          .select({
            id: courses.id,
            code: courses.code,
            title: courses.title,
            weeks: courses.weeks,
          })
          .from(courses)
          .orderBy(courses.code)
          .limit(1)
      : await db
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

  const course = rows[0];
  return course ? { actor, course } : { actor, course: null };
}

export async function currentTeacherCourse(): Promise<{
  actor: AuthedUser;
  course: TeacherCourse;
}> {
  const resolved = await currentTeacherCourseOrNull();

  if (!resolved.course) {
    throw new NotFoundError(
      "No course. An administrator needs to enrol this account as a teacher on a course",
    );
  }

  return { actor: resolved.actor, course: resolved.course };
}
