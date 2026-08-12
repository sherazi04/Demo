import { z } from "zod";
import { requireCourseAccess } from "@/auth/guard";
import { correctionOptions, getReviewQueue, queueStats } from "@/teacher/tag-review";
import { BadRequestError } from "@/lib/errors";
import { json, route } from "@/lib/http";

const querySchema = z.object({
  courseId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeVerified: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

/**
 * The review queue, ordered by ascending tagger confidence (FR-INT-023).
 * Untagged chunks sort first — they are invisible to metadata-filtered
 * retrieval until a human assigns a topic.
 */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new BadRequestError("courseId is required");
  const { courseId, limit, includeVerified } = parsed.data;

  await requireCourseAccess(courseId, "teacher");

  const [items, stats, options] = await Promise.all([
    getReviewQueue(courseId, { limit, includeVerified }),
    queueStats(courseId),
    correctionOptions(courseId),
  ]);

  return json({ items, stats, options });
});
