import { createHash } from "node:crypto";

/** sha256 hex of a string or buffer. */
export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Canonical JSON: object keys sorted recursively, so semantically equal payloads
 * hash identically regardless of key insertion order. The audit chain and the
 * prompt hash both depend on this being stable across processes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
  return out;
}

export function hashJson(value: unknown): string {
  return sha256(canonicalJson(value));
}

/**
 * ASCII unit separator. It cannot occur in a UUID, an action slug, a model id,
 * a hex digest or an ISO timestamp, so the field concatenation is unambiguous —
 * plain concatenation would let two different field tuples share a pre-image.
 */
const FIELD_SEP = String.fromCharCode(0x1f);

export interface AuditHashParts {
  prevHash: string;
  seq: string | number | bigint;
  actorId: string | null;
  action: string;
  resourceId: string | null;
  model: string | null;
  promptHash: string | null;
  outputHash: string | null;
  createdAtIso: string;
}

/**
 * The audit chain link (design.md §4.6). Field order is fixed;
 * `verifyChain()` recomputes with exactly this function.
 */
export function auditHash(parts: AuditHashParts): string {
  const pre = [
    parts.prevHash,
    String(parts.seq),
    parts.actorId ?? "",
    parts.action,
    parts.resourceId ?? "",
    parts.model ?? "",
    parts.promptHash ?? "",
    parts.outputHash ?? "",
    parts.createdAtIso,
  ].join(FIELD_SEP);
  return sha256(pre);
}
