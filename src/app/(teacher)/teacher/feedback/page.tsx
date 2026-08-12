import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { feedbackQueue } from "@/teacher/coteacher";
import { FeedbackClient } from "./feedback-client";

export const metadata = { title: "Feedback · Teacher" };
export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;
  const queue = await feedbackQueue(course.id, 30);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI co-teacher</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Draft feedback on short-answer responses. Nothing here reaches a student until you
          edit it and release it explicitly — there is no auto-send path.
        </p>
      </div>

      <FeedbackClient
        items={queue.map((row) => ({
          attemptItemId: row.attemptItemId,
          stem: row.stem,
          response: row.response,
          correct: row.correct,
          referenceAnswer: row.referenceAnswer,
          rubric: row.rubric,
          answeredAt: row.answeredAt?.toISOString() ?? null,
          feedback: row.feedback as Record<string, unknown> | null,
        }))}
      />
    </div>
  );
}
