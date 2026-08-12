import { requireCourseAccess, requireRole } from "@/auth/guard";
import { generateLecturePlan, lectureRequestSchema } from "@/teacher/lecture-copilot";
import { json, route } from "@/lib/http";

/** Lecture plans are long generations; allow well past the default. */
export const maxDuration = 300;

export const POST = route(async (request: Request) => {
  // Role first, input second: an unauthorised caller gets a flat 403 rather
  // than a 400 describing the parameter contract, and the refusal is audited.
  await requireRole("teacher");

  const input = lectureRequestSchema.parse(await request.json());
  const actor = await requireCourseAccess(input.courseId, "teacher");

  const result = await generateLecturePlan(actor, input);

  return json({
    plan: result.plan,
    // Assertions are returned pass or fail: a teacher needs to see that the
    // Bloom-ascending and formative-check promises were actually checked.
    assertions: result.assertions,
    regenerated: result.regenerated,
    warning: result.warning,
    model: result.model,
    citations: result.citations.map((c) => ({
      chunkId: c.id,
      materialTitle: c.materialTitle,
      sectionPath: c.sectionPath,
      pageFrom: c.pageFrom,
      pageTo: c.pageTo,
    })),
  });
});
