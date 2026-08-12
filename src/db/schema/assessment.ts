import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { attemptMode, questionStatus, questionType } from "./enums";
import { users } from "./auth";
import { clos, courses, misconceptions, topics } from "./curriculum";

/** One MCQ option (design.md §4.4). */
export interface QuestionOption {
  key: "A" | "B" | "C" | "D";
  text: string;
  correct: boolean;
  /** Links a distractor to the misconception it targets — drives adaptive feedback. */
  misconceptionCode?: string;
  rationale: string;
}

export type ValidationCheckName =
  | "drift"
  | "bloom_match"
  | "clo_alignment"
  | "groundedness"
  | "single_answer"
  | "distractor_quality";

export interface ValidationCheck {
  name: ValidationCheckName;
  passed: boolean;
  score: number;
  detail: string;
}

/** Persisted on every generated item — the evidence behind the accuracy claim. */
export interface ValidationReport {
  passed: boolean;
  checks: ValidationCheck[];
  failures: string[];
  judgeModel: string;
}

export interface RubricCriterion {
  criterion: string;
  points: number;
}

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    cloId: uuid("clo_id")
      .notNull()
      .references(() => clos.id, { onDelete: "restrict" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "restrict" }),
    type: questionType("type").notNull(),

    /** What the blueprint asked for. */
    targetBloom: integer("target_bloom").notNull(),
    /** What the independent classifier measured — never shown to the classifier. */
    measuredBloom: integer("measured_bloom"),

    stem: text("stem").notNull(),
    options: jsonb("options").$type<QuestionOption[]>(),
    referenceAnswer: text("reference_answer"),
    rubric: jsonb("rubric").$type<RubricCriterion[]>(),
    explanation: text("explanation").notNull().default(""),

    /** LLM's prior; `difficultyElo` is the Elo-calibrated estimate (NOT IRT — see §8.2). */
    difficultyPrior: real("difficulty_prior").notNull().default(0.5),
    difficultyElo: real("difficulty_elo").notNull().default(0.5),
    timesServed: integer("times_served").notNull().default(0),
    timesCorrect: integer("times_correct").notNull().default(0),

    sourceChunkIds: jsonb("source_chunk_ids").$type<string[]>().notNull().default([]),
    generatedByModel: text("generated_by_model"),
    validation: jsonb("validation").$type<ValidationReport>(),

    status: questionStatus("status").notNull().default("draft"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("questions_course_status_idx").on(t.courseId, t.status),
    index("questions_clo_bloom_idx").on(t.cloId, t.targetBloom),
    index("questions_topic_status_idx").on(t.topicId, t.status),
    check("questions_target_bloom_range", sql`${t.targetBloom} BETWEEN 1 AND 6`),
    check(
      "questions_measured_bloom_range",
      sql`${t.measuredBloom} IS NULL OR ${t.measuredBloom} BETWEEN 1 AND 6`,
    ),
    check("questions_elo_range", sql`${t.difficultyElo} BETWEEN 0 AND 1`),
    /**
     * FR-VAL-010, defence in depth: the service layer refuses the transition, and
     * this constraint means a direct SQL write cannot approve an item whose
     * persisted validation report did not pass.
     */
    check(
      "questions_approved_requires_validation",
      sql`${t.status} <> 'approved' OR (${t.validation} IS NOT NULL AND (${t.validation} ->> 'passed')::boolean IS TRUE)`,
    ),
  ],
);

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    /** The requested CLO/Bloom/count/difficulty mix (FR-TCH-001). */
    blueprint: jsonb("blueprint").$type<Record<string, unknown>>(),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assessments_course_idx").on(t.courseId)],
);

export const assessmentItems = pgTable(
  "assessment_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    points: real("points").notNull().default(1),
  },
  (t) => [index("assessment_items_assessment_idx").on(t.assessmentId, t.ordinal)],
);

export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").references(() => assessments.id, {
      onDelete: "set null",
    }),
    mode: attemptMode("mode").notNull().default("adaptive"),
    targetCloId: uuid("target_clo_id").references(() => clos.id, { onDelete: "set null" }),
    targetTopicId: uuid("target_topic_id").references(() => topics.id, {
      onDelete: "set null",
    }),
    itemsPlanned: integer("items_planned").notNull().default(0),
    itemsAnswered: integer("items_answered").notNull().default(0),
    score: real("score"),
    /** Why the run ended: `count` | `mastery` | `exit` (FR-STU-007). */
    terminationReason: text("termination_reason"),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("attempts_student_idx").on(t.studentId, t.startedAt),
    index("attempts_course_idx").on(t.courseId),
  ],
);

export const attemptItems = pgTable(
  "attempt_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    /** Option key for an MCQ, free text for an SAQ. */
    response: text("response"),
    correct: boolean("correct"),
    misconceptionId: uuid("misconception_id").references(() => misconceptions.id, {
      onDelete: "set null",
    }),
    feedback: jsonb("feedback").$type<Record<string, unknown>>(),
    responseMs: integer("response_ms"),
    /** The item's Elo difficulty at serve time — makes adaptation auditable after the fact. */
    servedDifficulty: real("served_difficulty"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attempt_items_attempt_idx").on(t.attemptId, t.ordinal),
    index("attempt_items_question_idx").on(t.questionId),
    index("attempt_items_misconception_idx").on(t.misconceptionId),
  ],
);

export const questionsRelations = relations(questions, ({ one }) => ({
  course: one(courses, { fields: [questions.courseId], references: [courses.id] }),
  clo: one(clos, { fields: [questions.cloId], references: [clos.id] }),
  topic: one(topics, { fields: [questions.topicId], references: [topics.id] }),
}));

export const attemptsRelations = relations(attempts, ({ one, many }) => ({
  student: one(users, { fields: [attempts.studentId], references: [users.id] }),
  items: many(attemptItems),
}));

export const attemptItemsRelations = relations(attemptItems, ({ one }) => ({
  attempt: one(attempts, { fields: [attemptItems.attemptId], references: [attempts.id] }),
  question: one(questions, { fields: [attemptItems.questionId], references: [questions.id] }),
}));

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type AttemptItem = typeof attemptItems.$inferSelect;
export type Assessment = typeof assessments.$inferSelect;
