import { currentStudentCourseOrNull } from "@/student/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { getAttemptHistory, getCloProgress, getTopicProgress } from "@/student/progress";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  MasteryMeter,
} from "@/components/ui/primitives";
import { bloomLabel, toPercent } from "@/lib/utils";

export const metadata = { title: "Progress · Student" };
export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const enrolment = await currentStudentCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="student" />;
  const { actor, course } = enrolment;

  const [clos, topics, attempts] = await Promise.all([
    getCloProgress(actor.id, course.id),
    getTopicProgress(actor.id, course.id),
    getAttemptHistory(actor.id, course.id, 10),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Your progress</h1>

      <Card>
        <CardHeader>
          <CardTitle>Learning outcomes</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {clos.map((clo) => (
            <div key={clo.cloId} className="space-y-1">
              <MasteryMeter
                value={clo.mastery}
                label={`${clo.code} · Bloom ${clo.bloomLevel} (${bloomLabel(clo.bloomLevel)})`}
              />
              <p className="text-xs text-muted-foreground">
                {clo.statement}
                {/* Sample size beside the figure — honesty rule 5. */}
                <span className="ml-1 font-medium">
                  ({clo.observations} question{clo.observations === 1 ? "" : "s"} answered)
                </span>
              </p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Topics</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Mastery by topic</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-2 pr-3 font-medium">Topic</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Week</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Mastery</th>
                  <th scope="col" className="pb-2 font-medium">Answered</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((topic) => (
                  <tr key={topic.topicId} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{topic.code}</span> {topic.title}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                      {topic.week}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.round(topic.mastery * 100)}%` }}
                          />
                        </div>
                        {/* Bar AND numeric percentage (design.md §12). */}
                        <span className="tabular-nums">{toPercent(topic.mastery)}</span>
                      </div>
                    </td>
                    <td className="py-2 tabular-nums text-muted-foreground">
                      {topic.observations}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Practice history</CardTitle>
        </CardHeader>
        <CardBody>
          {attempts.length === 0 ? (
            <EmptyState title="No practice runs yet" hint="Start one from the Practice tab." />
          ) : (
            <ul className="space-y-2">
              {attempts.map((attempt) => (
                <li
                  key={attempt.attemptId}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0"
                >
                  <span className="text-muted-foreground">
                    {attempt.startedAt.toLocaleDateString()}{" "}
                    {attempt.startedAt.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>
                    {attempt.itemsAnswered} answered
                    {attempt.score !== null && (
                      <span className="ml-2 font-medium tabular-nums">
                        {toPercent(attempt.score)} correct
                      </span>
                    )}
                    {attempt.terminationReason && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ended: {attempt.terminationReason}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
