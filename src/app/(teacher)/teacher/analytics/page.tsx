import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { AT_RISK_RULES, getCohortAnalytics } from "@/teacher/analytics";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  MasteryMeter,
  StatusBadge,
  SyntheticBadge,
} from "@/components/ui/primitives";
import { toPercent } from "@/lib/utils";

export const metadata = { title: "Analytics · Teacher" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;
  const analytics = await getCohortAnalytics(course.id);

  const flagged = analytics.students.filter((s) => s.firedRules.length > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Cohort analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {analytics.cohortSize} enrolled student{analytics.cohortSize === 1 ? "" : "s"}
          {analytics.syntheticCount > 0 && (
            <> · {analytics.syntheticCount} synthetic</>
          )}
        </p>
      </div>

      {analytics.cohortSize === 0 ? (
        <EmptyState
          title="No students enrolled"
          hint="An administrator can enrol students, or run npm run seed:cohort for a synthetic cohort."
        />
      ) : (
        <>
          {/*
            The rule set is stated before any flag is shown. These are explicit
            conditions, not a trained model — FR-TCH-034.
          */}
          <Card>
            <CardHeader>
              <CardTitle>At-risk rules</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="mb-3 text-xs text-muted-foreground">
                Flags below are produced by these rules. This is not a predictive model:
                there is no historical outcome data to train one on, and each flag shows
                the rule that fired and the evidence for it.
              </p>
              <dl className="space-y-1.5 text-xs">
                {AT_RISK_RULES.map((rule) => (
                  <div key={rule.id}>
                    <dt className="inline font-medium">{rule.label}: </dt>
                    <dd className="inline text-muted-foreground">{rule.condition}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Flagged students ({flagged.length} of {analytics.cohortSize})
              </CardTitle>
            </CardHeader>
            <CardBody>
              {flagged.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rules have fired.</p>
              ) : (
                <ul className="space-y-3">
                  {flagged.map((student) => (
                    <li key={student.studentId} className="rounded-md border p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {student.name}
                          {student.isSynthetic && <SyntheticBadge className="ml-2" />}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {student.itemsAnswered} answered · {toPercent(student.accuracy)}{" "}
                          correct · {student.activeDays} active day
                          {student.activeDays === 1 ? "" : "s"}
                        </span>
                      </div>

                      <MasteryMeter value={student.meanCloMastery} label="Mean CLO mastery" />

                      <ul className="mt-2 space-y-1.5">
                        {student.firedRules.map(({ rule, evidence }) => (
                          <li key={rule.id} className="flex flex-wrap items-start gap-2">
                            <StatusBadge kind="warning" label={rule.label} />
                            <span className="text-xs">
                              <span className="text-muted-foreground">{rule.condition}.</span>{" "}
                              <span className="font-medium">{evidence}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Mastery by outcome</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {analytics.cloMastery.map((clo) => (
                  <div key={clo.cloId}>
                    <MasteryMeter value={clo.meanMastery} label={clo.cloCode} />
                    {/* Sample size beside every figure. */}
                    <p className="text-xs text-muted-foreground">n = {clo.n}</p>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Most-triggered misconceptions</CardTitle>
              </CardHeader>
              <CardBody>
                {analytics.mostTriggeredMisconceptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {analytics.mostTriggeredMisconceptions.map((m) => (
                      <li key={m.code} className="border-b pb-2 last:border-0">
                        <p className="text-xs font-medium">
                          {m.code}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {m.totalHits} hit{m.totalHits === 1 ? "" : "s"} across{" "}
                            {m.studentsAffected} student
                            {m.studentsAffected === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                        <p className="mt-0.5 text-xs">
                          <span className="font-medium">Remediation:</span> {m.remediation}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Most-missed items</CardTitle>
            </CardHeader>
            <CardBody>
              {analytics.mostMissedItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No item has been served at least 5 times yet — below that, an accuracy
                  figure is noise rather than a signal.
                </p>
              ) : (
                <ul className="space-y-2">
                  {analytics.mostMissedItems.map((item) => (
                    <li key={item.questionId} className="border-b pb-2 text-xs last:border-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{item.cloCode}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {toPercent(item.accuracy)} correct · served {item.timesServed}×
                        </span>
                      </div>
                      <p className="mt-0.5 text-muted-foreground">{item.stem}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
