import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { attemptItems, attempts } from "@/db/schema";
import { requireCourseAccess, requireRole } from "@/auth/guard";
import { releaseFeedback, releaseRequestSchema } from "@/teacher/coteacher";
import { NotFoundError } from "@/lib/errors";
import { json, route } from "@/lib/http";

/**
 * Releases teacher-edited feedback to the student. The release itself is
 * audited (FR-GOV-006) — it is a human decision about what a learner sees.
 */
export const POST = route(async (request: Request) => {
  // Role first, input second: an unauthorised caller gets a flat 403 rather
  // than a 400 describing the parameter contract, and never reaches the lookup
  // below — which would otherwise confirm whether an attempt id exists.
  await requireRole("teacher");

  const body = releaseRequestSchema.parse(await request.json());

  const [row] = await db
    .select({ courseId: attempts.courseId })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .where(eq(attemptItems.id, body.attemptItemId))
    .limit(1);
  if (!row) throw new NotFoundError("Attempt item");

  const actor = await requireCourseAccess(row.courseId, "teacher");
  await releaseFeedback(actor, body.attemptItemId, body.edited);

  return json({ ok: true, released: true });
});
