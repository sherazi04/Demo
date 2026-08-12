import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { AuditClient } from "./audit-client";

export const metadata = { title: "Audit · Admin" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requireRole("admin");

  const records = await db
    .select({
      seq: auditLog.seq,
      createdAt: auditLog.createdAt,
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
      latencyMs: auditLog.latencyMs,
      outcome: auditLog.outcome,
      correlationId: auditLog.correlationId,
      hash: auditLog.hash,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .orderBy(desc(auditLog.seq))
    .limit(100);

  const [totals] = await db
    .select({
      records: sql<number>`count(*)::int`,
      inputTokens: sql<number>`COALESCE(sum(${auditLog.inputTokens}), 0)::int`,
      outputTokens: sql<number>`COALESCE(sum(${auditLog.outputTokens}), 0)::int`,
      refusals: sql<number>`count(*) FILTER (WHERE ${auditLog.outcome} = 'refusal')::int`,
      errors: sql<number>`count(*) FILTER (WHERE ${auditLog.outcome} = 'error')::int`,
    })
    .from(auditLog);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only and hash-chained. Every AI invocation and every human approval, rejection
          and release is recorded here with the model, the prompt hash and the exact chunks the
          call was given.
        </p>
      </div>

      <AuditClient
        initialRecords={records.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        }))}
        totals={
          totals ?? { records: 0, inputTokens: 0, outputTokens: 0, refusals: 0, errors: 0 }
        }
      />
    </div>
  );
}
