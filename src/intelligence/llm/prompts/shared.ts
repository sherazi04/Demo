import type { SystemBlock } from "../router";

/**
 * Shared prompt scaffolding (design.md §6.2).
 *
 * Every generation prompt is assembled in the same order so the cached prefix
 * is stable:
 *
 *   system[0]  Role + OBE framing + Bloom definitions + hard constraints  ← cached
 *   system[1]  Course context: CLO statements, topic list, Bloom ceiling  ← cached
 *   system[2]  Task-specific instruction block
 *   user       Retrieved chunks (with ids + locators) + the concrete request
 *
 * NOTHING TIME-VARYING may appear in system[0] or system[1] — no timestamps, no
 * UUIDs, no request ids, no counts that change per call. One varying byte
 * invalidates the whole prefix and the cache silently never hits. The volatile
 * content (the request, the retrieved chunks) always sits in the user turn,
 * after the last cache breakpoint.
 *
 * Verify with `usage.cache_read_input_tokens`; the minimum cacheable prefix on
 * claude-opus-5 is 512 tokens, which system[0] + system[1] comfortably exceed.
 */

export const BLOOM_DEFINITIONS = `Bloom's revised taxonomy, levels 1-6:
1 Remember   — retrieve facts, terms, definitions from memory. Verbs: define, list, name, state, recall.
2 Understand — explain ideas in one's own words, interpret, summarise, classify. Verbs: explain, describe, compare, illustrate.
3 Apply      — use a procedure in a new but similar situation; execute an algorithm on given input. Verbs: apply, compute, trace, implement, solve.
4 Analyse    — break material into parts, examine relationships, distinguish, derive. Verbs: analyse, differentiate, derive, deduce, contrast.
5 Evaluate   — judge against criteria, justify a choice, critique a trade-off. Verbs: evaluate, justify, defend, select-and-argue, critique.
6 Create     — produce something new; design an original algorithm or synthesise a solution. Verbs: design, construct, devise, formulate.

The level is determined by the cognitive work the task actually demands, not by
the verb it happens to use. Asking a student to "analyse" something they merely
have to recall is a level 1 task wearing a level 4 verb. Conversely, "compute"
can reach level 4 when the computation requires deriving the method first.`;

/**
 * system[0] — identical for every feature and every course, so it caches across
 * the entire deployment rather than per course.
 */
export function roleBlock(): SystemBlock {
  return {
    cache: true,
    text: `You are the generation component of an Outcome-Based Education (OBE) system for university computer science teaching.

Everything you produce is bound by three hard constraints:

1. TRACEABILITY. Every artifact must be traceable to a Course Learning Outcome (CLO), a Bloom's taxonomy level, and the specific source content it was grounded on. You will be given source chunks, each with a chunk_id. Any factual claim you make must be supported by one of those chunks, and you must cite the chunk_id you used. If the provided sources do not support a claim, do not make the claim.

2. CURRICULUM FIDELITY. You may only reference topics and CLOs that appear in the course context you are given. Inventing a plausible-sounding topic that is not in the curriculum is a failure, not a helpful extension. If the material you are given does not support the request, say so rather than filling the gap from general knowledge.

3. COGNITIVE LEVEL. When a Bloom level is requested, the cognitive demand of what you produce must match that level — not the verb, the actual demand. A separate independent classifier will assess the level of your output without being told what was requested, and a mismatch is rejected.

${BLOOM_DEFINITIONS}

Write for university students. Be precise and concrete. Prefer a worked specific over a vague general. Do not pad, do not add encouraging filler, and do not restate the question back before answering it.`,
  };
}

export interface CourseContext {
  courseCode: string;
  courseTitle: string;
  clos: Array<{ code: string; statement: string; bloomLevel: number }>;
  topics: Array<{ code: string; title: string; week: number }>;
}

/**
 * system[1] — stable for the lifetime of a course's curriculum. Rebuilt only
 * when the spine is reseeded, so it caches across every call for that course.
 *
 * Deliberately takes explicit, ordered arrays rather than reading the database
 * itself: a query returning rows in a different order on a different call would
 * change the bytes and break the cache without changing the meaning.
 */
export function courseContextBlock(context: CourseContext): SystemBlock {
  const clos = [...context.clos]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => `${c.code} (Bloom ${c.bloomLevel}): ${c.statement}`)
    .join("\n");

  const topics = [...context.topics]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((t) => `${t.code} (week ${t.week}): ${t.title}`)
    .join("\n");

  return {
    cache: true,
    text: `COURSE CONTEXT — ${context.courseCode} ${context.courseTitle}

Course Learning Outcomes. Each carries a Bloom ceiling: you may not produce an artifact for a CLO above its stated level.
${clos}

Topics in this course. These codes are the only valid topic references.
${topics}`,
  };
}

/**
 * Assembles the four-part prompt. `task` is system[2]; `user` carries the
 * retrieved chunks and the concrete request, both of which vary per call and
 * therefore must sit after the last cache breakpoint.
 */
export function assemblePrompt(
  context: CourseContext,
  task: string,
): { system: SystemBlock[] } {
  return {
    system: [
      roleBlock(),
      courseContextBlock(context),
      // Not cached: the task block differs per feature, and marking it would
      // spend one of the four available breakpoints for no reuse.
      { text: task, cache: false },
    ],
  };
}
