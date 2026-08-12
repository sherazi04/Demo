import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { json, route } from "@/lib/http";

const querySchema = z.object({
  action: z.string().max(80).optional(),
  actorId: z.string().uuid().optional(),
  outcome: z.enum(["ok", "refusal", "error"]).optional(),
  correlationId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Filterable audit log (FR-GOV-002). Read-only: there is no write path to this
 * table outside `audit.append()`, and the database trigger refuses UPDATE and
 * DELETE regardless.
 */
export const GET = route(async (request: Request) => {
  await requireRole("admin");

  const url = new URL(request.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams));

  const conditions: SQL[] = [];
  if (query.action) conditions.push(eq(auditLog.action, query.action));
  if (query.actorId) conditions.push(eq(auditLog.actorId, query.actorId));
  if (query.outcome) conditions.push(eq(auditLog.outcome, query.outcome));
  if (query.correlationId) conditions.push(eq(auditLog.correlationId, query.correlationId));

  const rows = await db
    .select({
      seq: auditLog.seq,
      createdAt: auditLog.createdAt,
      actorId: auditLog.actorId,
      actorName: users.name,
      actorRole: auditLog.actorRole,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      model: auditLog.model,
      effort: auditLog.effort,
      promptHash: auditLog.promptHash,
      retrievedChunkIds: auditLog.retrievedChunkIds,
      outputHash: auditLog.outputHash,
      inputTokens: auditLog.inputTokens,
      outputTokens: auditLog.outputTokens,
      cacheReadTokens: auditLog.cacheReadTokens,
      latencyMs: auditLog.latencyMs,
      outcome: auditLog.outcome,
      payload: auditLog.payload,
      correlationId: auditLog.correlationId,
      hash: auditLog.hash,
      prevHash: auditLog.prevHash,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.seq))
    .limit(query.limit ?? 100)
    .offset(query.offset ?? 0);

  const [totals] = await db
    .select({
      records: sql<number>`count(*)::int`,
      inputTokens: sql<number>`COALESCE(sum(${auditLog.inputTokens}), 0)::int`,
      outputTokens: sql<number>`COALESCE(sum(${auditLog.outputTokens}), 0)::int`,
      refusals: sql<number>`count(*) FILTER (WHERE ${auditLog.outcome} = 'refusal')::int`,
      errors: sql<number>`count(*) FILTER (WHERE ${auditLog.outcome} = 'error')::int`,
    })
    .from(auditLog);

  return json({ records: rows, totals });
});
