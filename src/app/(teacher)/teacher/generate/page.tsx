import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clos } from "@/db/schema";
import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { GenerateClient } from "./generate-client";

export const metadata = { title: "Generate · Teacher" };
export const dynamic = "force-dynamic";

export default async function GeneratePage() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;

  const cloRows = await db
    .select({
      id: clos.id,
      code: clos.code,
      statement: clos.statement,
      bloomLevel: clos.bloomLevel,
    })
    .from(clos)
    .where(eq(clos.courseId, course.id))
    .orderBy(asc(clos.ordinal));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Assessment generator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each item is generated separately with its own retrieval, filtered to that item&rsquo;s
          CLO and Bloom level, then validated by a separate judge. Items that fail are kept and
          shown with their reasons — they are not discarded.
        </p>
      </div>

      <GenerateClient courseId={course.id} clos={cloRows} />
    </div>
  );
}
