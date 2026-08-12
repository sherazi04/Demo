import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { biasSnapshots } from "@/db/schema";
import { env } from "@/lib/env";
import { requireRole } from "@/auth/guard";

/**
 * Fairness monitoring across cohort slices (FR-GOV-010..012).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `cohort_tag` IS READ ONLY HERE.
 *
 * Every exported function in this module calls `requireRole("admin")` itself
 * rather than trusting its caller. That is the mechanical form of FR-GOV-012:
 * demographic attributes are visible to the bias monitor and to admins, and to
 * nothing else. No teacher- or student-facing query joins `users.cohort_tag`,
 * and the admin user list deliberately omits it from its projection.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type BiasMetric =
  | "mean_mastery"
  | "item_accuracy"
  | "at_risk_rate"
  | "recommendation_bloom_mean";

export interface SliceMetric {
  sliceKey: string;
  metric: BiasMetric;
  value: number;
  cohortMean: number;
  /** Signed difference from the cohort mean. */
  deviation: number;
  flagged: boolean;
  /** Sample size — a slice of 2 students is not evidence of anything. */
  sampleSize: number;
}

export interface BiasReport {
  metrics: SliceMetric[];
  slices: Array<{ sliceKey: string; students: number }>;
  threshold: number;
  cohortSize: number;
  /** Slices too small for their numbers to mean anything. */
  underpoweredSlices: string[];
  computedAt: Date;
}

/** Below this, a slice's figures are reported but never flagged. */
const MIN_SLICE_SIZE = 5;

export async function computeBiasReport(courseId: string): Promise<BiasReport> {
  await requireRole("admin");

  const threshold = env.BIAS_DEVIATION_THRESHOLD;

  const rows = await db.execute<{
    slice_key: string;
    students: number;
    mean_mastery: number | null;
    item_accuracy: number | null;
    at_risk_rate: number | null;
  }>(sql`
    WITH roster AS (
      SELECT u.id,
             COALESCE(u.cohort_tag, 'unspecified') AS slice_key
      FROM enrollments e
      JOIN users u ON u.id = e.user_id
      WHERE e.course_id = ${courseId} AND e.role = 'student'
    ),
    mastery AS (
      SELECT r.slice_key, avg(cm.p_known) AS mean_mastery
      FROM roster r
      LEFT JOIN clo_mastery cm ON cm.student_id = r.id
      GROUP BY r.slice_key
    ),
    accuracy AS (
      SELECT r.slice_key,
             CASE WHEN count(ai.id) = 0 THEN NULL
                  ELSE count(*) FILTER (WHERE ai.correct)::real / count(ai.id)
             END AS item_accuracy
      FROM roster r
      LEFT JOIN attempts a ON a.student_id = r.id AND a.course_id = ${courseId}
      LEFT JOIN attempt_items ai ON ai.attempt_id = a.id AND ai.answered_at IS NOT NULL
      GROUP BY r.slice_key
    ),
    -- "At risk" here is the low-mastery rule only; the full rule set lives in
    -- the analytics module and needs per-student evaluation.
    at_risk AS (
      SELECT r.slice_key,
             count(*) FILTER (WHERE COALESCE(m.mean_known, 0) < 0.4)::real
               / NULLIF(count(*), 0) AS at_risk_rate
      FROM roster r
      LEFT JOIN (
        SELECT student_id, avg(p_known) AS mean_known
        FROM clo_mastery GROUP BY student_id
      ) m ON m.student_id = r.id
      GROUP BY r.slice_key
    )
    SELECT r.slice_key,
           count(DISTINCT r.id)::int AS students,
           max(mastery.mean_mastery)::real  AS mean_mastery,
           max(accuracy.item_accuracy)::real AS item_accuracy,
           max(at_risk.at_risk_rate)::real   AS at_risk_rate
    FROM roster r
    LEFT JOIN mastery  ON mastery.slice_key  = r.slice_key
    LEFT JOIN accuracy ON accuracy.slice_key = r.slice_key
    LEFT JOIN at_risk  ON at_risk.slice_key  = r.slice_key
    GROUP BY r.slice_key
    ORDER BY r.slice_key
  `);

  const slices = [...rows].map((row) => ({
    sliceKey: row.slice_key,
    students: Number(row.students),
    meanMastery: row.mean_mastery === null ? null : Number(row.mean_mastery),
    itemAccuracy: row.item_accuracy === null ? null : Number(row.item_accuracy),
    atRiskRate: row.at_risk_rate === null ? null : Number(row.at_risk_rate),
  }));

  const cohortSize = slices.reduce((sum, s) => sum + s.students, 0);
  const metrics: SliceMetric[] = [];

  const addMetric = (
    metric: BiasMetric,
    pick: (s: (typeof slices)[number]) => number | null,
    /** Rates use a multiplicative test; absolute values use a difference. */
    kind: "absolute" | "rate",
  ) => {
    const present = slices.filter((s) => pick(s) !== null);
    if (present.length === 0) return;

    const cohortMean =
      present.reduce((sum, s) => sum + (pick(s) ?? 0) * s.students, 0) /
      Math.max(
        present.reduce((sum, s) => sum + s.students, 0),
        1,
      );

    for (const slice of present) {
      const value = pick(slice) ?? 0;
      const deviation = value - cohortMean;

      // A slice below the minimum size is reported but never flagged: with
      // n = 2, a 0.3 deviation is noise, and flagging it would train the
      // reader to ignore the flags that matter.
      const meaningful = slice.students >= MIN_SLICE_SIZE;
      const flagged =
        meaningful &&
        (kind === "absolute"
          ? Math.abs(deviation) > threshold
          : cohortMean > 0 && (value / cohortMean > 1.5 || value / cohortMean < 1 / 1.5));

      metrics.push({
        sliceKey: slice.sliceKey,
        metric,
        value,
        cohortMean,
        deviation,
        flagged,
        sampleSize: slice.students,
      });
    }
  };

  addMetric("mean_mastery", (s) => s.meanMastery, "absolute");
  addMetric("item_accuracy", (s) => s.itemAccuracy, "absolute");
  addMetric("at_risk_rate", (s) => s.atRiskRate, "rate");

  const computedAt = new Date();

  // Persisted so drift over time is visible rather than only the current state.
  if (metrics.length > 0) {
    await db.insert(biasSnapshots).values(
      metrics.map((m) => ({
        computedAt,
        sliceKey: m.sliceKey,
        metric: m.metric,
        value: m.value,
        cohortMean: m.cohortMean,
        deviation: m.deviation,
        flagged: m.flagged,
        sampleSize: m.sampleSize,
      })),
    );
  }

  return {
    metrics,
    slices: slices.map((s) => ({ sliceKey: s.sliceKey, students: s.students })),
    threshold,
    cohortSize,
    underpoweredSlices: slices
      .filter((s) => s.students < MIN_SLICE_SIZE)
      .map((s) => s.sliceKey),
    computedAt,
  };
}

/** Historical snapshots, for the drift view. */
export async function getBiasHistory(limit = 200) {
  await requireRole("admin");
  return db
    .select()
    .from(biasSnapshots)
    .orderBy(sql`${biasSnapshots.computedAt} DESC`)
    .limit(limit);
}

export const METRIC_LABELS: Record<BiasMetric, { label: string; description: string }> = {
  mean_mastery: {
    label: "Mean CLO mastery",
    description: "Average mastery across all course learning outcomes.",
  },
  item_accuracy: {
    label: "Item accuracy",
    description: "Share of answered items that were correct.",
  },
  at_risk_rate: {
    label: "At-risk rate",
    description:
      "Share of students in the slice below 0.40 mean mastery. Rule-based, not a prediction.",
  },
  recommendation_bloom_mean: {
    label: "Mean recommended Bloom level",
    description: "Average cognitive level of recommended material.",
  },
};
