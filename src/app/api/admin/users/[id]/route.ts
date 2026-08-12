import { z } from "zod";
import { requireRole } from "@/auth/guard";
import { reissueInvite, setUserStatus, updateUser, updateUserSchema } from "@/admin/users";
import { json, route } from "@/lib/http";

const patchSchema = z.union([
  updateUserSchema.extend({ op: z.literal("update").optional() }),
  z.object({ op: z.literal("suspend") }),
  z.object({ op: z.literal("reactivate") }),
  z.object({ op: z.literal("reissue_invite") }),
]);

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const actor = await requireRole("admin");
  const { id } = await params;
  const body = patchSchema.parse(await request.json());

  if ("op" in body && body.op === "suspend") {
    await setUserStatus(actor, id, "suspended");
    return json({ ok: true, status: "suspended" });
  }
  if ("op" in body && body.op === "reactivate") {
    await setUserStatus(actor, id, "active");
    return json({ ok: true, status: "active" });
  }
  if ("op" in body && body.op === "reissue_invite") {
    const inviteToken = await reissueInvite(actor, id);
    return json({ ok: true, inviteToken });
  }

  const { op: _op, ...patch } = body as { op?: string } & Record<string, unknown>;
  await updateUser(actor, id, patch);
  return json({ ok: true });
});

/**
 * Accounts are suspended, never hard-deleted: their id is referenced by
 * attempts, audit records and authored material, and removing the row would
 * break the very audit trail the governance layer exists to keep (FR-ADM-004).
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const actor = await requireRole("admin");
  const { id } = await params;
  await setUserStatus(actor, id, "suspended");
  return json({
    ok: true,
    status: "suspended",
    note: "Accounts are suspended rather than deleted so the audit trail stays intact.",
  });
});
