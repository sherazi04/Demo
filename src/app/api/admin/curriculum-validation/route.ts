import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { validateCurriculum } from "@/governance/curriculum-validation";
import { NotFoundError } from "@/lib/errors";
import { json, route } from "@/lib/http";

/** Admin and teacher may both read the console (design.md §11). */
export const GET = route(async (request: Request) => {
  await requireRole("teacher");

  const courseId =
    new URL(request.url).searchParams.get("courseId") ??
    (await db.select({ id: courses.id }).from(courses).limit(1))[0]?.id;

  if (!courseId) throw new NotFoundError("Course");

  return json(await validateCurriculum(courseId));
});
