import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { computeBiasReport, METRIC_LABELS, type BiasMetric } from "@/governance/bias-monitor";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
} from "@/components/ui/primitives";
import { toPercent } from "@/lib/utils";

export const metadata = { title: "Bias monitor · Admin" };
export const dynamic = "force-dynamic";

export default async function BiasPage() {
  await requireRole("admin");

  const [course] = await db.select({ id: courses.id, code: courses.code }).from(courses).limit(1);
  if (!course) {
    return <EmptyState title="No course seeded" hint="Run npm run seed:curriculum first." />;
  }

  const report = await computeBiasReport(course.id);
  const metricNames = [...new Set(report.metrics.map((m) => m.metric))] as BiasMetric[];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Bias monitor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-slice fairness metrics across {report.cohortSize} enrolled students in{" "}
          {course.code}. A slice is flagged when it deviates from the cohort mean by more than{" "}
          {report.threshold} (absolute) or 1.5× (rates).
        </p>
      </div>

      {report.underpoweredSlices.length > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Slices with fewer than 5 students are shown but never flagged:{" "}
          {report.underpoweredSlices.join(", ")}. At that size a deviation is noise, and
          flagging it would train the reader to ignore the flags that matter.
        </p>
      )}

      {report.metrics.length === 0 ? (
        <EmptyState
          title="No data yet"
          hint="Metrics appear once students have answered questions. Run npm run seed:cohort to generate a synthetic cohort."
        />
      ) : (
        metricNames.map((metric) => {
          const rows = report.metrics.filter((m) => m.metric === metric);
          const label = METRIC_LABELS[metric];

          return (
            <Card key={metric}>
              <CardHeader>
                <CardTitle className="text-sm">{label.label}</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">{label.description}</p>
              </CardHeader>
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{label.label} by cohort slice</caption>
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th scope="col" className="pb-2 pr-3 font-medium">Slice</th>
                        <th scope="col" className="pb-2 pr-3 font-medium">Value</th>
                        <th scope="col" className="pb-2 pr-3 font-medium">Cohort mean</th>
                        <th scope="col" className="pb-2 pr-3 font-medium">Deviation</th>
                        <th scope="col" className="pb-2 pr-3 font-medium">n</th>
                        <th scope="col" className="pb-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${metric}-${row.sliceKey}`} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium">{row.sliceKey}</td>
                          <td className="py-2 pr-3 tabular-nums">{toPercent(row.value, 1)}</td>
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                            {toPercent(row.cohortMean, 1)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {row.deviation >= 0 ? "+" : ""}
                            {(row.deviation * 100).toFixed(1)} pp
                          </td>
                          {/* Sample size beside every figure — honesty rule 5. */}
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                            {row.sampleSize}
                          </td>
                          <td className="py-2">
                            <StatusBadge
                              kind={row.flagged ? "warning" : "success"}
                              label={row.flagged ? "flagged" : "within range"}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          );
        })
      )}

      <p className="text-xs text-muted-foreground">
        Demographic attributes are read only by this monitor and only by administrators. No
        teacher- or student-facing query joins them.
      </p>
    </div>
  );
}
