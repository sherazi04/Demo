import { sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { pgArray } from "@/lib/pg-array";
import { env } from "@/lib/env";

/**
 * The demo accounts, defined once so the seeder and the sign-in page cannot
 * disagree about who exists or what the password is.
 *
 * Offering these on the sign-in page is a deliberate trade. It is the
 * difference between someone opening the app and getting in, versus meeting a
 * wall with no sign-up link and no hint — and this system has no public
 * registration by design (FR-ADM-008), so there is no self-service way past it.
 *
 * The offer is withheld unless it is safe:
 *
 *   - never in production, whatever the database contains;
 *   - only for accounts that exist and are active, checked against the
 *     database on each render rather than hardcoded in the page.
 *
 * So deleting or suspending these accounts stops advertising them, with no code
 * change. Rotating their password is *not* detected — that would mean a bcrypt
 * comparison per account on every render — so a rotated password shows a button
 * that fails with the ordinary "not recognised" message. In a non-production
 * environment that is a benign outcome, and the alternative costs ~300ms of
 * hashing per account on a page load.
 */

/** Meets the 12-character policy. Shared with `scripts/seed-demo-accounts.ts`. */
export const DEMO_PASSWORD = "DemoPass!2025";

export interface DemoAccount {
  email: string;
  name: string;
  role: "student" | "teacher" | "admin";
  /** What this role is for, shown beside the button. */
  blurb: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "student@example.edu",
    name: "Sara Ahmed",
    role: "student",
    blurb: "Practice quiz, learning plan, progress",
  },
  {
    email: "teacher@example.edu",
    name: "Dr Amara Okafor",
    role: "teacher",
    blurb: "Item bank, cohort analytics, curriculum",
  },
];

export interface OfferedAccount extends DemoAccount {
  password: string;
}

/**
 * The demo accounts that may be offered right now. Empty in production, or when
 * the accounts are missing or suspended.
 */
export async function listOfferedDemoAccounts(): Promise<OfferedAccount[]> {
  if (env.NODE_ENV === "production") return [];

  const emails = DEMO_ACCOUNTS.map((a) => a.email.toLowerCase());

  let present: Set<string>;
  try {
    const rows = await db.execute<{ email: string }>(
      raw`SELECT ${users.email} AS email
          FROM ${users}
          WHERE lower(${users.email}) = ANY(${pgArray(emails)}::text[])
            AND ${users.status} = 'active'`,
    );
    present = new Set([...rows].map((r) => r.email.toLowerCase()));
  } catch {
    // The sign-in page must still render with no database reachable — someone
    // has to be able to see the page in order to work out why nothing works.
    return [];
  }

  return DEMO_ACCOUNTS.filter((a) => present.has(a.email.toLowerCase())).map((a) => ({
    ...a,
    password: DEMO_PASSWORD,
  }));
}
