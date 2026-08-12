import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userRole, userStatus } from "./enums";
import { courses } from "./curriculum";

/**
 * Accounts are provisioned by an administrator only — there is no
 * self-registration path anywhere in the system (FR-ADM-008).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // Null while status = 'invited'; set by the user on first login (FR-ADM-002).
    passwordHash: text("password_hash"),
    role: userRole("role").notNull().default("student"),
    status: userStatus("status").notNull().default("invited"),
    externalId: text("external_id"),
    /**
     * Coarse demographic bucket read ONLY by the bias monitor (FR-GOV-012).
     * No teacher- or student-facing query may join this column.
     */
    cohortTag: text("cohort_tag"),
    /** Marks accounts produced by scripts/seed-cohort.ts; surfaced in the UI (R9). */
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    inviteToken: text("invite_token"),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
    uniqueIndex("users_invite_token_unique").on(t.inviteToken),
    index("users_role_idx").on(t.role),
    index("users_cohort_tag_idx").on(t.cohortTag),
  ],
);

/** Per-course, per-role enrolment (FR-ADM-003). */
export const enrollments = pgTable(
  "enrollments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    role: userRole("role").notNull(),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.courseId] }),
    index("enrollments_course_idx").on(t.courseId, t.role),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  enrollments: many(enrollments),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  user: one(users, { fields: [enrollments.userId], references: [users.id] }),
  course: one(courses, { fields: [enrollments.courseId], references: [courses.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Enrollment = typeof enrollments.$inferSelect;
