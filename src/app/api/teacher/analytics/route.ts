import { requireCourseAccess } from "@/auth/guard";
import { AT_RISK_RULES, getCohortAnalytics } from "@/teacher/analytics";
import { BadRequestError } from "@/lib/errors";
import { json, route } from "@/lib/http";

export const GET = route(async (request: Request) => {
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (!courseId) throw new BadRequestError("courseId is required");

  await requireCourseAccess(courseId, "teacher");

  const analytics = await getCohortAnalytics(courseId);

  return json({
    ...analytics,
    // The full rule set travels with the response so the UI can state the
    // conditions rather than describing the flags as a prediction.
    rules: AT_RISK_RULES,
    disclaimer:
      "At-risk flags are produced by the explicit rules listed here, not by a trained predictive model. Each flag shows the rule that fired and the evidence for it.",
  });
});
