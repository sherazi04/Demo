import { handlers } from "@/auth/config";

/**
 * Auth.js sign-in / sign-out / session endpoints.
 *
 * Only the Credentials provider is registered, and it never creates an account —
 * `authorize` returns null for an unknown email rather than provisioning one.
 * There is no registration route anywhere under /api (FR-ADM-008).
 */
export const { GET, POST } = handlers;
