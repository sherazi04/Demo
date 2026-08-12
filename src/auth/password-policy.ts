/**
 * Password rules, deliberately free of any server-only import.
 *
 * The set-password form renders this client-side for live feedback; the
 * enforcement point is `setPasswordWithInvite`, which calls the same function
 * server-side. Keeping it in its own module stops bcrypt and the env schema
 * being pulled into the browser bundle.
 */

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

/**
 * Length does more for password strength than composition rules, which mostly
 * push users toward predictable substitutions — so this checks length and
 * obvious degenerate cases, and nothing else.
 */
export function checkPasswordPolicy(plain: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (plain.length < 12) problems.push("Must be at least 12 characters long.");
  if (plain.length > 200) problems.push("Must be at most 200 characters long.");
  if (/^\s|\s$/.test(plain)) problems.push("Must not start or end with whitespace.");
  if (/^(.)\1+$/.test(plain)) problems.push("Must not be a single repeated character.");
  return { ok: problems.length === 0, problems };
}
