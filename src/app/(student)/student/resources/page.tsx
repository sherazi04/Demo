import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { currentStudentCourseOrNull } from "@/student/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { recommend } from "@/teacher/recommender";
import { bloomCap } from "@/student/adaptive";
import { env } from "@/lib/env";
import {
  AiGeneratedBadge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
} from "@/components/ui/primitives";
import { bloomLabel, formatCitation } from "@/lib/utils";

export const metadata = { title: "Resources · Student" };
export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const enrolment = await currentStudentCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="student" />;
  const { actor, course } = enrolment;

  // Same eligibility rule as the learning plan: the least-mastered topic whose
  // prerequisites are all met.
  const [current] = await db.execute<{ id: string; code: string; title: string; p_known: number }>(sql`
    SELECT t.id, t.code, t.title, COALESCE(tm.p_known, 0) AS p_known
    FROM topics t
    LEFT JOIN topic_mastery tm ON tm.topic_id = t.id AND tm.student_id = ${actor.id}
    WHERE t.course_id = ${course.id}
      AND COALESCE(tm.p_known, 0) < ${env.MASTERY_THRESHOLD}
      AND NOT EXISTS (
        SELECT 1 FROM topic_prereqs tp
        LEFT JOIN topic_mastery ptm
          ON ptm.topic_id = tp.prereq_topic_id AND ptm.student_id = ${actor.id}
        WHERE tp.topic_id = t.id
          AND COALESCE(ptm.p_known, 0) < ${env.MASTERY_THRESHOLD}
      )
    ORDER BY COALESCE(tm.p_known, 0) ASC, t.ordinal ASC
    LIMIT 1
  `);

  if (!current) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">Study material</h1>
        <EmptyState
          title="Nothing to recommend right now"
          hint="Every topic whose prerequisites you have met is already at the mastery threshold."
        />
      </div>
    );
  }

  const pKnown = Number(current.p_known);
  const cap = bloomCap(pKnown, 6);

  const recommendations = await recommend({
    courseId: course.id,
    topicIds: [current.id],
    bloomLevel: cap,
    difficultyBand: [Math.max(0, pKnown - 0.15), Math.min(1, pKnown + 0.3)],
    limit: 8,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Study material</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Filtered to <span className="font-medium">{current.code} {current.title}</span>, at or
          below Bloom {cap} ({bloomLabel(cap)}) — the level your current mastery supports.
        </p>
      </div>

      {recommendations.length === 0 ? (
        <EmptyState
          title="No material matches yet"
          hint="Your teacher has not uploaded material covering this topic at this level."
        />
      ) : (
        <ul className="space-y-3">
          {recommendations.map((item) => (
            <li key={item.chunkId}>
              <Card>
                <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm">{item.materialTitle}</CardTitle>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* LOM tags shown with every recommendation (FR-TCH-041). */}
                    {item.lomFormat && (
                      <StatusBadge kind="info" label={item.lomFormat.replace(/_/g, " ")} />
                    )}
                    {item.bloomLevel && (
                      <StatusBadge kind="info" label={`Bloom ${item.bloomLevel}`} />
                    )}
                    {item.verified && <StatusBadge kind="success" label="teacher-verified" />}
                    {!item.verified && <AiGeneratedBadge />}
                  </div>
                </CardHeader>
                <CardBody className="space-y-2">
                  <p className="text-sm leading-relaxed">{item.text.slice(0, 400)}
                    {item.text.length > 400 ? "…" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatCitation(item)}</p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
