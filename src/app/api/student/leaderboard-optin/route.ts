import { z } from "zod";
import { currentStudentCourse } from "@/student/context";
import { setLeaderboardOptIn } from "@/student/gamification";
import { json, route } from "@/lib/http";

const bodySchema = z.object({ optedIn: z.boolean() });

/**
 * Opting in is the student's own decision and only ever affects their own row
 * (FR-STU-053) — the id comes from the session, never the request.
 */
export const PUT = route(async (request: Request) => {
  const { actor } = await currentStudentCourse();
  const { optedIn } = bodySchema.parse(await request.json());

  await setLeaderboardOptIn(actor.id, optedIn);
  return json({ ok: true, optedIn });
});
