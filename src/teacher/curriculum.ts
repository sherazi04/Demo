import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  chunks,
  cloPloMap,
  cloTopics,
  clos,
  courses,
  plos,
  questions,
  topicPrereqs,
  topics,
} from "@/db/schema";

/**
 * Curriculum inspection tools (FR-TCH-020..023).
 *
 * All read-only. The zero-coverage flagging is the point: a heatmap that only
 * shows what exists tells a teacher nothing about the gaps, and the gaps are
 * what determine whether generation can succeed for a given CLO and level.
 */

export interface CloPloMatrix {
  plos: Array<{ id: string; code: string; statement: string }>;
  clos: Array<{ id: string; code: string; statement: string; bloomLevel: number; weight: number }>;
  /** `cells[cloId][ploId]` = contribution strength 1–3, absent when unmapped. */
  cells: Record<string, Record<string, number>>;
  /** CLOs mapping to no PLO at all — a curriculum defect (FR-GOV-009). */
  unmappedCloIds: string[];
  /** PLOs this course contributes nothing to; informational, not a defect. */
  uncoveredPloIds: string[];
}

export async function getCloPloMatrix(courseId: string): Promise<CloPloMatrix> {
  const [course] = await db
    .select({ programId: courses.programId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  if (!course) throw new Error("course not found");

  const ploRows = await db
    .select({ id: plos.id, code: plos.code, statement: plos.statement })
    .from(plos)
    .where(eq(plos.programId, course.programId))
    .orderBy(asc(plos.ordinal));

  const cloRows = await db
    .select({
      id: clos.id,
      code: clos.code,
      statement: clos.statement,
      bloomLevel: clos.bloomLevel,
      weight: clos.weight,
    })
    .from(clos)
    .where(eq(clos.courseId, courseId))
    .orderBy(asc(clos.ordinal));

  const mappings = await db
    .select({ cloId: cloPloMap.cloId, ploId: cloPloMap.ploId, strength: cloPloMap.strength })
    .from(cloPloMap)
    .innerJoin(clos, eq(clos.id, cloPloMap.cloId))
    .where(eq(clos.courseId, courseId));

  const cells: Record<string, Record<string, number>> = {};
  for (const clo of cloRows) cells[clo.id] = {};
  for (const m of mappings) {
    const row = cells[m.cloId];
    if (row) row[m.ploId] = m.strength;
  }

  const mappedClos = new Set(mappings.map((m) => m.cloId));
  const coveredPlos = new Set(mappings.map((m) => m.ploId));

  return {
    plos: ploRows,
    clos: cloRows,
    cells,
    unmappedCloIds: cloRows.filter((c) => !mappedClos.has(c.id)).map((c) => c.id),
    uncoveredPloIds: ploRows.filter((p) => !coveredPlos.has(p.id)).map((p) => p.id),
  };
}

export interface CoverageCell {
  topicId: string;
  topicCode: string;
  topicTitle: string;
  week: number;
  /** chunk counts indexed by Bloom level 1–6. */
  counts: number[];
  total: number;
}

export interface CoverageHeatmap {
  cells: CoverageCell[];
  /** Topic × Bloom pairs with no material at all (FR-TCH-021). */
  zeroCoverage: Array<{ topicCode: string; topicTitle: string; bloomLevel: number }>;
  /** Topics with no indexed material whatsoever — the more serious gap. */
  emptyTopics: Array<{ topicCode: string; topicTitle: string }>;
  totalChunks: number;
}

/**
 * Corpus coverage as topic × Bloom chunk counts.
 *
 * Zero-coverage cells are computed explicitly rather than left as absent keys:
 * "no row" and "zero" render identically in a naive heatmap, and the whole
 * value of this view is making the empty cells conspicuous.
 */
export async function getCoverageHeatmap(courseId: string): Promise<CoverageHeatmap> {
  const topicRows = await db
    .select({ id: topics.id, code: topics.code, title: topics.title, week: topics.week })
    .from(topics)
    .where(eq(topics.courseId, courseId))
    .orderBy(asc(topics.ordinal));

  const counts = await db
    .select({
      topicId: chunks.topicId,
      bloomLevel: chunks.bloomLevel,
      count: sql<number>`count(*)::int`,
    })
    .from(chunks)
    .where(eq(chunks.courseId, courseId))
    .groupBy(chunks.topicId, chunks.bloomLevel);

  const byTopic = new Map<string, number[]>();
  for (const topic of topicRows) byTopic.set(topic.id, new Array<number>(6).fill(0));

  let totalChunks = 0;
  for (const row of counts) {
    if (!row.topicId || !row.bloomLevel) continue;
    const bucket = byTopic.get(row.topicId);
    if (!bucket) continue;
    bucket[row.bloomLevel - 1] = Number(row.count);
    totalChunks += Number(row.count);
  }

  const cells: CoverageCell[] = topicRows.map((topic) => {
    const counts = byTopic.get(topic.id) ?? new Array<number>(6).fill(0);
    return {
      topicId: topic.id,
      topicCode: topic.code,
      topicTitle: topic.title,
      week: topic.week,
      counts,
      total: counts.reduce((sum, n) => sum + n, 0),
    };
  });

  const zeroCoverage: CoverageHeatmap["zeroCoverage"] = [];
  for (const cell of cells) {
    for (let bloom = 1; bloom <= 6; bloom += 1) {
      if ((cell.counts[bloom - 1] ?? 0) === 0) {
        zeroCoverage.push({
          topicCode: cell.topicCode,
          topicTitle: cell.topicTitle,
          bloomLevel: bloom,
        });
      }
    }
  }

  return {
    cells,
    zeroCoverage,
    emptyTopics: cells
      .filter((c) => c.total === 0)
      .map((c) => ({ topicCode: c.topicCode, topicTitle: c.topicTitle })),
    totalChunks,
  };
}

export interface PrereqGraph {
  nodes: Array<{ id: string; code: string; title: string; week: number; ordinal: number }>;
  edges: Array<{ from: string; to: string }>;
}

/** Topic prerequisite graph for rendering (FR-TCH-022). Edges point prereq → dependent. */
export async function getPrereqGraph(courseId: string): Promise<PrereqGraph> {
  const nodes = await db
    .select({
      id: topics.id,
      code: topics.code,
      title: topics.title,
      week: topics.week,
      ordinal: topics.ordinal,
    })
    .from(topics)
    .where(eq(topics.courseId, courseId))
    .orderBy(asc(topics.ordinal));

  const rows = await db
    .select({ topicId: topicPrereqs.topicId, prereqTopicId: topicPrereqs.prereqTopicId })
    .from(topicPrereqs)
    .innerJoin(topics, eq(topics.id, topicPrereqs.topicId))
    .where(eq(topics.courseId, courseId));

  return {
    nodes,
    edges: rows.map((r) => ({ from: r.prereqTopicId, to: r.topicId })),
  };
}

export interface ItemBankCoverage {
  clos: Array<{ id: string; code: string; bloomLevel: number }>;
  /** `cells[cloId][bloom]` = approved item count. */
  cells: Record<string, Record<number, number>>;
  /** CLO × Bloom combinations at or below the ceiling with no approved item. */
  gaps: Array<{ cloCode: string; bloomLevel: number }>;
}

/**
 * Approved item count per CLO per Bloom level (FR-TCH-023).
 *
 * Gaps are only reported at or below each CLO's ceiling — a CLO capped at
 * Understand having no Analyse items is correct, not a gap.
 */
export async function getItemBankCoverage(courseId: string): Promise<ItemBankCoverage> {
  const cloRows = await db
    .select({ id: clos.id, code: clos.code, bloomLevel: clos.bloomLevel })
    .from(clos)
    .where(eq(clos.courseId, courseId))
    .orderBy(asc(clos.ordinal));

  const counts = await db
    .select({
      cloId: questions.cloId,
      bloomLevel: questions.targetBloom,
      count: sql<number>`count(*)::int`,
    })
    .from(questions)
    .where(sql`${questions.courseId} = ${courseId} AND ${questions.status} = 'approved'`)
    .groupBy(questions.cloId, questions.targetBloom);

  const cells: Record<string, Record<number, number>> = {};
  for (const clo of cloRows) cells[clo.id] = {};
  for (const row of counts) {
    const bucket = cells[row.cloId];
    if (bucket) bucket[row.bloomLevel] = Number(row.count);
  }

  const gaps: ItemBankCoverage["gaps"] = [];
  for (const clo of cloRows) {
    for (let bloom = 1; bloom <= clo.bloomLevel; bloom += 1) {
      if ((cells[clo.id]?.[bloom] ?? 0) === 0) {
        gaps.push({ cloCode: clo.code, bloomLevel: bloom });
      }
    }
  }

  return { clos: cloRows, cells, gaps };
}

/** Topics mapped to a CLO — used by the lecture and generate forms. */
export async function topicsForCourse(courseId: string) {
  return db
    .select({
      id: topics.id,
      code: topics.code,
      title: topics.title,
      week: topics.week,
      summary: topics.summary,
    })
    .from(topics)
    .where(eq(topics.courseId, courseId))
    .orderBy(asc(topics.ordinal));
}

/** CLO ids linked to a topic, for the curriculum views. */
export async function closForTopic(topicId: string) {
  return db
    .select({ id: clos.id, code: clos.code, bloomLevel: clos.bloomLevel })
    .from(cloTopics)
    .innerJoin(clos, eq(clos.id, cloTopics.cloId))
    .where(eq(cloTopics.topicId, topicId))
    .orderBy(asc(clos.ordinal));
}
