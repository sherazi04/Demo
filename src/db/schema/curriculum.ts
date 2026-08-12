import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The curriculum spine (FR-INT-001..007). Everything the system generates must
 * be traceable back into these tables — that is what makes a "drift" check a
 * set-membership test rather than a judgement call.
 *
 * All of it is loaded from declarative seed files under data/curriculum/
 * (FR-INT-007, NFR-CFG-006).
 */

export const programs = pgTable("programs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  accreditationBody: text("accreditation_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plos = pgTable(
  "plos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    statement: text("statement").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [uniqueIndex("plos_program_code_unique").on(t.programId, t.code)],
);

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    creditHours: integer("credit_hours").notNull().default(3),
    weeks: integer("weeks").notNull().default(14),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("courses_program_idx").on(t.programId)],
);

export const clos = pgTable(
  "clos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    statement: text("statement").notNull(),
    /** Bloom 1–6: Remember, Understand, Apply, Analyze, Evaluate, Create (FR-INT-002). */
    bloomLevel: integer("bloom_level").notNull(),
    weight: real("weight").notNull().default(1),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [
    uniqueIndex("clos_course_code_unique").on(t.courseId, t.code),
    check("clos_bloom_range", sql`${t.bloomLevel} BETWEEN 1 AND 6`),
  ],
);

/** CLO↔PLO matrix with contribution strength 1=low, 2=medium, 3=high (FR-INT-003). */
export const cloPloMap = pgTable(
  "clo_plo_map",
  {
    cloId: uuid("clo_id")
      .notNull()
      .references(() => clos.id, { onDelete: "cascade" }),
    ploId: uuid("plo_id")
      .notNull()
      .references(() => plos.id, { onDelete: "cascade" }),
    strength: integer("strength").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cloId, t.ploId] }),
    check("clo_plo_strength_range", sql`${t.strength} BETWEEN 1 AND 3`),
  ],
);

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    week: integer("week").notNull(),
    ordinal: integer("ordinal").notNull(),
    summary: text("summary").notNull().default(""),
  },
  (t) => [
    uniqueIndex("topics_course_code_unique").on(t.courseId, t.code),
    index("topics_course_week_idx").on(t.courseId, t.week),
  ],
);

/**
 * Directed prerequisite edges (FR-INT-004). Acyclicity is enforced by the
 * seeder before any write, and re-checked by the curriculum validation console
 * via Cypher self-reachability — a SQL constraint cannot express it.
 */
export const topicPrereqs = pgTable(
  "topic_prereqs",
  {
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    prereqTopicId: uuid("prereq_topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.prereqTopicId] }),
    check("topic_prereq_not_self", sql`${t.topicId} <> ${t.prereqTopicId}`),
    index("topic_prereqs_prereq_idx").on(t.prereqTopicId),
  ],
);

export const cloTopics = pgTable(
  "clo_topics",
  {
    cloId: uuid("clo_id")
      .notNull()
      .references(() => clos.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.cloId, t.topicId] }),
    index("clo_topics_topic_idx").on(t.topicId),
  ],
);

/** Known misconceptions per topic, each with a remediation hint (FR-INT-006). */
export const misconceptions = pgTable(
  "misconceptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(),
    description: text("description").notNull(),
    remediation: text("remediation").notNull(),
  },
  (t) => [index("misconceptions_topic_idx").on(t.topicId)],
);

export const programsRelations = relations(programs, ({ many }) => ({
  plos: many(plos),
  courses: many(courses),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  program: one(programs, { fields: [courses.programId], references: [programs.id] }),
  clos: many(clos),
  topics: many(topics),
}));

export const closRelations = relations(clos, ({ one, many }) => ({
  course: one(courses, { fields: [clos.courseId], references: [courses.id] }),
  ploLinks: many(cloPloMap),
  topicLinks: many(cloTopics),
}));

export const topicsRelations = relations(topics, ({ one, many }) => ({
  course: one(courses, { fields: [topics.courseId], references: [courses.id] }),
  misconceptions: many(misconceptions),
  cloLinks: many(cloTopics),
}));

export type Program = typeof programs.$inferSelect;
export type Plo = typeof plos.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Clo = typeof clos.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type Misconception = typeof misconceptions.$inferSelect;
