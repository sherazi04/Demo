import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { computeBiasReport, METRIC_LABELS } from "@/governance/bias-monitor";
import { NotFoundError } from "@/lib/errors";
import { json, route } from "@/lib/http";

/**
 * Per-slice fairness metrics (FR-GOV-010..012).
 *
 * `computeBiasReport` re-checks the admin role itself — this is the only path
 * in the system that reads `users.cohort_tag`.
 */
export const GET = route(async (request: Request) => {
  await requireRole("admin");

  const courseId =
    new URL(request.url).searchParams.get("courseId") ??
    (await db.select({ id: courses.id }).from(courses).limit(1))[0]?.id;

  if (!courseId) throw new NotFoundError("Course");

  const report = await computeBiasReport(courseId);

  return json({
    ...report,
    metricLabels: METRIC_LABELS,
    disclaimer:
      "Slices below 5 students are reported but never flagged: at that size a deviation is noise, and flagging it would train the reader to ignore the flags that matter.",
  });
});
