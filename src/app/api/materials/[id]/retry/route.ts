import { z } from "zod";
import { requireCourseAccess } from "@/auth/guard";
import { getMaterial, retryStage } from "@/teacher/materials";
import { INGEST_STAGES } from "@/worker/queues";
import { json, route } from "@/lib/http";

const bodySchema = z.object({
  stage: z.enum(INGEST_STAGES),
});

type Params = { params: Promise<{ id: string }> };

/**
 * Retries one stage without re-uploading (NFR-REL-001). Completed earlier
 * stages are not re-run — the retry resumes from the named stage and chains
 * forward from there.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const material = await getMaterial(id);
  const actor = await requireCourseAccess(material.courseId, "teacher");

  const { stage } = bodySchema.parse(await request.json());
  await retryStage(actor, id, stage);

  return json({ ok: true, stage });
});
