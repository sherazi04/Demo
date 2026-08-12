import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { chunks } from "@/db/schema";
import { requireCourseAccess } from "@/auth/guard";
import { applyCorrection, tagCorrectionSchema } from "@/teacher/tag-review";
import { NotFoundError } from "@/lib/errors";
import { json, route } from "@/lib/http";

type Params = { params: Promise<{ chunkId: string }> };

/**
 * Applies a tag correction and sets `verified_by` / `verified_at`
 * (FR-INT-024). A topic change re-syncs the affected knowledge-graph edges.
 */
export const PATCH = route(async (request: Request, { params }: Params) => {
  const { chunkId } = await params;

  const [chunk] = await db
    .select({ courseId: chunks.courseId })
    .from(chunks)
    .where(eq(chunks.id, chunkId))
    .limit(1);
  if (!chunk) throw new NotFoundError("Chunk");

  const actor = await requireCourseAccess(chunk.courseId, "teacher");
  const correction = tagCorrectionSchema.parse(await request.json());

  const result = await applyCorrection(actor, chunkId, correction);

  return json({ ok: true, verifiedBy: actor.id, graphResynced: result.topicChanged });
});
