import { randomUUID } from "node:crypto";

/** UUID v4. Database defaults use gen_random_uuid(); this is for values minted app-side. */
export function newId(): string {
  return randomUUID();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Correlation ID linking one user action to every downstream AI call
 * (NFR-OBS-003). Generated at the request boundary and threaded through.
 */
export function newCorrelationId(): string {
  return `cor_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
