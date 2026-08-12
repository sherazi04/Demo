import { requireRole } from "@/auth/guard";
import { verifyChain } from "@/governance/audit";
import { json, route } from "@/lib/http";

/**
 * Chain verification as an admin action (FR-GOV-005). Returns pass/fail and
 * the first broken link, so a failure is localised rather than merely reported.
 */
export const POST = route(async () => {
  await requireRole("admin");

  const result = await verifyChain();

  return json({
    ok: result.ok,
    checked: result.checked,
    firstBrokenSeq: result.firstBrokenSeq ?? null,
    reason: result.reason ?? null,
    detail: result.detail ?? null,
    message: result.ok
      ? `Chain intact across ${result.checked} record(s).`
      : `Chain broken at record ${result.firstBrokenSeq}: ${result.detail ?? result.reason}`,
  });
});
