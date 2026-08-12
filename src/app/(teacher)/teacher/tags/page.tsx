import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { correctionOptions, getReviewQueue, queueStats } from "@/teacher/tag-review";
import { TagReviewClient } from "./tag-review-client";

export const metadata = { title: "Tag review · Teacher" };
export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;

  const [items, stats, options] = await Promise.all([
    getReviewQueue(course.id, { limit: 50 }),
    queueStats(course.id),
    correctionOptions(course.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">LOM tag review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lowest-confidence chunks first. Auto-tagging accuracy determines what every
          metadata-filtered query can find, so corrections here propagate to retrieval and to
          the knowledge graph.
        </p>
      </div>

      <TagReviewClient
        courseId={course.id}
        initialItems={items.map((item) => ({
          ...item,
          verifiedAt: item.verifiedAt?.toISOString() ?? null,
        }))}
        initialStats={stats}
        options={options}
      />
    </div>
  );
}
