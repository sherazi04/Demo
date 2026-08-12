import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { enrollments, users } from "@/db/schema";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { appendSafe } from "@/governance/audit";
import { auth, type AppRole } from "./config";

/**
 * The single server-side authorization point (NFR-SEC-002, FR-GOV-007).
 *
 * Every route handler, server action, and data-touching server component calls
 * one of these before reading anything. Hiding a link in the UI is presentation,
 * never enforcement — there is no client-side branch anywhere in this codebase
 * that is load-bearing for access control.
 *
 * Every denial is written to the audit log with the resource that was attempted
 * (FR-GOV-008), which is what makes an attempted cross-role access visible in
 * the admin panel rather than merely blocked.
 */

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  status: "invited" | "active" | "suspended";
}

const ROLE_RANK: Record<AppRole, number> = { student: 0, teacher: 1, admin: 2 };

/**
 * Records the denial and returns the error to throw.
 *
 * Returns rather than throws so call sites read `throw await denied(...)`,
 * which TypeScript understands as terminating control flow — an `async`
 * function typed `Promise<never>` does not narrow on `await` alone.
 */
async function denied(
  user: AuthedUser | null,
  resourceType: string,
  resourceId: string | null,
  reason: string,
): Promise<ForbiddenError> {
  await appendSafe({
    actorId: user?.id ?? null,
    actorRole: user?.role ?? null,
    action: "rbac.denied",
    resourceType,
    resourceId,
    outcome: "error",
    payload: { reason, attemptedResource: `${resourceType}:${resourceId ?? "*"}` },
  });
  return new ForbiddenError(`Not authorised for ${resourceType}`);
}

/** Authenticated, non-suspended session. Throws 401 otherwise. */
export async function requireUser(): Promise<AuthedUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new UnauthorizedError();

  // Re-read from the database rather than trusting the JWT: a role change or a
  // suspension must take effect immediately, not when the 8-hour token expires.
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new UnauthorizedError("Account no longer exists");

  const user: AuthedUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
  };

  if (row.status === "suspended") {
    throw await denied(user, "session", row.id, "account_suspended");
  }
  return user;
}

/** Requires at least the given role. `admin` satisfies `teacher`. */
export async function requireRole(minimum: AppRole): Promise<AuthedUser> {
  const user = await requireUser();
  if (ROLE_RANK[user.role] < ROLE_RANK[minimum]) {
    throw await denied(user, "role", minimum, `requires_${minimum}`);
  }
  return user;
}

/**
 * Requires enrolment in the course with at least `minRole`.
 *
 * Admins pass without an enrolment row — they administer every course — but a
 * teacher may only reach courses they are actually assigned to.
 */
export async function requireCourseAccess(
  courseId: string,
  minRole: AppRole = "student",
): Promise<AuthedUser> {
  const user = await requireUser();
  if (user.role === "admin") return user;

  if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
    throw await denied(user, "course", courseId, `requires_${minRole}`);
  }

  const [enrolment] = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.userId, user.id), eq(enrollments.courseId, courseId)))
    .limit(1);

  if (!enrolment) {
    throw await denied(user, "course", courseId, "not_enrolled");
  }
  if (ROLE_RANK[enrolment.role] < ROLE_RANK[minRole]) {
    throw await denied(user, "course", courseId, `enrolled_as_${enrolment.role}`);
  }
  return user;
}

/**
 * A student may reach only their own rows (FR-STU-042). Teachers and admins are
 * allowed through for cohort analytics — the bias monitor's `cohort_tag` is
 * guarded separately and more strictly (FR-GOV-012).
 */
export async function requireSelf(studentId: string): Promise<AuthedUser> {
  const user = await requireUser();
  if (user.id === studentId) return user;
  if (user.role === "teacher" || user.role === "admin") return user;
  throw await denied(user, "student", studentId, "cross_student_access");
}

/** Strictly the named student — used where even a teacher must not read. */
export async function requireExactSelf(studentId: string): Promise<AuthedUser> {
  const user = await requireUser();
  if (user.id !== studentId) {
    throw await denied(user, "student", studentId, "cross_student_access");
  }
  return user;
}

/**
 * Non-throwing variant for server components that render a "you don't have
 * access" panel rather than a 403 page. Still audits the denial.
 */
export async function tryRequireRole(minimum: AppRole): Promise<AuthedUser | null> {
  try {
    return await requireRole(minimum);
  } catch {
    return null;
  }
}
