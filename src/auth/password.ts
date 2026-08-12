import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Passwords are stored only as salted bcrypt hashes (FR-GOV-014).
 *
 * `bcryptjs` is used rather than the native `bcrypt` binding: it implements the
 * same algorithm and emits the same `$2a$`/`$2b$` hash format, with no node-gyp
 * toolchain requirement.
 */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Constant-time-ish dummy comparison for the "user not found" branch of login.
 * Returning immediately when no account exists leaks which emails are
 * registered through response timing, so the work is done regardless.
 */
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.7Zr5H0YQ1zJ0GmL1O9qXpQZ1w0K9xLa";

export async function burnPasswordCompare(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}

// Re-exported so server-side callers have one import for all password concerns.
export { checkPasswordPolicy, type PasswordPolicyResult } from "./password-policy";

/** URL-safe single-use invite token (FR-ADM-002). */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}
