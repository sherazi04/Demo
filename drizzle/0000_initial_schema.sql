CREATE TYPE "public"."attempt_mode" AS ENUM('adaptive', 'assessment', 'practice');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('ok', 'refusal', 'error');--> statement-breakpoint
CREATE TYPE "public"."ingest_stage" AS ENUM('parse', 'chunk', 'tag', 'embed', 'index', 'kg_link');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lom_format" AS ENUM('definition', 'worked_example', 'proof', 'exercise', 'figure', 'code', 'narrative');--> statement-breakpoint
CREATE TYPE "public"."material_status" AS ENUM('uploaded', 'parsing', 'chunking', 'tagging', 'embedding', 'indexed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'rejected', 'pending', 'approved', 'retired');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq', 'saq', 'numeric', 'code');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'teacher', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "enrollments" (
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_user_id_course_id_pk" PRIMARY KEY("user_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"external_id" text,
	"cohort_tag" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"invite_token" text,
	"invite_expires_at" timestamp with time zone,
	"created_by" uuid,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clo_plo_map" (
	"clo_id" uuid NOT NULL,
	"plo_id" uuid NOT NULL,
	"strength" integer NOT NULL,
	CONSTRAINT "clo_plo_map_clo_id_plo_id_pk" PRIMARY KEY("clo_id","plo_id"),
	CONSTRAINT "clo_plo_strength_range" CHECK ("clo_plo_map"."strength" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "clo_topics" (
	"clo_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	CONSTRAINT "clo_topics_clo_id_topic_id_pk" PRIMARY KEY("clo_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "clos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"code" text NOT NULL,
	"statement" text NOT NULL,
	"bloom_level" integer NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "clos_bloom_range" CHECK ("clos"."bloom_level" BETWEEN 1 AND 6)
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"credit_hours" integer DEFAULT 3 NOT NULL,
	"weeks" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "misconceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"remediation" text NOT NULL,
	CONSTRAINT "misconceptions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "plos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"code" text NOT NULL,
	"statement" text NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"accreditation_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "topic_prereqs" (
	"topic_id" uuid NOT NULL,
	"prereq_topic_id" uuid NOT NULL,
	CONSTRAINT "topic_prereqs_topic_id_prereq_topic_id_pk" PRIMARY KEY("topic_id","prereq_topic_id"),
	CONSTRAINT "topic_prereq_not_self" CHECK ("topic_prereqs"."topic_id" <> "topic_prereqs"."prereq_topic_id")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"week" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"summary" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunk_clos" (
	"chunk_id" uuid NOT NULL,
	"clo_id" uuid NOT NULL,
	"relevance" real DEFAULT 1 NOT NULL,
	CONSTRAINT "chunk_clos_chunk_id_clo_id_pk" PRIMARY KEY("chunk_id","clo_id")
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"page_from" integer,
	"page_to" integer,
	"section_path" text,
	"topic_id" uuid,
	"bloom_level" integer,
	"difficulty" real,
	"lom_format" "lom_format",
	"resource_type" text,
	"tag_confidence" real,
	"lom" jsonb,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"embedding" vector(1024),
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunks_bloom_range" CHECK ("chunks"."bloom_level" IS NULL OR "chunks"."bloom_level" BETWEEN 1 AND 6),
	CONSTRAINT "chunks_difficulty_range" CHECK ("chunks"."difficulty" IS NULL OR "chunks"."difficulty" BETWEEN 0 AND 1),
	CONSTRAINT "chunks_confidence_range" CHECK ("chunks"."tag_confidence" IS NULL OR "chunks"."tag_confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "ingest_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"stage" "ingest_stage" NOT NULL,
	"status" "ingest_status" DEFAULT 'queued' NOT NULL,
	"message" text,
	"items_total" integer DEFAULT 0 NOT NULL,
	"items_done" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'supplement' NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"license_note" text NOT NULL,
	"status" "material_status" DEFAULT 'uploaded' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"error" text,
	"page_count" integer,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"indexed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assessment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"points" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"blueprint" jsonb,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"response" text,
	"correct" boolean,
	"misconception_id" uuid,
	"feedback" jsonb,
	"response_ms" integer,
	"served_difficulty" real,
	"answered_at" timestamp with time zone,
	"served_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"assessment_id" uuid,
	"mode" "attempt_mode" DEFAULT 'adaptive' NOT NULL,
	"target_clo_id" uuid,
	"target_topic_id" uuid,
	"items_planned" integer DEFAULT 0 NOT NULL,
	"items_answered" integer DEFAULT 0 NOT NULL,
	"score" real,
	"termination_reason" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"clo_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"type" "question_type" NOT NULL,
	"target_bloom" integer NOT NULL,
	"measured_bloom" integer,
	"stem" text NOT NULL,
	"options" jsonb,
	"reference_answer" text,
	"rubric" jsonb,
	"explanation" text DEFAULT '' NOT NULL,
	"difficulty_prior" real DEFAULT 0.5 NOT NULL,
	"difficulty_elo" real DEFAULT 0.5 NOT NULL,
	"times_served" integer DEFAULT 0 NOT NULL,
	"times_correct" integer DEFAULT 0 NOT NULL,
	"source_chunk_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_by_model" text,
	"validation" jsonb,
	"status" "question_status" DEFAULT 'draft' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_target_bloom_range" CHECK ("questions"."target_bloom" BETWEEN 1 AND 6),
	CONSTRAINT "questions_measured_bloom_range" CHECK ("questions"."measured_bloom" IS NULL OR "questions"."measured_bloom" BETWEEN 1 AND 6),
	CONSTRAINT "questions_elo_range" CHECK ("questions"."difficulty_elo" BETWEEN 0 AND 1),
	CONSTRAINT "questions_approved_requires_validation" CHECK ("questions"."status" <> 'approved' OR ("questions"."validation" IS NOT NULL AND ("questions"."validation" ->> 'passed')::boolean IS TRUE))
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"code" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clo_mastery" (
	"student_id" uuid NOT NULL,
	"clo_id" uuid NOT NULL,
	"p_known" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clo_mastery_student_id_clo_id_pk" PRIMARY KEY("student_id","clo_id"),
	CONSTRAINT "clo_mastery_p_known_range" CHECK ("clo_mastery"."p_known" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "leaderboard_optin" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text DEFAULT 'initial' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "misconception_hits" (
	"student_id" uuid NOT NULL,
	"misconception_id" uuid NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "misconception_hits_student_id_misconception_id_pk" PRIMARY KEY("student_id","misconception_id")
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"question_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"longest" integer DEFAULT 0 NOT NULL,
	"last_active_date" date
);
--> statement-breakpoint
CREATE TABLE "topic_mastery" (
	"student_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"p_known" real DEFAULT 0.15 NOT NULL,
	"observations" integer DEFAULT 0 NOT NULL,
	"last_correct" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_mastery_student_id_topic_id_pk" PRIMARY KEY("student_id","topic_id"),
	CONSTRAINT "topic_mastery_p_known_range" CHECK ("topic_mastery"."p_known" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"actor_id" uuid,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"model" text,
	"effort" text,
	"prompt_hash" text,
	"retrieved_chunk_ids" jsonb,
	"output_hash" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"latency_ms" integer,
	"outcome" "audit_outcome" DEFAULT 'ok' NOT NULL,
	"payload" jsonb,
	"correlation_id" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bias_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slice_key" text NOT NULL,
	"metric" text NOT NULL,
	"value" real NOT NULL,
	"cohort_mean" real NOT NULL,
	"deviation" real NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clo_plo_map" ADD CONSTRAINT "clo_plo_map_clo_id_clos_id_fk" FOREIGN KEY ("clo_id") REFERENCES "public"."clos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clo_plo_map" ADD CONSTRAINT "clo_plo_map_plo_id_plos_id_fk" FOREIGN KEY ("plo_id") REFERENCES "public"."plos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clo_topics" ADD CONSTRAINT "clo_topics_clo_id_clos_id_fk" FOREIGN KEY ("clo_id") REFERENCES "public"."clos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clo_topics" ADD CONSTRAINT "clo_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clos" ADD CONSTRAINT "clos_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconceptions" ADD CONSTRAINT "misconceptions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plos" ADD CONSTRAINT "plos_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_prereqs" ADD CONSTRAINT "topic_prereqs_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_prereqs" ADD CONSTRAINT "topic_prereqs_prereq_topic_id_topics_id_fk" FOREIGN KEY ("prereq_topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_clos" ADD CONSTRAINT "chunk_clos_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_clos" ADD CONSTRAINT "chunk_clos_clo_id_clos_id_fk" FOREIGN KEY ("clo_id") REFERENCES "public"."clos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_supersedes_id_materials_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_items" ADD CONSTRAINT "attempt_items_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_items" ADD CONSTRAINT "attempt_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_items" ADD CONSTRAINT "attempt_items_misconception_id_misconceptions_id_fk" FOREIGN KEY ("misconception_id") REFERENCES "public"."misconceptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_target_clo_id_clos_id_fk" FOREIGN KEY ("target_clo_id") REFERENCES "public"."clos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_target_topic_id_topics_id_fk" FOREIGN KEY ("target_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_clo_id_clos_id_fk" FOREIGN KEY ("clo_id") REFERENCES "public"."clos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clo_mastery" ADD CONSTRAINT "clo_mastery_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clo_mastery" ADD CONSTRAINT "clo_mastery_clo_id_clos_id_fk" FOREIGN KEY ("clo_id") REFERENCES "public"."clos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_optin" ADD CONSTRAINT "leaderboard_optin_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_hits" ADD CONSTRAINT "misconception_hits_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_hits" ADD CONSTRAINT "misconception_hits_misconception_id_misconceptions_id_fk" FOREIGN KEY ("misconception_id") REFERENCES "public"."misconceptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollments_course_idx" ON "enrollments" USING btree ("course_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_invite_token_unique" ON "users" USING btree ("invite_token");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_cohort_tag_idx" ON "users" USING btree ("cohort_tag");--> statement-breakpoint
CREATE INDEX "clo_topics_topic_idx" ON "clo_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clos_course_code_unique" ON "clos" USING btree ("course_id","code");--> statement-breakpoint
CREATE INDEX "courses_program_idx" ON "courses" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "misconceptions_topic_idx" ON "misconceptions" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plos_program_code_unique" ON "plos" USING btree ("program_id","code");--> statement-breakpoint
CREATE INDEX "topic_prereqs_prereq_idx" ON "topic_prereqs" USING btree ("prereq_topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_course_code_unique" ON "topics" USING btree ("course_id","code");--> statement-breakpoint
CREATE INDEX "topics_course_week_idx" ON "topics" USING btree ("course_id","week");--> statement-breakpoint
CREATE INDEX "chunk_clos_clo_idx" ON "chunk_clos" USING btree ("clo_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_text_trgm" ON "chunks" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "chunks_material_idx" ON "chunks" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "chunks_topic_idx" ON "chunks" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "chunks_course_bloom_idx" ON "chunks" USING btree ("course_id","bloom_level");--> statement-breakpoint
CREATE INDEX "chunks_confidence_idx" ON "chunks" USING btree ("tag_confidence");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_jobs_material_stage_unique" ON "ingest_jobs" USING btree ("material_id","stage");--> statement-breakpoint
CREATE INDEX "ingest_jobs_material_idx" ON "ingest_jobs" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_course_hash_unique" ON "materials" USING btree ("course_id","content_hash");--> statement-breakpoint
CREATE INDEX "materials_course_idx" ON "materials" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "materials_status_idx" ON "materials" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assessment_items_assessment_idx" ON "assessment_items" USING btree ("assessment_id","ordinal");--> statement-breakpoint
CREATE INDEX "assessments_course_idx" ON "assessments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "attempt_items_attempt_idx" ON "attempt_items" USING btree ("attempt_id","ordinal");--> statement-breakpoint
CREATE INDEX "attempt_items_question_idx" ON "attempt_items" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "attempt_items_misconception_idx" ON "attempt_items" USING btree ("misconception_id");--> statement-breakpoint
CREATE INDEX "attempts_student_idx" ON "attempts" USING btree ("student_id","started_at");--> statement-breakpoint
CREATE INDEX "attempts_course_idx" ON "attempts" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "questions_course_status_idx" ON "questions" USING btree ("course_id","status");--> statement-breakpoint
CREATE INDEX "questions_clo_bloom_idx" ON "questions" USING btree ("clo_id","target_bloom");--> statement-breakpoint
CREATE INDEX "questions_topic_status_idx" ON "questions" USING btree ("topic_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "badges_student_code_unique" ON "badges" USING btree ("student_id","code");--> statement-breakpoint
CREATE INDEX "learning_plans_student_idx" ON "learning_plans" USING btree ("student_id","generated_at");--> statement-breakpoint
CREATE INDEX "misconception_hits_misconception_idx" ON "misconception_hits" USING btree ("misconception_id");--> statement-breakpoint
CREATE INDEX "points_ledger_student_idx" ON "points_ledger" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_student_question_unique" ON "points_ledger" USING btree ("student_id","question_id") WHERE "points_ledger"."question_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "topic_mastery_topic_idx" ON "topic_mastery" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "audit_log_seq_idx" ON "audit_log" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_idx" ON "audit_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "bias_snapshots_computed_idx" ON "bias_snapshots" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "bias_snapshots_slice_idx" ON "bias_snapshots" USING btree ("slice_key","metric");