import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { attemptItems, attempts } from "@/db/schema";
import { requireCourseAccess, requireRole } from "@/auth/guard";
import { draftFeedback, draftRequestSchema } from "@/teacher/coteacher";
import { NotFoundError } from "@/lib/errors";
import { json, route } from "@/lib/http";

/**
 * Drafts feedback. This route CANNOT release it — releasing is a separate,
 * explicitly-invoked endpoint, so there is no path where a draft reaches a
 * student without a teacher acting (FR-TCH-052).
 */
export const POST = route(async (request: Request) => {
  // Role first, input second: an unauthorised caller gets a flat 403 rather
  // than a 400 describing the parameter contract, and never reaches the lookup
  // below — which would otherwise confirm whether an attempt id exists.
  await requireRole("teacher");

  const { attemptItemId } = draftRequestSchema.parse(await request.json());

  const [row] = await db
    .select({ courseId: attempts.courseId })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .where(eq(attemptItems.id, attemptItemId))
    .limit(1);
  if (!row) throw new NotFoundError("Attempt item");

  const actor = await requireCourseAccess(row.courseId, "teacher");
  const result = await draftFeedback(actor, attemptItemId);

  return json({
    draft: result.draft,
    model: result.model,
    released: false,
    note: "This is a draft. It is not visible to the student until you release it.",
  });
});
