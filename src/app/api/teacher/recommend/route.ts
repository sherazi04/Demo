import { requireCourseAccess, requireRole } from "@/auth/guard";
import { recommend, recommendRequestSchema } from "@/teacher/recommender";
import { json, route } from "@/lib/http";

export const POST = route(async (request: Request) => {
  // Role first, input second: an unauthorised caller gets a flat 403 rather
  // than a 400 describing the parameter contract, and the refusal is audited.
  await requireRole("teacher");

  const input = recommendRequestSchema.parse(await request.json());
  await requireCourseAccess(input.courseId, "teacher");

  return json({ recommendations: await recommend(input) });
});
