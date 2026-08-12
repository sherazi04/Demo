import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { listMaterials } from "@/teacher/materials";
import { MaterialsClient } from "./materials-client";

export const metadata = { title: "Materials · Teacher" };
// Ingestion state changes constantly; a cached render would show stale stages.
export const dynamic = "force-dynamic";

export default async function MaterialsPage() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;
  const materials = await listMaterials(course.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Course material</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload material for {course.code}. Each upload runs a six-stage pipeline; newly
          indexed content becomes retrievable immediately, with no restart.
        </p>
      </div>

      <MaterialsClient
        courseId={course.id}
        initialMaterials={materials.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          indexedAt: m.indexedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
