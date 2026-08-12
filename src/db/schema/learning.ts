import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clos, courses, misconceptions, topics } from "./curriculum";
import { questions } from "./assessment";

/** Per-(student, topic) BKT state (design.md §8.1). */
export const topicMastery = pgTable(
  "topic_mastery",
  {
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    pKnown: real("p_known").notNull().default(0.15),
    observations: integer("observations").notNull().default(0),
    lastCorrect: boolean("last_correct"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.topicId] }),
    check("topic_mastery_p_known_range", sql`${t.pKnown} BETWEEN 0 AND 1`),
    index("topic_mastery_topic_idx").on(t.topicId),
  ],
);

/** Derived: exposure-weighted mean of the CLO's constituent topic mastery (§8.1). */
export const cloMastery = pgTable(
  "clo_mastery",
  {
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cloId: uuid("clo_id")
      .notNull()
      .references(() => clos.id, { onDelete: "cascade" }),
    pKnown: real("p_known").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.cloId] }),
    check("clo_mastery_p_known_range", sql`${t.pKnown} BETWEEN 0 AND 1`),
  ],
);

export interface PlanStep {
  kind: "topic" | "remediation" | "milestone";
  topicId?: string;
  cloId?: string;
  misconceptionId?: string;
  title: string;
  bloomLevel?: number;
  mastery?: number;
  estimatedMinutes?: number;
  blocked?: boolean;
  blockedBy?: string[];
}

export const learningPlans = pgTable(
  "learning_plans",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    steps: jsonb("steps").$type<PlanStep[]>().notNull().default([]),
    /** Why this regeneration happened — what makes the reordering legible (§8.5). */
    reason: text("reason").notNull().default("initial"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("learning_plans_student_idx").on(t.studentId, t.generatedAt)],
);

export const misconceptionHits = pgTable(
  "misconception_hits",
  {
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    misconceptionId: uuid("misconception_id")
      .notNull()
      .references(() => misconceptions.id, { onDelete: "cascade" }),
    count: integer("count").notNull().default(0),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.misconceptionId] }),
    index("misconception_hits_misconception_idx").on(t.misconceptionId),
  ],
);

/**
 * Append-only points ledger (§8.6). The balance is always a SUM, never a mutable
 * counter, so the award history is auditable and cannot be silently edited.
 */
export const pointsLedger = pgTable(
  "points_ledger",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("points_ledger_student_idx").on(t.studentId, t.createdAt),
    // No-farming (FR-STU-054): at most one award per (student, question).
    uniqueIndex("points_ledger_student_question_unique")
      .on(t.studentId, t.questionId)
      .where(sql`${t.questionId} IS NOT NULL`),
  ],
);

export const badges = pgTable(
  "badges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("badges_student_code_unique").on(t.studentId, t.code)],
);

export const streaks = pgTable("streaks", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  current: integer("current").notNull().default(0),
  longest: integer("longest").notNull().default(0),
  /** Calendar date, not a timestamp — a streak is a per-day concept. */
  lastActiveDate: date("last_active_date"),
});

/** Non-opted students are absent from the board and cannot see it (FR-STU-053). */
export const leaderboardOptin = pgTable("leaderboard_optin", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  optedIn: boolean("opted_in").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const topicMasteryRelations = relations(topicMastery, ({ one }) => ({
  student: one(users, { fields: [topicMastery.studentId], references: [users.id] }),
  topic: one(topics, { fields: [topicMastery.topicId], references: [topics.id] }),
}));

export type TopicMastery = typeof topicMastery.$inferSelect;
export type CloMastery = typeof cloMastery.$inferSelect;
export type LearningPlan = typeof learningPlans.$inferSelect;
export type MisconceptionHit = typeof misconceptionHits.$inferSelect;
export type Badge = typeof badges.$inferSelect;
export type Streak = typeof streaks.$inferSelect;
