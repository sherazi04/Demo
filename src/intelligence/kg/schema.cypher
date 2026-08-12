// Knowledge-graph constraints (design.md §5.1).
// Applied by scripts/sync-kg.ts before any MERGE — uniqueness on `id` is what
// makes the whole sync idempotent.

CREATE CONSTRAINT program_id IF NOT EXISTS FOR (n:Program) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT plo_id IF NOT EXISTS FOR (n:PLO) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT course_id IF NOT EXISTS FOR (n:Course) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT clo_id IF NOT EXISTS FOR (n:CLO) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (n:Topic) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT misconception_id IF NOT EXISTS FOR (n:Misconception) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT learning_object_id IF NOT EXISTS FOR (n:LearningObject) REQUIRE n.id IS UNIQUE;

// Lookup indexes for the queries in §5.3.
CREATE INDEX topic_code IF NOT EXISTS FOR (n:Topic) ON (n.code);
CREATE INDEX clo_code IF NOT EXISTS FOR (n:CLO) ON (n.code);
CREATE INDEX learning_object_material IF NOT EXISTS FOR (n:LearningObject) ON (n.materialId);
