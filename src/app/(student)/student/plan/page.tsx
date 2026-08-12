import { currentStudentCourseOrNull } from "@/student/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { getCurrentPlan, regeneratePlan } from "@/student/learning-plan";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  MasteryMeter,
  StatusBadge,
} from "@/components/ui/primitives";
import { bloomLabel } from "@/lib/utils";

export const metadata = { title: "Plan · Student" };
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const enrolment = await currentStudentCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="student" />;
  const { actor, course } = enrolment;

  let plan = await getCurrentPlan(actor.id, course.id);
  if (!plan) {
    await regeneratePlan(actor.id, course.id, "initial plan");
    plan = await getCurrentPlan(actor.id, course.id);
  }

  const steps = plan?.steps ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your learning path</h1>
        {/*
          Saying WHY the plan looks like this is the point — a path that
          silently reorders is mysterious rather than motivating (§8.5).
        */}
        <p className="mt-1 text-sm text-muted-foreground">
          Last updated because: {plan?.reason ?? "initial plan"}.
        </p>
      </div>

      {steps.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          hint="Every topic whose prerequisites you have met is already at the mastery threshold."
        />
      ) : (
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={`${step.kind}-${step.topicId ?? step.cloId ?? index}`}>
              {step.kind === "milestone" ? (
                <div className="flex items-center gap-3 py-2">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {step.title}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : (
                <Card>
                  <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm">{step.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      {step.kind === "remediation" && (
                        <StatusBadge kind="warning" label="remediation" />
                      )}
                      {step.blocked && <StatusBadge kind="pending" label="blocked" />}
                      {step.bloomLevel && (
                        <span className="text-xs text-muted-foreground">
                          Bloom {step.bloomLevel} · {bloomLabel(step.bloomLevel)}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-2">
                    {step.mastery !== undefined && (
                      <MasteryMeter value={step.mastery} label="Current mastery" />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {step.estimatedMinutes ? `About ${step.estimatedMinutes} minutes. ` : ""}
                      {step.blocked && step.blockedBy && step.blockedBy.length > 0
                        ? `Blocked until you master ${step.blockedBy.join(", ")}.`
                        : ""}
                    </p>
                  </CardBody>
                </Card>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
