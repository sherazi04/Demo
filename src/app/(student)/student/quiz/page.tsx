import { currentStudentCourseOrNull } from "@/student/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { QuizClient } from "./quiz-client";

export const metadata = { title: "Practice · Student" };
export const dynamic = "force-dynamic";

export default async function QuizPage() {
  const enrolment = await currentStudentCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="student" />;
  const { course } = enrolment;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Adaptive practice</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions are chosen from your current mastery, one at a time.
        </p>
      </div>

      <QuizClient courseId={course.id} />
    </div>
  );
}
