import { requireCourseAccess } from "@/auth/guard";
import { deleteMaterial, getMaterial } from "@/teacher/materials";
import { json, route } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const material = await getMaterial(id);
  await requireCourseAccess(material.courseId, "teacher");

  // storage_path is deliberately not returned — it is a filesystem detail of
  // the server and no client has any use for it.
  return json({
    id: material.id,
    courseId: material.courseId,
    title: material.title,
    filename: material.filename,
    mimeType: material.mimeType,
    sizeBytes: material.sizeBytes,
    licenseNote: material.licenseNote,
    status: material.status,
    progress: material.progress,
    error: material.error,
    pageCount: material.pageCount,
    chunkCount: material.chunkCount,
    supersedesId: material.supersedesId,
    createdAt: material.createdAt,
    indexedAt: material.indexedAt,
  });
});

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const material = await getMaterial(id);
  const actor = await requireCourseAccess(material.courseId, "teacher");

  await deleteMaterial(actor, id);
  return json({ ok: true });
});
