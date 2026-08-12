import { requireCourseAccess, requireRole } from "@/auth/guard";
import { bankFilterSchema, listBank } from "@/teacher/item-bank";
import { json, route } from "@/lib/http";

export const GET = route(async (request: Request) => {
  // Role first, input second: an unauthorised caller gets a flat 403 rather
  // than a 400 describing the parameter contract, and the refusal is audited.
  await requireRole("teacher");

  const url = new URL(request.url);
  const filter = bankFilterSchema.parse(Object.fromEntries(url.searchParams));

  await requireCourseAccess(filter.courseId, "teacher");

  // Rejected items are returned like any other status — filtering them out
  // here would hide exactly what FR-VAL-009 requires the UI to show.
  return json({ items: await listBank(filter) });
});
