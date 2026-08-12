import { requireCourseAccess, requireRole } from "@/auth/guard";
import { startAttempt, startQuizSchema } from "@/student/quiz";
import { json, route } from "@/lib/http";

export const POST = route(async (request: Request) => {
  // Role first, input second: an unauthorised caller gets a flat 403 rather
  // than a 400 describing the parameter contract, and the refusal is audited.
  await requireRole("student");

  const input = startQuizSchema.parse(await request.json());
  const actor = await requireCourseAccess(input.courseId, "student");

  // The attempt is bound to the authenticated user, never to an id from the
  // request body — a student cannot start a run as someone else.
  return json(await startAttempt(actor.id, input), 201);
});
