import { curriculum, type Curriculum } from "@data/curriculum";
import { findCycle, type Edge } from "@/lib/graph";

/**
 * Structural validation of the declarative seed, run *before* any database
 * write (FR-INT-004). A cycle or a dangling code reference must abort the
 * seeder rather than land half a curriculum.
 */

export interface SeedProblem {
  kind:
    | "prereq_cycle"
    | "unknown_code"
    | "duplicate_code"
    | "missing_misconceptions"
    | "bloom_out_of_range"
    | "week_out_of_range"
    | "self_prereq";
  message: string;
  ids: string[];
}

export function validateSeed(data: Curriculum = curriculum): SeedProblem[] {
  const problems: SeedProblem[] = [];

  const topicCodes = new Set(data.topics.map((t) => t.code));
  const cloCodes = new Set(data.clos.map((c) => c.code));
  const ploCodes = new Set(data.plos.map((p) => p.code));

  const dupes = (codes: string[], label: string) => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const code of codes) {
      if (seen.has(code)) repeated.add(code);
      seen.add(code);
    }
    if (repeated.size > 0) {
      problems.push({
        kind: "duplicate_code",
        message: `Duplicate ${label} code(s)`,
        ids: [...repeated],
      });
    }
  };
  dupes(data.topics.map((t) => t.code), "topic");
  dupes(data.clos.map((c) => c.code), "CLO");
  dupes(data.plos.map((p) => p.code), "PLO");
  dupes(data.misconceptions.map((m) => m.code), "misconception");

  for (const clo of data.clos) {
    if (clo.bloomLevel < 1 || clo.bloomLevel > 6) {
      problems.push({
        kind: "bloom_out_of_range",
        message: `${clo.code} has Bloom level ${clo.bloomLevel}, expected 1–6`,
        ids: [clo.code],
      });
    }
  }

  for (const topic of data.topics) {
    if (topic.week < 1 || topic.week > data.course.weeks) {
      problems.push({
        kind: "week_out_of_range",
        message: `${topic.code} is assigned to week ${topic.week}, outside 1–${data.course.weeks}`,
        ids: [topic.code],
      });
    }
  }

  const unknown = (code: string, known: Set<string>, where: string, label: string) => {
    if (!known.has(code)) {
      problems.push({
        kind: "unknown_code",
        message: `${where} references unknown ${label} "${code}"`,
        ids: [code],
      });
    }
  };

  for (const link of data.cloPloMap) {
    unknown(link.clo, cloCodes, "cloPloMap", "CLO");
    unknown(link.plo, ploCodes, "cloPloMap", "PLO");
  }
  for (const link of data.cloTopics) {
    unknown(link.clo, cloCodes, "cloTopics", "CLO");
    unknown(link.topic, topicCodes, "cloTopics", "topic");
  }
  for (const m of data.misconceptions) {
    unknown(m.topic, topicCodes, "misconceptions", "topic");
  }
  for (const p of data.prereqs) {
    unknown(p.topic, topicCodes, "prereqs", "topic");
    unknown(p.prereq, topicCodes, "prereqs", "topic");
    if (p.topic === p.prereq) {
      problems.push({
        kind: "self_prereq",
        message: `${p.topic} lists itself as a prerequisite`,
        ids: [p.topic],
      });
    }
  }

  // FR-INT-006: at least two misconceptions per topic.
  const perTopic = new Map<string, number>();
  for (const m of data.misconceptions) {
    perTopic.set(m.topic, (perTopic.get(m.topic) ?? 0) + 1);
  }
  const thin = data.topics.filter((t) => (perTopic.get(t.code) ?? 0) < 2).map((t) => t.code);
  if (thin.length > 0) {
    problems.push({
      kind: "missing_misconceptions",
      message: `Topic(s) with fewer than 2 misconceptions`,
      ids: thin,
    });
  }

  // Edges point dependent → prerequisite, so a cycle here means topic A
  // transitively requires itself.
  const edges: Edge[] = data.prereqs.map((p) => ({ from: p.topic, to: p.prereq }));
  const cycle = findCycle([...topicCodes], edges);
  if (cycle) {
    problems.push({
      kind: "prereq_cycle",
      message: `Prerequisite cycle: ${cycle.join(" -> ")}`,
      ids: cycle,
    });
  }

  return problems;
}

export function formatProblems(problems: readonly SeedProblem[]): string {
  return problems
    .map((p) => `  [${p.kind}] ${p.message}${p.ids.length > 0 ? ` (${p.ids.join(", ")})` : ""}`)
    .join("\n");
}
