import { currentStudentCourse } from "@/student/context";
import { requireExactSelf } from "@/auth/guard";
import { getAttemptHistory, getCloProgress, getTopicProgress } from "@/student/progress";
import { json, route } from "@/lib/http";

/**
 * A student's own progress. `requireExactSelf` rather than `requireSelf`: this
 * is the student's private view, and a teacher reads cohort data through the
 * analytics route instead (FR-STU-042).
 */
export const GET = route(async () => {
  const { actor, course } = await currentStudentCourse();
  await requireExactSelf(actor.id);

  const [clos, topics, attempts] = await Promise.all([
    getCloProgress(actor.id, course.id),
    getTopicProgress(actor.id, course.id),
    getAttemptHistory(actor.id, course.id),
  ]);

  return json({ course, clos, topics, attempts });
});
