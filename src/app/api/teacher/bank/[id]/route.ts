import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { requireCourseAccess } from "@/auth/guard";
import { reviewActionSchema, reviewItem } from "@/teacher/item-bank";
import { NotFoundError } from "@/lib/errors";
import { json, route } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/**
 * Approve, reject, edit or retire one item (FR-TCH-006).
 *
 * Approving an item that failed validation is refused here and, independently,
 * by a database check constraint (FR-VAL-010).
 */
export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;

  const [row] = await db
    .select({ courseId: questions.courseId })
    .from(questions)
    .where(eq(questions.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("Question");

  const actor = await requireCourseAccess(row.courseId, "teacher");
  const decision = reviewActionSchema.parse(await request.json());

  const result = await reviewItem(actor, id, decision);
  return json({ ok: true, ...result });
});
