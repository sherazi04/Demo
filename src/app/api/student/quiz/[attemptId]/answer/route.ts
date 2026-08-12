import { requireUser } from "@/auth/guard";
import { answerSchema, submitAnswer } from "@/student/quiz";
import { json, route } from "@/lib/http";

/** Feedback generation is an LLM call; allow past the default duration. */
export const maxDuration = 120;

export const POST = route(async (request: Request) => {
  const actor = await requireUser();
  const input = answerSchema.parse(await request.json());

  // `submitAnswer` verifies the attempt belongs to this student before writing
  // any mastery state.
  return json(await submitAnswer(actor.id, input));
});
