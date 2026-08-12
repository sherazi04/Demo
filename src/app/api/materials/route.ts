import { requireCourseAccess, requireRole } from "@/auth/guard";
import { listMaterials, uploadMaterial, uploadMetaSchema } from "@/teacher/materials";
import { BadRequestError } from "@/lib/errors";
import { json, route } from "@/lib/http";

export const GET = route(async (request: Request) => {
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (!courseId) throw new BadRequestError("courseId is required");

  await requireCourseAccess(courseId, "teacher");
  return json({ materials: await listMaterials(courseId) });
});

/**
 * Multipart upload. The licensing note is a required form field, not an
 * optional one — an upload without it is rejected before anything is written
 * (FR-INT-012).
 */
export const POST = route(async (request: Request) => {
  // Role first, body second: an unauthorised caller is refused before the
  // upload is buffered into memory at all.
  await requireRole("teacher");

  const form = await request.formData();

  const file = form.get("file");
  if (!(file instanceof File)) throw new BadRequestError("A file is required.");

  const meta = uploadMetaSchema.parse({
    courseId: form.get("courseId"),
    title: form.get("title") || file.name,
    licenseNote: form.get("licenseNote"),
    kind: form.get("kind") || undefined,
    supersedesId: form.get("supersedesId") || undefined,
  });

  const actor = await requireCourseAccess(meta.courseId, "teacher");

  const result = await uploadMaterial(actor, meta, {
    filename: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
  });

  return json(result, 201);
});
