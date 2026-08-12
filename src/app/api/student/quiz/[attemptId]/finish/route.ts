import { requireUser } from "@/auth/guard";
import { finishAttempt } from "@/student/quiz";
import { json, route } from "@/lib/http";

type Params = { params: Promise<{ attemptId: string }> };

/** Student-initiated exit — one of the three termination paths (FR-STU-007). */
export const POST = route(async (_request: Request, { params }: Params) => {
  const { attemptId } = await params;
  const actor = await requireUser();

  return json(await finishAttempt(actor.id, attemptId, "exit"));
});
