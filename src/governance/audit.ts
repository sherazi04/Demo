import { asc, desc, gt, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { auditHash } from "@/lib/hash";
import { logger } from "@/lib/logger";
import { chainSeed, verifyRows, type ChainRow, type ChainVerification } from "./chain";

/**
 * Append-only, hash-chained audit log (FR-GOV-001..006, design.md §10.2).
 *
 * Never pass raw prompts, free-text student answers, or any PII into `payload`
 * — hashes and identifiers only (NFR-SEC-006).
 */

export type AuditAction =
  // AI invocations
  | "llm.call"
  | "chunk.tag"
  | "question.generate"
  | "lecture.generate"
  | "feedback.generate"
  | "coteacher.draft"
  | "validation.run"
  // Human decisions
  | "question.approve"
  | "question.reject"
  | "question.edit"
  | "chunk.tag.verify"
  | "coteacher.release"
  | "assessment.publish"
  // Administration
  | "config.update"
  | "user.create"
  | "user.update"
  | "user.suspend"
  | "user.reactivate"
  | "enrollment.create"
  | "enrollment.delete"
  | "material.upload"
  | "material.delete"
  // Access control
  | "rbac.denied"
  | "auth.login"
  | "auth.login.failed"
  | "auth.password.set";

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: "student" | "teacher" | "admin" | null;
  action: AuditAction;
  resourceType?: string | null;
  resourceId?: string | null;
  model?: string | null;
  effort?: string | null;
  promptHash?: string | null;
  retrievedChunkIds?: string[] | null;
  outputHash?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  latencyMs?: number | null;
  outcome?: "ok" | "refusal" | "error";
  payload?: Record<string, unknown> | null;
  correlationId?: string | null;
}

/**
 * A 63-bit key for `pg_advisory_xact_lock`, constant for this table.
 * Arbitrary but must never change, or two deploys could append concurrently.
 */
const AUDIT_LOCK_KEY = 8_312_004_771_003_119n;

/**
 * Appends one record, computing its chain link inside a transaction.
 *
 * The design specifies `SELECT ... ORDER BY seq DESC LIMIT 1 FOR UPDATE`, which
 * serialises appends only when a row already exists — on an empty table there
 * is nothing to lock and two concurrent first-appends would both chain from the
 * seed. A transaction-scoped advisory lock closes that gap and is released
 * automatically at commit or rollback.
 */
export async function append(entry: AuditEntry): Promise<{ seq: number; hash: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(raw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);

    const [previous] = await tx
      .select({ seq: auditLog.seq, hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1)
      .for("update");

    const seq = (previous?.seq ?? 0) + 1;
    const prevHash = previous?.hash ?? chainSeed();
    // Generated here rather than by the column default so the value hashed is
    // provably the value stored.
    const createdAt = new Date();

    const hash = auditHash({
      prevHash,
      seq,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceId: entry.resourceId ?? null,
      model: entry.model ?? null,
      promptHash: entry.promptHash ?? null,
      outputHash: entry.outputHash ?? null,
      createdAtIso: createdAt.toISOString(),
    });

    await tx.insert(auditLog).values({
      seq,
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      model: entry.model ?? null,
      effort: entry.effort ?? null,
      promptHash: entry.promptHash ?? null,
      retrievedChunkIds: entry.retrievedChunkIds ?? null,
      outputHash: entry.outputHash ?? null,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      cacheReadTokens: entry.cacheReadTokens ?? null,
      cacheWriteTokens: entry.cacheWriteTokens ?? null,
      latencyMs: entry.latencyMs ?? null,
      outcome: entry.outcome ?? "ok",
      payload: entry.payload ?? null,
      correlationId: entry.correlationId ?? null,
      prevHash,
      hash,
      createdAt,
    });

    return { seq, hash };
  });
}

/**
 * Best-effort append for paths that must not fail because auditing failed —
 * notably the RBAC guard, where throwing would convert a 403 into a 500 and
 * hand the caller a less informative answer. The failure is logged loudly.
 */
export async function appendSafe(entry: AuditEntry): Promise<void> {
  try {
    await append(entry);
  } catch (error: unknown) {
    logger.error("audit append failed", {
      action: entry.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Streams the whole log in `seq` order and re-derives every link (FR-GOV-005).
 * Paged so a large log does not have to be materialised in memory at once.
 */
export async function verifyChain(pageSize = 1000): Promise<ChainVerification> {
  let afterSeq = 0;
  let previousHash = chainSeed();
  let previousSeq: number | null = null;
  let checked = 0;

  for (;;) {
    const page = await db
      .select({
        seq: auditLog.seq,
        actorId: auditLog.actorId,
        action: auditLog.action,
        resourceId: auditLog.resourceId,
        model: auditLog.model,
        promptHash: auditLog.promptHash,
        outputHash: auditLog.outputHash,
        createdAt: auditLog.createdAt,
        prevHash: auditLog.prevHash,
        hash: auditLog.hash,
      })
      .from(auditLog)
      .where(gt(auditLog.seq, afterSeq))
      .orderBy(asc(auditLog.seq))
      .limit(pageSize);

    if (page.length === 0) break;

    const rows: ChainRow[] = page;
    // Carry the previous page's tail hash *and* its next expected seq across the
    // boundary, so neither an edited field nor a deleted row can hide there.
    const result = verifyRows(
      rows,
      previousHash,
      previousSeq === null ? undefined : previousSeq + 1,
    );
    if (!result.ok) {
      return { ...result, checked: checked + result.checked };
    }

    checked += result.checked;
    const last = page[page.length - 1];
    if (!last) break;
    previousHash = last.hash;
    previousSeq = last.seq;
    afterSeq = last.seq;
    if (page.length < pageSize) break;
  }

  return { ok: true, checked };
}

export { verifyRows } from "./chain";
export type { ChainVerification } from "./chain";
