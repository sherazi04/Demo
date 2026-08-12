import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { topicsForCourse } from "@/teacher/curriculum";
import { LectureClient } from "./lecture-client";

export const metadata = { title: "Lecture · Teacher" };
export const dynamic = "force-dynamic";

export default async function LecturePage() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;
  const topics = await topicsForCourse(course.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Lecture co-pilot</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Produces a time-boxed session whose activities ascend Bloom&rsquo;s taxonomy, with at
          least one formative check and a citation for every segment. Both promises are
          asserted after generation, not assumed.
        </p>
      </div>

      <LectureClient
        courseId={course.id}
        topics={topics.map((t) => ({
          id: t.id,
          code: t.code,
          title: t.title,
          week: t.week,
        }))}
      />
    </div>
  );
}
