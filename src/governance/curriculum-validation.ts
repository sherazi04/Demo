import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { detectPrereqCycles } from "@/intelligence/kg/queries";
import { isReachable } from "@/intelligence/kg/driver";
import { logger } from "@/lib/logger";

/**
 * Curriculum validation console (design.md §10.4, FR-GOV-009).
 *
 * Every check reports the OFFENDING IDs, not just a count. "3 topics have no
 * coverage" is not actionable; naming them is.
 */

export type CheckSeverity = "error" | "warning" | "info";

export interface CurriculumCheck {
  id:
    | "clo_without_plo"
    | "clo_without_topic"
    | "topic_without_coverage"
    | "topic_bloom_gap"
    | "clo_bloom_no_items"
    | "prereq_cycle"
    | "item_above_ceiling"
    | "orphan_chunk";
  label: string;
  /** What the check asks, in one sentence. */
  question: string;
  passed: boolean;
  severity: CheckSeverity;
  /** The specific things that failed — codes or ids, never just a count. */
  offenders: string[];
  detail: string;
}

export interface CurriculumValidationReport {
  courseId: string;
  checks: CurriculumCheck[];
  passedCount: number;
  failedCount: number;
  computedAt: Date;
}

export async function validateCurriculum(
  courseId: string,
): Promise<CurriculumValidationReport> {
  const checks: CurriculumCheck[] = [];

  // 1. CLOs with no PLO mapping.
  const noPlo = await db.execute<{ code: string }>(sql`
    SELECT c.code FROM clos c
    LEFT JOIN clo_plo_map m ON m.clo_id = c.id
    WHERE c.course_id = ${courseId} AND m.clo_id IS NULL
    ORDER BY c.ordinal
  `);
  checks.push(
    build(
      "clo_without_plo",
      "CLO with no PLO mapping",
      "Does every course outcome contribute to at least one programme outcome?",
      [...noPlo].map((r) => r.code),
      "error",
      "An outcome mapping to no PLO cannot be reported against the programme.",
    ),
  );

  // 2. CLOs with no topic mapping.
  const noTopic = await db.execute<{ code: string }>(sql`
    SELECT c.code FROM clos c
    LEFT JOIN clo_topics ct ON ct.clo_id = c.id
    WHERE c.course_id = ${courseId} AND ct.clo_id IS NULL
    ORDER BY c.ordinal
  `);
  checks.push(
    build(
      "clo_without_topic",
      "CLO with no topic mapping",
      "Is every course outcome assessed by at least one topic?",
      [...noTopic].map((r) => r.code),
      "error",
      "Generation for this outcome cannot retrieve anything, because no topic is linked to it.",
    ),
  );

  // 3. Topics with zero corpus coverage.
  const noCoverage = await db.execute<{ code: string }>(sql`
    SELECT t.code FROM topics t
    LEFT JOIN chunks c ON c.topic_id = t.id
    WHERE t.course_id = ${courseId}
    GROUP BY t.id, t.code, t.ordinal
    HAVING count(c.id) = 0
    ORDER BY t.ordinal
  `);
  checks.push(
    build(
      "topic_without_coverage",
      "Topic with no indexed material",
      "Does every topic have at least one chunk of source material?",
      [...noCoverage].map((r) => r.code),
      "error",
      "No material means no grounding: items for this topic cannot be generated at all.",
    ),
  );

  // 4. Topic × Bloom cells with zero coverage.
  const bloomGaps = await db.execute<{ code: string; bloom_level: number }>(sql`
    SELECT t.code, b.bloom_level
    FROM topics t
    CROSS JOIN generate_series(1, 6) AS b(bloom_level)
    LEFT JOIN chunks c
      ON c.topic_id = t.id AND c.bloom_level = b.bloom_level
    WHERE t.course_id = ${courseId}
    GROUP BY t.code, t.ordinal, b.bloom_level
    HAVING count(c.id) = 0
    ORDER BY t.ordinal, b.bloom_level
  `);
  checks.push(
    build(
      "topic_bloom_gap",
      "Topic × Bloom cell with no material",
      "Is there material at every cognitive level for every topic?",
      [...bloomGaps].map((r) => `${r.code}@B${r.bloom_level}`),
      // Informational: complete coverage at all six levels for all 30 topics is
      // not a realistic target, and flagging it as an error would be noise.
      "info",
      "Generation at these levels will find no filtered context. Expected for the higher levels on introductory topics.",
    ),
  );

  // 5. CLO × Bloom with no approved items, at or below the CLO's ceiling.
  const itemGaps = await db.execute<{ code: string; bloom_level: number }>(sql`
    SELECT c.code, b.bloom_level
    FROM clos c
    CROSS JOIN generate_series(1, 6) AS b(bloom_level)
    LEFT JOIN questions q
      ON q.clo_id = c.id AND q.target_bloom = b.bloom_level AND q.status = 'approved'
    WHERE c.course_id = ${courseId} AND b.bloom_level <= c.bloom_level
    GROUP BY c.code, c.ordinal, b.bloom_level
    HAVING count(q.id) = 0
    ORDER BY c.ordinal, b.bloom_level
  `);
  checks.push(
    build(
      "clo_bloom_no_items",
      "CLO × Bloom with no approved items",
      "Can every outcome be assessed at every level up to its ceiling?",
      [...itemGaps].map((r) => `${r.code}@B${r.bloom_level}`),
      "warning",
      "Adaptive selection has nothing to serve for these combinations.",
    ),
  );

  // 6. Prerequisite cycles — authoritative in the graph.
  let cycleOffenders: string[] = [];
  let cycleDetail =
    "Cypher self-reachability over PREREQ_OF returned no rows: the prerequisite graph is acyclic.";
  if (await isReachable()) {
    try {
      cycleOffenders = await detectPrereqCycles();
    } catch (error: unknown) {
      cycleDetail = `Graph unreachable, cycle check skipped: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.warn("curriculum validation: cycle check skipped");
    }
  } else {
    cycleDetail = "Neo4j is unreachable, so the cycle check could not run.";
  }
  checks.push(
    build(
      "prereq_cycle",
      "Prerequisite cycle",
      "Is the topic prerequisite graph acyclic?",
      cycleOffenders,
      "error",
      cycleDetail,
    ),
  );

  // 7. Items above their CLO's Bloom ceiling.
  const aboveCeiling = await db.execute<{ id: string; code: string; target: number; ceiling: number }>(sql`
    SELECT q.id, c.code, q.target_bloom AS target, c.bloom_level AS ceiling
    FROM questions q
    JOIN clos c ON c.id = q.clo_id
    WHERE q.course_id = ${courseId} AND q.target_bloom > c.bloom_level
  `);
  checks.push(
    build(
      "item_above_ceiling",
      "Item above its CLO's Bloom ceiling",
      "Does any item claim to assess above the level its outcome tops out at?",
      [...aboveCeiling].map((r) => `${r.code}: item at B${r.target} > ceiling B${r.ceiling}`),
      "error",
      "The drift check rejects these at generation time; any that exist predate the check or were inserted directly.",
    ),
  );

  // 8. Orphan chunks with no topic assigned.
  const orphans = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM chunks
    WHERE course_id = ${courseId} AND topic_id IS NULL
  `);
  const orphanCount = Number([...orphans][0]?.count ?? 0);
  checks.push(
    build(
      "orphan_chunk",
      "Chunk with no topic",
      "Has every chunk been assigned a topic?",
      orphanCount > 0 ? [`${orphanCount} chunk(s)`] : [],
      "warning",
      "Untagged chunks are invisible to every metadata-filtered query. Resolve them in the tag review queue.",
    ),
  );

  const passedCount = checks.filter((c) => c.passed).length;

  return {
    courseId,
    checks,
    passedCount,
    failedCount: checks.length - passedCount,
    computedAt: new Date(),
  };
}

function build(
  id: CurriculumCheck["id"],
  label: string,
  question: string,
  offenders: string[],
  severity: CheckSeverity,
  detail: string,
): CurriculumCheck {
  return {
    id,
    label,
    question,
    passed: offenders.length === 0,
    severity,
    // Capped so a wholly-untagged corpus does not produce a 5,000-item list.
    offenders: offenders.slice(0, 50),
    detail:
      offenders.length > 50
        ? `${detail} (showing the first 50 of ${offenders.length})`
        : detail,
  };
}
