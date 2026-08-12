import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cloTopics,
  clos,
  learningPlans,
  misconceptionHits,
  misconceptions,
  topicMastery,
  topicPrereqs,
  topics,
} from "@/db/schema";
import type { PlanStep } from "@/db/schema/learning";
import { env } from "@/lib/env";

/**
 * Personalised learning plan (design.md §8.5, FR-STU-020..024).
 *
 * The ordering algorithm is pure (`buildPlanSteps`) so prerequisite hoisting is
 * testable without a database — getting it wrong silently produces a plan that
 * asks a student to learn quicksort before recursion, which is the failure R10
 * describes.
 */

export interface PlanInputTopic {
  id: string;
  code: string;
  title: string;
  ordinal: number;
  week: number;
  pKnown: number;
  /** Topic ids this topic depends on. */
  prereqIds: string[];
  cloCode: string | null;
  cloId: string | null;
  bloomLevel: number | null;
}

export interface PlanInputRemediation {
  misconceptionId: string;
  misconceptionCode: string;
  topicId: string;
  description: string;
  remediation: string;
  hits: number;
}

/**
 * Builds the ordered plan.
 *
 *   1. unmastered  = topics below the mastery threshold
 *   2. eligible    = unmastered whose prerequisites are all mastered
 *   3. blocked     = the rest
 *   4. order eligible by (course ordinal, then ascending mastery)
 *   5. hoist each blocked topic's unmastered prerequisites ahead of it
 *   6. pin active remediation steps at the head
 *   7. insert a milestone at each CLO boundary
 */
export function buildPlanSteps(
  allTopics: readonly PlanInputTopic[],
  remediations: readonly PlanInputRemediation[],
  masteryThreshold: number,
): PlanStep[] {
  const byId = new Map(allTopics.map((t) => [t.id, t]));
  const mastered = (id: string) => (byId.get(id)?.pKnown ?? 0) >= masteryThreshold;

  const unmastered = allTopics.filter((t) => t.pKnown < masteryThreshold);
  const unmasteredIds = new Set(unmastered.map((t) => t.id));

  const eligible = unmastered.filter((t) => t.prereqIds.every((id) => mastered(id)));
  const blocked = unmastered.filter((t) => !t.prereqIds.every((id) => mastered(id)));

  // Course order first, then least-known first within the same position — so a
  // student meets material in the sequence it was designed to be taught.
  const byOrdinalThenMastery = (a: PlanInputTopic, b: PlanInputTopic) =>
    a.ordinal !== b.ordinal ? a.ordinal - b.ordinal : a.pKnown - b.pKnown;

  const ordered: PlanInputTopic[] = [...eligible].sort(byOrdinalThenMastery);
  const placed = new Set(ordered.map((t) => t.id));

  /**
   * Hoisting: a blocked topic cannot appear before the prerequisites it is
   * blocked on. Depth-first so a chain (T29 needs T28 needs T26) is emitted
   * bottom-up, and `visiting` stops a corrupt cyclic edge set from recursing
   * forever — the seeder rejects cycles, but this must not hang if one slips in.
   */
  const visiting = new Set<string>();
  const hoist = (topic: PlanInputTopic): void => {
    if (placed.has(topic.id) || visiting.has(topic.id)) return;
    visiting.add(topic.id);

    for (const prereqId of topic.prereqIds) {
      if (!unmasteredIds.has(prereqId)) continue;
      const prereq = byId.get(prereqId);
      if (prereq) hoist(prereq);
    }

    visiting.delete(topic.id);
    if (!placed.has(topic.id)) {
      ordered.push(topic);
      placed.add(topic.id);
    }
  };

  for (const topic of [...blocked].sort(byOrdinalThenMastery)) hoist(topic);

  const steps: PlanStep[] = [];

  // Remediation first: a misconception hit repeatedly is actively producing
  // wrong answers, so it outranks new material (FR-STU-013).
  for (const remediation of [...remediations].sort((a, b) => b.hits - a.hits)) {
    steps.push({
      kind: "remediation",
      topicId: remediation.topicId,
      misconceptionId: remediation.misconceptionId,
      title: `Clear up: ${remediation.description}`,
      estimatedMinutes: 15,
    });
  }

  let lastCloCode: string | null = null;
  for (const topic of ordered) {
    // A milestone at each CLO boundary makes progress legible (FR-STU-024).
    if (topic.cloCode && topic.cloCode !== lastCloCode) {
      steps.push({
        kind: "milestone",
        cloId: topic.cloId ?? undefined,
        title: `${topic.cloCode} begins here`,
      });
      lastCloCode = topic.cloCode;
    }

    const blockedBy = topic.prereqIds.filter((id) => unmasteredIds.has(id));
    steps.push({
      kind: "topic",
      topicId: topic.id,
      cloId: topic.cloId ?? undefined,
      title: `${topic.code} · ${topic.title}`,
      bloomLevel: topic.bloomLevel ?? undefined,
      mastery: topic.pKnown,
      // Estimated effort scales with how far from mastery the student is.
      estimatedMinutes: Math.round(20 + (1 - topic.pKnown) * 25),
      blocked: blockedBy.length > 0,
      blockedBy: blockedBy
        .map((id) => byId.get(id)?.code)
        .filter((code): code is string => code !== undefined),
    });
  }

  return steps;
}

/** Loads state, rebuilds the plan, and persists it with the reason it changed. */
export async function regeneratePlan(
  studentId: string,
  courseId: string,
  reason: string,
): Promise<PlanStep[]> {
  const topicRows = await db
    .select({
      id: topics.id,
      code: topics.code,
      title: topics.title,
      ordinal: topics.ordinal,
      week: topics.week,
    })
    .from(topics)
    .where(eq(topics.courseId, courseId))
    .orderBy(topics.ordinal);

  const masteryRows = await db
    .select({ topicId: topicMastery.topicId, pKnown: topicMastery.pKnown })
    .from(topicMastery)
    .where(eq(topicMastery.studentId, studentId));
  const masteryByTopic = new Map(masteryRows.map((r) => [r.topicId, r.pKnown]));

  const prereqRows = await db
    .select({ topicId: topicPrereqs.topicId, prereqTopicId: topicPrereqs.prereqTopicId })
    .from(topicPrereqs)
    .innerJoin(topics, eq(topics.id, topicPrereqs.topicId))
    .where(eq(topics.courseId, courseId));

  const prereqsByTopic = new Map<string, string[]>();
  for (const row of prereqRows) {
    const list = prereqsByTopic.get(row.topicId) ?? [];
    list.push(row.prereqTopicId);
    prereqsByTopic.set(row.topicId, list);
  }

  // The primary CLO for each topic — the lowest-ordinal one it is assessed by.
  const cloRows = await db
    .select({
      topicId: cloTopics.topicId,
      cloId: clos.id,
      cloCode: clos.code,
      bloomLevel: clos.bloomLevel,
      ordinal: clos.ordinal,
    })
    .from(cloTopics)
    .innerJoin(clos, eq(clos.id, cloTopics.cloId))
    .where(eq(clos.courseId, courseId))
    .orderBy(clos.ordinal);

  const cloByTopic = new Map<string, { id: string; code: string; bloomLevel: number }>();
  for (const row of cloRows) {
    if (!cloByTopic.has(row.topicId)) {
      cloByTopic.set(row.topicId, {
        id: row.cloId,
        code: row.cloCode,
        bloomLevel: row.bloomLevel,
      });
    }
  }

  const inputs: PlanInputTopic[] = topicRows.map((topic) => {
    const clo = cloByTopic.get(topic.id);
    return {
      id: topic.id,
      code: topic.code,
      title: topic.title,
      ordinal: topic.ordinal,
      week: topic.week,
      pKnown: masteryByTopic.get(topic.id) ?? 0,
      prereqIds: prereqsByTopic.get(topic.id) ?? [],
      cloId: clo?.id ?? null,
      cloCode: clo?.code ?? null,
      bloomLevel: clo?.bloomLevel ?? null,
    };
  });

  // Active remediations: hit at least three times and not yet cleared (§8.4).
  const remediationRows = await db
    .select({
      misconceptionId: misconceptions.id,
      misconceptionCode: misconceptions.code,
      topicId: misconceptions.topicId,
      description: misconceptions.description,
      remediation: misconceptions.remediation,
      hits: misconceptionHits.count,
    })
    .from(misconceptionHits)
    .innerJoin(misconceptions, eq(misconceptions.id, misconceptionHits.misconceptionId))
    .innerJoin(topics, eq(topics.id, misconceptions.topicId))
    .where(
      and(
        eq(misconceptionHits.studentId, studentId),
        eq(topics.courseId, courseId),
      ),
    );

  const activeRemediations = remediationRows.filter((r) => r.hits >= 3);

  const steps = buildPlanSteps(inputs, activeRemediations, env.MASTERY_THRESHOLD);

  await db.insert(learningPlans).values({
    studentId,
    courseId,
    steps,
    // Recording WHY makes the reordering legible to the student rather than
    // mysterious (§8.5).
    reason,
  });

  return steps;
}

export async function getCurrentPlan(studentId: string, courseId: string) {
  const [row] = await db
    .select()
    .from(learningPlans)
    .where(and(eq(learningPlans.studentId, studentId), eq(learningPlans.courseId, courseId)))
    .orderBy(desc(learningPlans.generatedAt))
    .limit(1);
  return row ?? null;
}
