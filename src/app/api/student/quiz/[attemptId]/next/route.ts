import { requireUser } from "@/auth/guard";
import { nextItem } from "@/student/quiz";
import { json, route } from "@/lib/http";

type Params = { params: Promise<{ attemptId: string }> };

/**
 * Serves the next adaptive item. Ownership is enforced inside `nextItem`,
 * which scopes every query to the authenticated student (FR-STU-042).
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const { attemptId } = await params;
  const actor = await requireUser();

  return json(await nextItem(actor.id, attemptId));
});
