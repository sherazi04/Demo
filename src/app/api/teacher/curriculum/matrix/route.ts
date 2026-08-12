import { requireCourseAccess } from "@/auth/guard";
import { getCloPloMatrix, getItemBankCoverage } from "@/teacher/curriculum";
import { BadRequestError } from "@/lib/errors";
import { json, route } from "@/lib/http";

export const GET = route(async (request: Request) => {
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (!courseId) throw new BadRequestError("courseId is required");

  await requireCourseAccess(courseId, "teacher");

  const [matrix, bank] = await Promise.all([
    getCloPloMatrix(courseId),
    getItemBankCoverage(courseId),
  ]);

  return json({ matrix, itemBankCoverage: bank });
});
