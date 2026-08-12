import { z } from "zod";
import { requireRole } from "@/auth/guard";
import { enrol, listCourseRoster, unenrol } from "@/admin/users";
import { json, route } from "@/lib/http";

const createSchema = z.object({
  userId: z.string().uuid(),
  courseId: z.string().uuid(),
  role: z.enum(["student", "teacher"]),
});

const deleteSchema = z.object({
  userId: z.string().uuid(),
  courseId: z.string().uuid(),
});

export const GET = route(async (request: Request) => {
  await requireRole("admin");
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (!courseId) return json({ error: { code: "bad_request", message: "courseId is required" } }, 400);
  return json({ roster: await listCourseRoster(courseId) });
});

export const POST = route(async (request: Request) => {
  const actor = await requireRole("admin");
  const body = createSchema.parse(await request.json());
  await enrol(actor, body.userId, body.courseId, body.role);
  return json({ ok: true }, 201);
});

export const DELETE = route(async (request: Request) => {
  const actor = await requireRole("admin");
  const body = deleteSchema.parse(await request.json());
  await unenrol(actor, body.userId, body.courseId);
  return json({ ok: true });
});
