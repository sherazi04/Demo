import { and, desc, eq, ilike, or, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { courses, enrollments, users } from "@/db/schema";
import { generateInviteToken, checkPasswordPolicy, hashPassword } from "@/auth/password";
import { append } from "@/governance/audit";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import type { AuthedUser } from "@/auth/guard";

/**
 * Administrator-driven account provisioning (FR-ADM-001..004).
 *
 * There is no function anywhere in this module that a non-admin can reach, and
 * none that creates an account without an acting administrator — that is the
 * mechanical form of "no self-registration" (FR-ADM-008).
 */

export const roleSchema = z.enum(["student", "teacher", "admin"]);

export const createUserSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  role: roleSchema,
  /** Coarse demographic bucket, readable only by the bias monitor (FR-GOV-012). */
  cohortTag: z.string().max(64).optional().nullable(),
  externalId: z.string().max(128).optional().nullable(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: roleSchema.optional(),
  cohortTag: z.string().max(64).nullable().optional(),
  externalId: z.string().max(128).nullable().optional(),
});

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export interface CreatedUser {
  id: string;
  email: string;
  name: string;
  role: z.infer<typeof roleSchema>;
  /** Returned once, to be handed to the user out of band. Never stored in plaintext. */
  inviteToken: string;
}

export async function createUser(
  actor: AuthedUser,
  input: CreateUserInput,
): Promise<CreatedUser> {
  const data = createUserSchema.parse(input);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(raw`lower(${users.email}) = lower(${data.email})`)
    .limit(1);
  if (existing) throw new ConflictError(`An account already exists for ${data.email}`);

  const inviteToken = generateInviteToken();
  const [row] = await db
    .insert(users)
    .values({
      email: data.email,
      name: data.name,
      role: data.role,
      cohortTag: data.cohortTag ?? null,
      externalId: data.externalId ?? null,
      // `invited` with a null password hash: the account cannot authenticate
      // until the user sets their own password on first login.
      status: "invited",
      passwordHash: null,
      inviteToken,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdBy: actor.id,
    })
    .returning();
  if (!row) throw new Error("failed to create user");

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "user.create",
    resourceType: "user",
    resourceId: row.id,
    payload: { role: row.role, status: row.status },
  });

  return { id: row.id, email: row.email, name: row.name, role: row.role, inviteToken };
}

export async function updateUser(
  actor: AuthedUser,
  userId: string,
  patch: z.infer<typeof updateUserSchema>,
): Promise<void> {
  const data = updateUserSchema.parse(patch);
  const [before] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!before) throw new NotFoundError("User");

  // Removing the last admin would lock everyone out of user management.
  if (before.role === "admin" && data.role && data.role !== "admin") {
    await assertNotLastAdmin(userId);
  }

  await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "user.update",
    resourceType: "user",
    resourceId: userId,
    // Before/after on the fields that changed — never the email or the hash.
    payload: {
      changed: Object.keys(data),
      roleBefore: before.role,
      roleAfter: data.role ?? before.role,
    },
  });
}

async function assertNotLastAdmin(userId: string): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  if (count <= 1) {
    const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (row?.role === "admin") {
      throw new ConflictError(
        "Refusing to remove the last active administrator — promote another admin first.",
      );
    }
  }
}

export async function setUserStatus(
  actor: AuthedUser,
  userId: string,
  status: "active" | "suspended",
): Promise<void> {
  const [before] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!before) throw new NotFoundError("User");

  if (status === "suspended") {
    if (userId === actor.id) {
      throw new ConflictError("You cannot suspend your own account.");
    }
    await assertNotLastAdmin(userId);
  }

  // Re-activating an account that never set a password returns it to `invited`,
  // not `active` — otherwise it would be an account with no way to log in and
  // no invite outstanding.
  const next = status === "active" && !before.passwordHash ? "invited" : status;

  await db.update(users).set({ status: next, updatedAt: new Date() }).where(eq(users.id, userId));

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: status === "suspended" ? "user.suspend" : "user.reactivate",
    resourceType: "user",
    resourceId: userId,
    payload: { statusBefore: before.status, statusAfter: next },
  });
}

/** Issues a fresh invite token, invalidating any previous one. */
export async function reissueInvite(actor: AuthedUser, userId: string): Promise<string> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new NotFoundError("User");

  const inviteToken = generateInviteToken();
  await db
    .update(users)
    .set({
      inviteToken,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      status: "invited",
      passwordHash: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "user.update",
    resourceType: "user",
    resourceId: userId,
    payload: { action: "invite_reissued" },
  });
  return inviteToken;
}

/**
 * First-login password set (FR-ADM-002). Consumes the invite token, so a leaked
 * link cannot be replayed after use.
 */
export async function setPasswordWithInvite(token: string, plain: string): Promise<void> {
  const policy = checkPasswordPolicy(plain);
  if (!policy.ok) throw new BadRequestError(policy.problems.join(" "));

  const [row] = await db.select().from(users).where(eq(users.inviteToken, token)).limit(1);
  if (!row) throw new BadRequestError("This invite link is not valid.");
  if (row.inviteExpiresAt && row.inviteExpiresAt.getTime() < Date.now()) {
    throw new BadRequestError("This invite link has expired. Ask an administrator to reissue it.");
  }
  if (row.status === "suspended") {
    throw new BadRequestError("This account is suspended.");
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(plain),
      status: "active",
      inviteToken: null,
      inviteExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, row.id));

  await append({
    actorId: row.id,
    actorRole: row.role,
    action: "auth.password.set",
    resourceType: "user",
    resourceId: row.id,
  });
}

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  role: "student" | "teacher" | "admin";
  status: "invited" | "active" | "suspended";
  isSynthetic: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export async function listUsers(options: {
  search?: string;
  role?: "student" | "teacher" | "admin";
  limit?: number;
  offset?: number;
}): Promise<UserListItem[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  const conditions = [];
  if (options.role) conditions.push(eq(users.role, options.role));
  if (options.search) {
    const pattern = `%${options.search}%`;
    conditions.push(or(ilike(users.email, pattern), ilike(users.name, pattern)));
  }

  // cohort_tag is deliberately absent from this projection — it is readable
  // only through the admin-guarded bias monitor (FR-GOV-012).
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      isSynthetic: users.isSynthetic,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(options.offset ?? 0);
}

export async function enrol(
  actor: AuthedUser,
  userId: string,
  courseId: string,
  role: "student" | "teacher",
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new NotFoundError("User");
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) throw new NotFoundError("Course");

  await db
    .insert(enrollments)
    .values({ userId, courseId, role })
    .onConflictDoUpdate({
      target: [enrollments.userId, enrollments.courseId],
      set: { role },
    });

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "enrollment.create",
    resourceType: "enrollment",
    resourceId: `${userId}:${courseId}`,
    payload: { role, courseCode: course.code },
  });
}

export async function unenrol(
  actor: AuthedUser,
  userId: string,
  courseId: string,
): Promise<void> {
  await db
    .delete(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));

  await append({
    actorId: actor.id,
    actorRole: actor.role,
    action: "enrollment.delete",
    resourceType: "enrollment",
    resourceId: `${userId}:${courseId}`,
  });
}

export async function listCourseRoster(courseId: string) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: enrollments.role,
      status: users.status,
      isSynthetic: users.isSynthetic,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(eq(enrollments.courseId, courseId))
    .orderBy(users.name);
}
