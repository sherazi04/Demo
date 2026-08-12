import { requireRole } from "@/auth/guard";
import { configSchema, getConfig, setConfigValues } from "@/lib/config";
import { json, route } from "@/lib/http";

/**
 * Runtime configuration (FR-ADM-005..007, NFR-CFG-001..005).
 *
 * Changes take effect within the config cache TTL — no redeploy — and every
 * write records before/after values in the audit log.
 */
export const GET = route(async () => {
  await requireRole("admin");
  return json({ config: await getConfig() });
});

export const PUT = route(async (request: Request) => {
  const actor = await requireRole("admin");
  // `.partial()` so a caller can send one key without restating the whole set.
  const updates = configSchema.partial().parse(await request.json());

  const config = await setConfigValues(actor, updates);
  return json({ ok: true, config });
});
