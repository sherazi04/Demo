import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { validateCurriculum } from "@/governance/curriculum-validation";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
} from "@/components/ui/primitives";

export const metadata = { title: "Curriculum validation · Admin" };
export const dynamic = "force-dynamic";

export default async function ValidationPage() {
  await requireRole("teacher");

  const [course] = await db
    .select({ id: courses.id, code: courses.code, title: courses.title })
    .from(courses)
    .limit(1);

  if (!course) {
    return (
      <EmptyState
        title="No course seeded"
        hint="Run npm run seed:curriculum to load the curriculum spine."
      />
    );
  }

  const report = await validateCurriculum(course.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Curriculum validation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {course.code} {course.title} · {report.passedCount} of {report.checks.length} checks
          passing.
        </p>
      </div>

      <div className="space-y-3">
        {report.checks.map((check) => (
          <Card key={check.id}>
            <CardHeader className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm">{check.label}</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">{check.question}</p>
              </div>
              <StatusBadge
                kind={
                  check.passed
                    ? "success"
                    : check.severity === "error"
                      ? "error"
                      : check.severity === "warning"
                        ? "warning"
                        : "info"
                }
                label={check.passed ? "pass" : check.severity}
              />
            </CardHeader>
            <CardBody className="space-y-2">
              <p className="text-xs text-muted-foreground">{check.detail}</p>
              {/*
                Offenders are named, not counted — "3 topics have no coverage"
                is not actionable; naming them is (FR-GOV-009).
              */}
              {check.offenders.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {check.offenders.map((offender) => (
                    <span
                      key={offender}
                      className="rounded border bg-secondary px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {offender}
                    </span>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
