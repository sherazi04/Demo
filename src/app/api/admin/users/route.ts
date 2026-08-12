import { z } from "zod";
import { requireRole } from "@/auth/guard";
import { createUser, createUserSchema, listUsers } from "@/admin/users";
import { json, route } from "@/lib/http";

const querySchema = z.object({
  search: z.string().max(200).optional(),
  role: z.enum(["student", "teacher", "admin"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const GET = route(async (request: Request) => {
  await requireRole("admin");
  const url = new URL(request.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams));
  return json({ users: await listUsers(query) });
});

export const POST = route(async (request: Request) => {
  const actor = await requireRole("admin");
  const input = createUserSchema.parse(await request.json());
  const created = await createUser(actor, input);
  // The invite token is returned exactly once, for the admin to pass on out of
  // band. It is not recoverable later — only reissuable.
  return json(created, 201);
});
