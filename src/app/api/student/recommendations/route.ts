import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { topics } from "@/db/schema";
import { currentStudentCourse } from "@/student/context";
import { recommend } from "@/teacher/recommender";
import { bloomCap } from "@/student/adaptive";
import { env } from "@/lib/env";
import { json, route } from "@/lib/http";

/**
 * Study material filtered by the student's current topic, mastery band and
 * Bloom level (FR-STU-030, FR-STU-031).
 *
 * The Bloom cap is the same function the adaptive quiz uses, so what a student
 * is recommended to read and what they are asked cannot drift apart.
 */
export const GET = route(async () => {
  const { actor, course } = await currentStudentCourse();

  // Current topic: the least-mastered topic whose prerequisites are all
  // mastered — the same "eligible" rule the learning plan uses.
  const [current] = await db.execute<{ id: string; p_known: number }>(sql`
    SELECT t.id, COALESCE(tm.p_known, 0) AS p_known
    FROM topics t
    LEFT JOIN topic_mastery tm ON tm.topic_id = t.id AND tm.student_id = ${actor.id}
    WHERE t.course_id = ${course.id}
      AND COALESCE(tm.p_known, 0) < ${env.MASTERY_THRESHOLD}
      AND NOT EXISTS (
        SELECT 1
        FROM topic_prereqs tp
        LEFT JOIN topic_mastery ptm
          ON ptm.topic_id = tp.prereq_topic_id AND ptm.student_id = ${actor.id}
        WHERE tp.topic_id = t.id
          AND COALESCE(ptm.p_known, 0) < ${env.MASTERY_THRESHOLD}
      )
    ORDER BY COALESCE(tm.p_known, 0) ASC, t.ordinal ASC
    LIMIT 1
  `);

  if (!current) {
    return json({
      recommendations: [],
      note: "Nothing to recommend: every topic with satisfied prerequisites is already at the mastery threshold.",
    });
  }

  const pKnown = Number(current.p_known);
  // Readiness gate (FR-STU-031): material above the level this student's
  // mastery supports is excluded rather than merely ranked lower.
  const cap = bloomCap(pKnown, 6);

  const recommendations = await recommend({
    courseId: course.id,
    topicIds: [current.id],
    bloomLevel: cap,
    // Slightly above current mastery, mirroring desirable difficulty.
    difficultyBand: [Math.max(0, pKnown - 0.15), Math.min(1, pKnown + 0.3)],
    limit: 8,
  });

  const [topic] = await db
    .select({ code: topics.code, title: topics.title })
    .from(topics)
    .where(eq(topics.id, current.id))
    .limit(1);

  return json({
    currentTopic: topic ? { ...topic, mastery: pKnown } : null,
    bloomCap: cap,
    recommendations,
  });
});
