import { auditHash } from "@/lib/hash";
import { env } from "@/lib/env";

/**
 * Pure hash-chain arithmetic (design.md §4.6). Separated from the database
 * layer in `audit.ts` so the chain rules are unit-testable without Postgres —
 * the tamper test depends on `verifyRows` reproducing exactly what `append`
 * computed.
 */

export interface ChainRow {
  seq: number;
  actorId: string | null;
  action: string;
  resourceId: string | null;
  model: string | null;
  promptHash: string | null;
  outputHash: string | null;
  createdAt: Date;
  prevHash: string;
  hash: string;
}

export function chainSeed(): string {
  return env.AUDIT_CHAIN_SEED;
}

/** Recomputes the hash a row *should* carry given its own field values. */
export function expectedHash(row: Omit<ChainRow, "hash">): string {
  return auditHash({
    prevHash: row.prevHash,
    seq: row.seq,
    actorId: row.actorId,
    action: row.action,
    resourceId: row.resourceId,
    model: row.model,
    promptHash: row.promptHash,
    outputHash: row.outputHash,
    createdAtIso: row.createdAt.toISOString(),
  });
}

export type ChainBreakReason = "hash_mismatch" | "prev_hash_mismatch" | "seq_gap";

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstBrokenSeq?: number;
  reason?: ChainBreakReason;
  detail?: string;
}

/**
 * Verifies rows presented in ascending `seq` order.
 *
 * Two independent checks per row, because they catch different attacks: the
 * recomputed hash catches an edited field, and the `prev_hash` linkage catches
 * a deleted or reordered row whose own hash is still internally consistent.
 */
export function verifyRows(
  rows: readonly ChainRow[],
  seed = chainSeed(),
  /**
   * The seq the first row must carry. Callers that verify in pages pass the
   * previous page's last seq + 1; without it a row deleted exactly on a page
   * boundary would escape the gap check.
   */
  expectedFirstSeq?: number,
): ChainVerification {
  let previousHash = seed;
  let previousSeq: number | null =
    expectedFirstSeq === undefined ? null : expectedFirstSeq - 1;
  let checked = 0;

  for (const row of rows) {
    if (previousSeq !== null && row.seq !== previousSeq + 1) {
      return {
        ok: false,
        checked,
        firstBrokenSeq: row.seq,
        reason: "seq_gap",
        detail: `expected seq ${previousSeq + 1}, found ${row.seq} — a record was removed`,
      };
    }

    if (row.prevHash !== previousHash) {
      return {
        ok: false,
        checked,
        firstBrokenSeq: row.seq,
        reason: "prev_hash_mismatch",
        detail: `prev_hash does not match the preceding record's hash`,
      };
    }

    const recomputed = expectedHash(row);
    if (recomputed !== row.hash) {
      return {
        ok: false,
        checked,
        firstBrokenSeq: row.seq,
        reason: "hash_mismatch",
        detail: `stored hash does not match the record's own contents — this row was altered`,
      };
    }

    previousHash = row.hash;
    previousSeq = row.seq;
    checked += 1;
  }

  return { ok: true, checked };
}
