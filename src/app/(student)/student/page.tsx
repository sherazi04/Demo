import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { currentStudentCourseOrNull } from "@/student/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { getCurrentPlan, regeneratePlan } from "@/student/learning-plan";
import { getCloProgress } from "@/student/progress";
import { getStreak, listBadges, pointsBalance } from "@/student/gamification";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  MasteryMeter,
  SyntheticBadge,
} from "@/components/ui/primitives";
import { bloomLabel } from "@/lib/utils";

export const metadata = { title: "Today · Student" };
export const dynamic = "force-dynamic";

export default async function StudentDashboard() {
  const enrolment = await currentStudentCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="student" />;
  const { actor, course } = enrolment;

  let plan = await getCurrentPlan(actor.id, course.id);
  if (!plan) {
    await regeneratePlan(actor.id, course.id, "initial plan");
    plan = await getCurrentPlan(actor.id, course.id);
  }

  const [clos, points, badges, streak, self] = await Promise.all([
    getCloProgress(actor.id, course.id),
    pointsBalance(actor.id),
    listBadges(actor.id),
    getStreak(actor.id),
    db
      .select({ isSynthetic: users.isSynthetic })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1),
  ]);

  // The first actionable step — not a milestone marker.
  const nextStep = (plan?.steps ?? []).find((s) => s.kind !== "milestone");
  const overall =
    clos.length > 0 ? clos.reduce((sum, c) => sum + c.mastery, 0) / clos.length : 0;
  const totalObservations = clos.reduce((sum, c) => sum + c.observations, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {course.code} {course.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back, {actor.name.split(" ")[0]}.
          </p>
        </div>
        {self[0]?.isSynthetic && <SyntheticBadge />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your next step</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {nextStep ? (
            <>
              <p className="text-sm font-medium">{nextStep.title}</p>
              {nextStep.bloomLevel && (
                <p className="text-xs text-muted-foreground">
                  Bloom {nextStep.bloomLevel} · {bloomLabel(nextStep.bloomLevel)}
                  {nextStep.estimatedMinutes ? ` · about ${nextStep.estimatedMinutes} minutes` : ""}
                </p>
              )}
              {nextStep.mastery !== undefined && (
                <MasteryMeter value={nextStep.mastery} label="Current mastery" />
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing outstanding — every topic you can reach is at the mastery threshold.
            </p>
          )}
          <div className="flex gap-2">
            <Link href="/student/quiz">
              <Button>Start practice</Button>
            </Link>
            <Link href="/student/plan">
              <Button variant="secondary">See the full plan</Button>
            </Link>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overall mastery</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <MasteryMeter value={overall} label="Mean across outcomes" />
            {/* Sample size beside the figure. */}
            <p className="text-xs text-muted-foreground">
              Based on {totalObservations} question{totalObservations === 1 ? "" : "s"} answered
              across {clos.length} outcomes.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Progress rewards</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p>
              <span className="text-2xl font-semibold tabular-nums">{points}</span>{" "}
              <span className="text-muted-foreground">points</span>
            </p>
            <p className="text-muted-foreground">
              Streak: {streak.current} day{streak.current === 1 ? "" : "s"}
              {streak.longest > streak.current ? ` (best ${streak.longest})` : ""}
            </p>
            {badges.length > 0 ? (
              <ul className="space-y-1">
                {badges.map((badge) => (
                  <li key={badge.code} className="text-xs">
                    <span className="font-medium">{badge.title}</span>{" "}
                    <span className="text-muted-foreground">— {badge.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No badges yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

