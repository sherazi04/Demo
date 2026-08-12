import { currentStudentCourse } from "@/student/context";
import { getCurrentPlan, regeneratePlan } from "@/student/learning-plan";
import { json, route } from "@/lib/http";

export const GET = route(async () => {
  const { actor, course } = await currentStudentCourse();

  let plan = await getCurrentPlan(actor.id, course.id);
  if (!plan) {
    // First visit: build the initial path rather than showing an empty page.
    await regeneratePlan(actor.id, course.id, "initial plan");
    plan = await getCurrentPlan(actor.id, course.id);
  }

  return json({
    steps: plan?.steps ?? [],
    // The reason the plan last changed is what makes the reordering legible
    // rather than mysterious (§8.5).
    reason: plan?.reason ?? "initial plan",
    generatedAt: plan?.generatedAt ?? null,
  });
});

/** Manual regeneration, e.g. after the student changes their target. */
export const POST = route(async () => {
  const { actor, course } = await currentStudentCourse();
  const steps = await regeneratePlan(actor.id, course.id, "requested by the student");
  return json({ steps, reason: "requested by the student" });
});
