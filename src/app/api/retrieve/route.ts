import { z } from "zod";
import { requireCourseAccess, requireRole } from "@/auth/guard";
import { retrieve } from "@/intelligence/retrieval";
import { retrievalFilterSchema, retrievalOptionsSchema } from "@/intelligence/retrieval/types";
import { json, route } from "@/lib/http";

const bodySchema = z.object({
  query: z.string().min(1).max(4000),
  filter: retrievalFilterSchema,
  options: retrievalOptionsSchema.optional(),
});

/**
 * Diagnostic retrieval endpoint (teacher/admin only).
 *
 * Exists so the pipeline is inspectable rather than a claim: it returns the
 * per-channel counts, the topics graph expansion reached, the timings, and each
 * result's LOM metadata and source locator. The eval harness drives this same
 * route, so what is measured is what the teacher engine actually calls.
 */
export const POST = route(async (request: Request) => {
  // Role first, input second: an unauthorised caller gets a flat 403 rather
  // than a 400 describing the parameter contract, and the refusal is audited.
  await requireRole("teacher");

  const body = bodySchema.parse(await request.json());

  // Teachers may only probe courses they teach; admins may probe any.
  await requireCourseAccess(body.filter.courseId, "teacher");

  const response = await retrieve(body.query, body.filter, body.options ?? {});

  return json({
    results: response.results.map((r) => ({
      chunkId: r.id,
      score: r.score,
      channels: r.channels,
      text: r.text,
      citation: {
        materialTitle: r.materialTitle,
        sectionPath: r.sectionPath,
        pageFrom: r.pageFrom,
        pageTo: r.pageTo,
      },
      lom: {
        topicId: r.topicId,
        topicCode: r.topicCode,
        topicTitle: r.topicTitle,
        cloIds: r.cloIds,
        bloomLevel: r.bloomLevel,
        difficulty: r.difficulty,
        lomFormat: r.lomFormat,
        resourceType: r.resourceType,
        tagConfidence: r.tagConfidence,
        verified: r.verified,
      },
    })),
    diagnostics: response.diagnostics,
  });
});
