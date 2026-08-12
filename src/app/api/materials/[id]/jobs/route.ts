import { requireCourseAccess } from "@/auth/guard";
import { getJobs } from "@/intelligence/ingest/jobs";
import { getMaterial } from "@/teacher/materials";
import { json, route } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/**
 * Per-stage ingestion progress, polled by the teacher panel (FR-INT-015).
 * Returns all six stages in pipeline order, whether or not they have started.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const material = await getMaterial(id);
  await requireCourseAccess(material.courseId, "teacher");

  const jobs = await getJobs(id);

  return json({
    material: {
      id: material.id,
      title: material.title,
      status: material.status,
      progress: material.progress,
      error: material.error,
      pageCount: material.pageCount,
      chunkCount: material.chunkCount,
      indexedAt: material.indexedAt,
    },
    jobs: jobs.map((job) => ({
      stage: job.stage,
      status: job.status,
      itemsDone: job.itemsDone,
      itemsTotal: job.itemsTotal,
      attempts: job.attempts,
      message: job.message,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    })),
  });
});
