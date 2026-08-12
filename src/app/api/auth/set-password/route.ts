import { z } from "zod";
import { setPasswordWithInvite } from "@/admin/users";
import { json, route } from "@/lib/http";

const bodySchema = z.object({
  token: z.string().min(10),
  password: z.string().min(1),
});

/**
 * First-login password set, authenticated by a single-use invite token rather
 * than a session (the account has no password yet, so it cannot sign in).
 *
 * This is emphatically not a registration endpoint: it can only ever activate
 * an account an administrator already created, and the token is consumed on use.
 */
export const POST = route(async (request: Request) => {
  const body = bodySchema.parse(await request.json());
  await setPasswordWithInvite(body.token, body.password);
  return json({ ok: true });
});
