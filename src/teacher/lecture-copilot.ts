import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { cloTopics, clos, misconceptions, topics } from "@/db/schema";
import { loadCourseContext } from "@/curriculum/context";
import { assemblePrompt } from "@/intelligence/llm/prompts/shared";
import {
  lecturePlanSchema,
  lectureTaskBlock,
  lectureUserBlock,
  type LecturePlan,
} from "@/intelligence/llm/prompts/lecture";
import { callStructured } from "@/intelligence/llm/router";
import { prerequisiteClosure } from "@/intelligence/kg/queries";
import { isReachable } from "@/intelligence/kg/driver";
import { retrieve } from "@/intelligence/retrieval";
import { NotFoundError } from "@/lib/errors";
import { newCorrelationId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import {
  assertPlan,
  BLOCKING_ASSERTIONS,
  type PlanAssertion,
} from "./lecture-assertions";
import type { AuthedUser } from "@/auth/guard";
import type { RetrievalResult } from "@/intelligence/retrieval/types";

/**
 * Lecture co-pilot (design.md §9.2).
 *
 * The post-generation assertions are the interesting part: a plan that is not
 * Bloom-ascending, or that contains no formative check, is regenerated ONCE
 * with the violation stated back to the model, and if it fails again the plan
 * is returned with a visible warning rather than silently accepted or silently
 * retried forever.
 */

// Re-exported so callers have one import site for the co-pilot.
export { assertPlan, type PlanAssertion } from "./lecture-assertions";

export const lectureRequestSchema = z.object({
  courseId: z.string().uuid(),
  topicId: z.string().uuid(),
  durationMinutes: z.number().int().min(20).max(240).default(90),
});

export type LectureRequestInput = z.infer<typeof lectureRequestSchema>;

export interface LecturePlanResult {
  plan: LecturePlan;
  assertions: PlanAssertion[];
  /** True when a regeneration was attempted. */
  regenerated: boolean;
  /** Set when assertions still fail after the retry — surfaced in the UI. */
  warning: string | null;
  citations: RetrievalResult[];
  model: string;
  correlationId: string;
}

export async function generateLecturePlan(
  actor: AuthedUser,
  input: LectureRequestInput,
): Promise<LecturePlanResult> {
  const correlationId = newCorrelationId();

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, input.topicId))
    .limit(1);
  if (!topic) throw new NotFoundError("Topic");

  // Prerequisite closure widens the retrieval: a session on quicksort should be
  // able to draw on the partitioning and recursion material it builds upon.
  let prerequisiteIds: string[] = [];
  if (await isReachable()) {
    try {
      prerequisiteIds = await prerequisiteClosure(topic.id, 2);
    } catch (error: unknown) {
      logger.warn("lecture: prerequisite closure unavailable", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const prerequisiteTopics =
    prerequisiteIds.length > 0
      ? await db
          .select({ id: topics.id, title: topics.title })
          .from(topics)
          .where(inArray(topics.id, prerequisiteIds))
      : [];

  const cloRows = await db
    .select({ code: clos.code, statement: clos.statement, bloomLevel: clos.bloomLevel })
    .from(cloTopics)
    .innerJoin(clos, eq(clos.id, cloTopics.cloId))
    .where(eq(cloTopics.topicId, topic.id))
    .orderBy(clos.ordinal);

  const misconceptionRows = await db
    .select({
      code: misconceptions.code,
      description: misconceptions.description,
      remediation: misconceptions.remediation,
    })
    .from(misconceptions)
    .where(eq(misconceptions.topicId, topic.id));

  const retrieval = await retrieve(
    `${topic.title}. ${topic.summary}`,
    {
      courseId: input.courseId,
      topicIds: [topic.id, ...prerequisiteIds],
    },
    { finalK: 12 },
  );

  const courseContext = await loadCourseContext(input.courseId);
  const { system } = assemblePrompt(courseContext, lectureTaskBlock());

  const buildUser = (correction?: string) =>
    lectureUserBlock({
      topicCode: topic.code,
      topicTitle: topic.title,
      topicSummary: topic.summary,
      durationMinutes: input.durationMinutes,
      clos: cloRows,
      prerequisiteTitles: prerequisiteTopics.map((t) => t.title),
      misconceptions: misconceptionRows,
      context: retrieval.results,
      ...(correction ? { correction } : {}),
    });

  const call = async (correction?: string) =>
    callStructured(lecturePlanSchema, {
      tier: "generation",
      system,
      user: buildUser(correction),
      // A full session plan is long; stream so it cannot hit an HTTP timeout.
      maxTokens: 32_000,
      auditAction: "lecture.generate",
      resourceType: "lecture_plan",
      resourceId: topic.id,
      retrievedChunkIds: retrieval.results.map((r) => r.id),
      correlationId,
      actorId: actor.id,
      actorRole: actor.role,
    });

  let response = await call();
  if (response.refused || !response.data) {
    throw new Error(
      response.refused
        ? `The model declined to produce a lecture plan: ${response.refusalReason ?? "no reason given"}`
        : "The model returned no usable lecture plan.",
    );
  }

  let plan = response.data;
  let assertions = assertPlan(plan, input.durationMinutes);
  let regenerated = false;

  const blockingFailures = () =>
    assertions.filter((a) => BLOCKING_ASSERTIONS.includes(a.name) && !a.passed);

  if (blockingFailures().length > 0) {
    // Exactly one retry (design.md §9.2). Retrying indefinitely would burn
    // tokens on a model that has already shown it cannot satisfy the shape.
    regenerated = true;
    const correction = blockingFailures()
      .map((a) => `- ${a.detail}`)
      .join("\n");

    logger.info("lecture plan failed assertions, regenerating once", {
      correlationId,
      failures: blockingFailures().map((a) => a.name),
    });

    const retry = await call(correction);
    if (!retry.refused && retry.data) {
      const retryAssertions = assertPlan(retry.data, input.durationMinutes);
      // Keep the retry only if it is genuinely better on the blocking checks.
      const before = blockingFailures().length;
      const after = retryAssertions.filter(
        (a) => BLOCKING_ASSERTIONS.includes(a.name) && !a.passed,
      ).length;
      if (after <= before) {
        plan = retry.data;
        assertions = retryAssertions;
        response = retry;
      }
    }
  }

  const stillFailing = assertions.filter((a) => BLOCKING_ASSERTIONS.includes(a.name) && !a.passed);

  return {
    plan,
    assertions,
    regenerated,
    warning:
      stillFailing.length > 0
        ? `This plan still violates ${stillFailing.length} structural requirement(s) after one regeneration: ${stillFailing
            .map((a) => a.name.replace(/_/g, " "))
            .join(", ")}. Review it before teaching from it.`
        : null,
    citations: retrieval.results,
    model: response.model,
    correlationId,
  };
}

/** Markdown export (FR-TCH-014). */
export function planToMarkdown(result: LecturePlanResult, topicTitle: string): string {
  const lines: string[] = [
    `# ${result.plan.title}`,
    "",
    `_Topic: ${topicTitle} · generated by ${result.model} · AI-generated, review before use_`,
    "",
    result.plan.framing,
    "",
  ];

  if (result.warning) {
    lines.push(`> **Warning:** ${result.warning}`, "");
  }

  for (const [index, segment] of result.plan.segments.entries()) {
    lines.push(
      `## ${index + 1}. ${segment.title}`,
      "",
      `**${segment.minutes} min · ${segment.activityType} · Bloom ${segment.bloomLevel} · ${segment.cloCode}**`,
      "",
      segment.content,
      "",
      `_Instructor notes:_ ${segment.instructorNotes}`,
      "",
      segment.citedChunkIds.length > 0
        ? `_Sources:_ ${segment.citedChunkIds.join(", ")}`
        : "_Sources: none cited_",
      "",
    );
  }

  if (result.plan.anticipatedMisconceptions.length > 0) {
    lines.push("## Anticipated misconceptions", "");
    for (const m of result.plan.anticipatedMisconceptions) lines.push(`- ${m}`);
    lines.push("");
  }

  return lines.join("\n");
}
