# Requirements — Metadata-Driven Dual-Engine Personalized Learning Framework

**Document version:** 1.0
**Status:** Approved for build
**Scope of this document:** A single-course, end-to-end demonstration system in which all four architectural layers are genuinely implemented, not mocked.

---

## 1. Overview

### 1.1 Purpose

Build a working demonstration of a Metadata-Driven Dual-Engine Personalized Learning Framework for Outcome-Based Education (OBE). The system pairs two user-facing engines — a **Student Engine** and a **Teacher Engine** — on top of a shared **Intelligence Layer** (IEEE LOM metadata, a curriculum knowledge graph, Graph RAG, and hybrid semantic retrieval), with a **Governance Layer** enforcing transparency, auditability, access control, and fairness across every output.

The defining characteristic of the system is that **no AI-generated artifact reaches a learner without being traceable to a Course Learning Outcome (CLO), a Bloom's taxonomy level, and the specific source content it was grounded on.**

### 1.2 Demonstration scope

| Dimension | Value |
|---|---|
| Courses | 1 (Data Structures & Algorithms, CS-201) |
| Program Learning Outcomes (PLOs) | 12 |
| Course Learning Outcomes (CLOs) | 8 |
| Topics | 30, with a directed prerequisite graph |
| Teaching weeks | 14 |
| Source corpus | 1 open-access textbook (+ teacher-uploaded supplements) |
| Target chunk count | 3,000 – 5,000 |
| Synthetic student cohort | 40 |
| Roles | student, teacher, admin |
| Deployment | single machine, `docker compose up` |

### 1.3 Layer coverage

All four layers are in scope and must be functionally real:

| Layer | Depth required |
|---|---|
| Intelligence Layer | Full — LOM tagging, knowledge graph, Graph RAG, hybrid retrieval |
| Teacher Engine | 6 of 6 features (2 deep, 4 functional) |
| Student Engine | 6 of 6 features (2 deep, 4 functional) |
| Governance Layer | 4 of 4 controls, genuinely enforced (not display-only) |
| OBE foundation | Full — Bloom's 6 levels, CLO↔PLO matrix, prerequisite graph |

### 1.4 Definitions

| Term | Meaning |
|---|---|
| **PLO** | Program Learning Outcome — a program-level competency statement |
| **CLO** | Course Learning Outcome — a course-level outcome, mapped to one or more PLOs |
| **Bloom level** | Integer 1–6: Remember, Understand, Apply, Analyze, Evaluate, Create |
| **IEEE LOM** | IEEE 1484.12.1 Learning Object Metadata standard |
| **Chunk** | The smallest retrievable unit of course content, carrying LOM metadata |
| **Item** | A single assessment question in the item bank |
| **Graph RAG** | Retrieval that expands vector hits along curriculum-graph edges before assembling context |
| **BKT** | Bayesian Knowledge Tracing — the per-topic mastery model |
| **Validation engine** | The subsystem that verifies generated items against CLO, Bloom, and source grounding |
| **Drift** | A generated artifact that is not traceable to an approved CLO/topic in the curriculum |

---

## 2. Actors and roles

### 2.1 Administrator

Onboards all users, configures the system, and inspects governance. **There is no public sign-up in this system.**

| Capability | Notes |
|---|---|
| Create, edit, suspend, delete user accounts | Individually and via CSV bulk import |
| Assign roles (student / teacher / admin) | Role is enforced server-side on every route |
| Enrol students in courses; assign teachers to courses | Enrolment is per-course, per-role |
| Issue and reset credentials | Invite flow with first-login password set |
| Configure LLM provider, model, and effort per tier | Persisted, editable at runtime, no redeploy |
| Configure embedding provider and retrieval parameters | Same |
| Inspect the audit log and verify chain integrity | Read-only |
| Inspect the bias/fairness monitor | Read-only |
| View the CLO↔PLO matrix and corpus coverage heatmap | Read-only |

### 2.2 Teacher

Owns course content and approves everything the AI produces for their course.

| Capability | Notes |
|---|---|
| Upload course material | PDF, DOCX, PPTX, TXT, MD — triggers live ingestion |
| Monitor ingestion progress | Per-stage status and progress bar |
| Review and correct auto-generated LOM tags | Sampling queue prioritised by tagger confidence |
| Generate assessments from a blueprint | CLO mix, Bloom mix, item count, difficulty band |
| Approve, edit, or reject generated items | Only approved items are ever served to a student |
| Generate Bloom-sequenced lecture plans | With citations to source chunks |
| View the CLO↔PLO matrix and coverage heatmap | Read-only view of the curriculum spine |
| View cohort analytics | Mastery, engagement, at-risk flags |
| Get metadata-filtered resource recommendations | For a chosen topic/CLO/Bloom level |
| Get AI feedback coaching on student submissions | Draft feedback the teacher edits and sends |

### 2.3 Student

Consumes personalized learning; sees only their own data.

| Capability | Notes |
|---|---|
| Take an adaptive quiz | Difficulty adapts live from mastery state |
| Receive misconception-named feedback | Not "incorrect" — the specific misconception |
| Follow a prerequisite-ordered learning plan | Reorders as mastery changes |
| Receive metadata-filtered content recommendations | Respects current Bloom level and mastery |
| Track per-CLO and per-topic mastery | Visual progress |
| Earn points, badges, and streaks | Cohort-scoped leaderboard, opt-in |

---

## 3. Functional requirements

Requirement IDs are stable and are referenced by the design document and the build prompt.

### 3.1 Intelligence Layer

#### 3.1.1 Curriculum spine

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-001 | The system SHALL store a program with 12 PLOs, a course with 8 CLOs, and 30 topics. | Must |
| FR-INT-002 | Each CLO SHALL carry a Bloom level (1–6), a weight, and a statement. | Must |
| FR-INT-003 | The system SHALL store a CLO↔PLO mapping matrix with a contribution strength (1=low, 2=medium, 3=high). | Must |
| FR-INT-004 | The system SHALL store directed prerequisite edges between topics, and SHALL reject a cyclic prerequisite graph at seed time. | Must |
| FR-INT-005 | The system SHALL store a many-to-many CLO↔Topic mapping. | Must |
| FR-INT-006 | The system SHALL store known misconceptions per topic, each with a description and a remediation hint. | Must |
| FR-INT-007 | The curriculum spine SHALL be loadable from declarative seed files (YAML or TS), so a different course can replace it without code changes. | Must |

#### 3.1.2 Content ingestion

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-010 | A teacher SHALL be able to upload PDF, DOCX, PPTX, TXT, and MD files through the teacher panel. | Must |
| FR-INT-011 | The system SHALL compute a SHA-256 content hash and reject an exact duplicate within the same course. | Must |
| FR-INT-012 | The uploader SHALL be required to record a licensing note for each upload. | Must |
| FR-INT-013 | Ingestion SHALL run as an asynchronous job pipeline with these ordered stages: `parse → chunk → tag → embed → index → graph-link`. | Must |
| FR-INT-014 | Each stage SHALL persist status (`queued`/`running`/`done`/`failed`), an items-done/items-total counter, and an error message on failure. | Must |
| FR-INT-015 | The teacher panel SHALL display live ingestion progress and SHALL allow retry of a failed stage without re-uploading. | Must |
| FR-INT-016 | Chunking SHALL respect document structure (headings, sections, slide boundaries) and SHALL produce chunks of a configurable target token size with configurable overlap. | Must |
| FR-INT-017 | Each chunk SHALL retain a source locator (page range and/or section path) sufficient to render a citation. | Must |
| FR-INT-018 | Newly indexed material SHALL become retrievable immediately, with no restart or redeploy. | Must |
| FR-INT-019 | Re-uploading a revised version of a material SHALL supersede the prior version rather than deleting it, preserving the audit trail. | Should |

#### 3.1.3 IEEE LOM metadata tagging

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-020 | Every chunk SHALL be tagged with: topic, Bloom level (1–6), difficulty (0–1), LOM format, LOM learning-resource-type, and one or more candidate CLOs. | Must |
| FR-INT-021 | The tagger SHALL emit a confidence score (0–1) per chunk. | Must |
| FR-INT-022 | The tagger SHALL produce structured, schema-validated output — free-text parsing is prohibited. | Must |
| FR-INT-023 | The system SHALL maintain a human-review queue of chunks ordered by ascending tagger confidence. | Must |
| FR-INT-024 | A teacher SHALL be able to accept or correct any tag; corrections SHALL set `verifiedBy` and `verifiedAt`. | Must |
| FR-INT-025 | The full LOM record SHALL be stored as structured JSON alongside the indexed columns. | Should |
| FR-INT-026 | Tagger accuracy SHALL be measurable against a human-labelled gold set of at least 150 chunks. | Must |

#### 3.1.4 Knowledge graph

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-030 | The system SHALL maintain a property graph with node labels `Program`, `PLO`, `Course`, `CLO`, `Topic`, `Misconception`, `LearningObject`. | Must |
| FR-INT-031 | The graph SHALL model these relationship types: `HAS_PLO`, `OFFERS`, `HAS_CLO`, `MAPS_TO`, `COVERS`, `PREREQ_OF`, `ASSESSES`, `EVIDENCE_FOR`, `MISCONCEPTION_OF`. | Must |
| FR-INT-032 | The graph SHALL be rebuildable from the relational database by a single idempotent sync command. | Must |
| FR-INT-033 | The graph SHALL be visually inspectable (Neo4j Browser or equivalent) for demonstration purposes. | Must |
| FR-INT-034 | The system SHALL expose graph queries for: prerequisite closure of a topic, topic-sibling expansion within a CLO, and the CLO→PLO path for any node. | Must |

#### 3.1.5 Retrieval (Graph RAG + hybrid search)

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-040 | Retrieval SHALL support metadata pre-filtering on course, topic, CLO, Bloom band, difficulty band, and LOM format. | Must |
| FR-INT-041 | Retrieval SHALL combine dense vector search with lexical search and fuse the two result sets. | Must |
| FR-INT-042 | Retrieval SHALL expand candidates along curriculum-graph edges (prerequisites and CLO siblings) up to a configurable hop count. | Must |
| FR-INT-043 | Retrieval SHALL optionally apply a cross-encoder or LLM re-ranker, controlled by configuration. | Should |
| FR-INT-044 | Every retrieval result SHALL carry its chunk ID, source locator, and LOM metadata so downstream consumers can cite it. | Must |
| FR-INT-045 | The embedding provider SHALL be swappable via configuration, with at least one option requiring no external API key so the system runs fully offline. | Must |
| FR-INT-046 | Retrieval quality SHALL be measurable as hit-rate@k against a labelled query set. | Must |

#### 3.1.6 LLM orchestration

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-050 | The system SHALL route LLM calls through three named tiers: **generation**, **judge**, **bulk**. | Must |
| FR-INT-051 | Model ID and reasoning effort SHALL be independently configurable per tier at runtime from the admin panel. | Must |
| FR-INT-052 | The judge tier SHALL be invoked as a separate call with a separate prompt from the generation tier — self-validation in a single call is prohibited. | Must |
| FR-INT-053 | All structured generation SHALL use schema-enforced output; the system SHALL retry on schema violation up to a configured limit and then fail loudly. | Must |
| FR-INT-054 | Stable prompt prefixes (system prompt, course context) SHALL use prompt caching. | Should |
| FR-INT-055 | The system SHALL check the response stop reason before reading content and SHALL handle a model refusal as a first-class outcome, not an exception. | Must |
| FR-INT-056 | Every LLM call SHALL record model ID, effort, token usage, latency, and a prompt hash. | Must |

### 3.2 Validation Engine

This subsystem is the system's differentiator. It is what makes the accuracy claim measurable.

| ID | Requirement | Priority |
|---|---|---|
| FR-VAL-001 | Every generated assessment item SHALL pass through the validation engine before it can be approved. | Must |
| FR-VAL-002 | **Bloom check** — the engine SHALL independently classify the item's cognitive level and SHALL fail the item if it does not match the requested Bloom level. | Must |
| FR-VAL-003 | **CLO alignment check** — the engine SHALL score whether the item actually assesses the target CLO, using both semantic similarity and a knowledge-graph path check, and SHALL fail below a configurable threshold. | Must |
| FR-VAL-004 | **Groundedness check** — the engine SHALL verify every factual claim in the item is supported by at least one retrieved source chunk, and SHALL fail ungrounded items. | Must |
| FR-VAL-005 | **Single-answer check (MCQ)** — the engine SHALL verify exactly one option is defensibly correct. | Must |
| FR-VAL-006 | **Distractor quality check (MCQ)** — the engine SHALL verify each distractor is plausible, is not a giveaway, and maps to a named misconception where one exists. | Must |
| FR-VAL-007 | **Drift check** — the engine SHALL reject any item whose topic or CLO is not present in the approved curriculum spine. | Must |
| FR-VAL-008 | A failed item SHALL be persisted with status `rejected` and a machine-readable list of failure reasons — failures SHALL NOT be silently discarded. | Must |
| FR-VAL-009 | The teacher UI SHALL display rejected items and their failure reasons alongside the accepted ones. | Must |
| FR-VAL-010 | When `ENFORCE_VALIDATION` is enabled, an item that fails validation SHALL be un-approvable and SHALL NOT be servable to any student. | Must |
| FR-VAL-011 | Each check SHALL return a 0–1 score and a human-readable explanation, both persisted on the item. | Must |

### 3.3 Teacher Engine

#### 3.3.1 Assessment generator (deep)

| ID | Requirement | Priority |
|---|---|---|
| FR-TCH-001 | A teacher SHALL be able to specify a blueprint: target CLOs, Bloom-level mix, item count, item types (MCQ/SAQ), and difficulty band. | Must |
| FR-TCH-002 | The generator SHALL retrieve grounding context per item via the Graph RAG pipeline, filtered by the requested CLO and Bloom level. | Must |
| FR-TCH-003 | Generated MCQs SHALL include a stem, 4 options, exactly one correct answer, a per-option rationale, and an overall explanation. | Must |
| FR-TCH-004 | Generated SAQs SHALL include a stem, a reference answer, and a scoring rubric. | Must |
| FR-TCH-005 | Every item SHALL record the source chunk IDs used to ground it. | Must |
| FR-TCH-006 | The teacher SHALL be able to approve, edit-then-approve, or reject each item; rejections SHALL capture a reason. | Must |
| FR-TCH-007 | Approved items SHALL enter the reusable item bank, scoped to the course. | Must |
| FR-TCH-008 | The teacher SHALL be able to assemble approved items into a named assessment and publish it. | Must |

#### 3.3.2 Lecture co-pilot (deep)

| ID | Requirement | Priority |
|---|---|---|
| FR-TCH-010 | Given a topic or week, the co-pilot SHALL produce a time-boxed session plan whose activities ascend Bloom's taxonomy. | Must |
| FR-TCH-011 | Each plan segment SHALL declare its duration, Bloom level, target CLO, activity type, and instructor notes. | Must |
| FR-TCH-012 | Each plan SHALL cite the source chunks its content is drawn from. | Must |
| FR-TCH-013 | Each plan SHALL include at least one formative check-for-understanding aligned to the target CLO. | Must |
| FR-TCH-014 | Plans SHALL be saveable, editable, and exportable as Markdown. | Should |

#### 3.3.3 Curriculum tools

| ID | Requirement | Priority |
|---|---|---|
| FR-TCH-020 | The system SHALL render the CLO↔PLO matrix with contribution strengths. | Must |
| FR-TCH-021 | The system SHALL render a corpus coverage heatmap of topic × Bloom level, showing chunk counts, and SHALL visually flag cells with zero coverage. | Must |
| FR-TCH-022 | The system SHALL render the topic prerequisite graph. | Must |
| FR-TCH-023 | The system SHALL report per-CLO item-bank coverage (approved item count per CLO per Bloom level). | Must |

#### 3.3.4 Analytics dashboard

| ID | Requirement | Priority |
|---|---|---|
| FR-TCH-030 | The dashboard SHALL show cohort mastery per CLO and per topic. | Must |
| FR-TCH-031 | The dashboard SHALL show engagement metrics: attempts, items answered, active days, streaks. | Must |
| FR-TCH-032 | The dashboard SHALL flag at-risk students using explicit, inspectable rules, and SHALL display the rule that fired for each flag. | Must |
| FR-TCH-033 | The dashboard SHALL surface the most-missed items and the most-triggered misconceptions. | Must |
| FR-TCH-034 | The at-risk rule set SHALL be documented and SHALL NOT be presented as a trained predictive model. | Must |

#### 3.3.5 Resource recommender

| ID | Requirement | Priority |
|---|---|---|
| FR-TCH-040 | Given a topic, CLO, and Bloom level, the system SHALL return ranked source material filtered on LOM metadata. | Must |
| FR-TCH-041 | Each recommendation SHALL show its LOM tags and source locator. | Must |

#### 3.3.6 AI co-teacher

| ID | Requirement | Priority |
|---|---|---|
| FR-TCH-050 | Given a student response and the item's rubric, the system SHALL draft structured feedback: what is correct, what is missing, the misconception if identifiable, and a next step. | Must |
| FR-TCH-051 | Draft feedback SHALL be editable by the teacher before it is released to the student. | Must |
| FR-TCH-052 | Feedback SHALL never be auto-released without teacher action. | Must |

### 3.4 Student Engine

#### 3.4.1 Adaptive quiz (deep)

| ID | Requirement | Priority |
|---|---|---|
| FR-STU-001 | The system SHALL serve items one at a time, selecting each next item from the student's current mastery state. | Must |
| FR-STU-002 | Item selection SHALL prefer items whose difficulty is near the student's estimated ability for the target topic. | Must |
| FR-STU-003 | Item selection SHALL apply exposure control: an item recently served to the same student SHALL be deprioritised. | Must |
| FR-STU-004 | Only items with status `approved` SHALL ever be served. | Must |
| FR-STU-005 | The Bloom level of served items SHALL rise as topic mastery rises. | Must |
| FR-STU-006 | Each response SHALL be recorded with correctness, latency, the served difficulty, and the selected option. | Must |
| FR-STU-007 | A quiz run SHALL terminate on item count, on mastery threshold, or on student exit, and SHALL persist a summary. | Must |

#### 3.4.2 Adaptive feedback (deep)

| ID | Requirement | Priority |
|---|---|---|
| FR-STU-010 | On an incorrect MCQ response, the system SHALL identify the misconception associated with the chosen distractor. | Must |
| FR-STU-011 | Feedback SHALL name the misconception, explain why the reasoning fails, and give the correct reasoning path. | Must |
| FR-STU-012 | Feedback SHALL cite the source chunk that supports the correct reasoning. | Must |
| FR-STU-013 | A repeatedly triggered misconception SHALL escalate into a remediation recommendation in the learning plan. | Must |
| FR-STU-014 | Feedback SHALL never reveal the answers to unserved items. | Must |

#### 3.4.3 Learning plan

| ID | Requirement | Priority |
|---|---|---|
| FR-STU-020 | The system SHALL generate a personalized ordered topic path respecting the prerequisite graph. | Must |
| FR-STU-021 | The path SHALL place unmastered prerequisites ahead of dependent topics. | Must |
| FR-STU-022 | The path SHALL reorder automatically when mastery changes. | Must |
| FR-STU-023 | Each path step SHALL show its target CLO, Bloom level, estimated effort, and current mastery. | Must |
| FR-STU-024 | The path SHALL include gamified milestones at CLO boundaries. | Should |

#### 3.4.4 Recommendations

| ID | Requirement | Priority |
|---|---|---|
| FR-STU-030 | The system SHALL recommend study material filtered by the student's current topic, mastery band, and Bloom level. | Must |
| FR-STU-031 | Recommendations SHALL exclude material above the student's readiness level for unmastered prerequisites. | Should |

#### 3.4.5 Progress tracking

| ID | Requirement | Priority |
|---|---|---|
| FR-STU-040 | The student SHALL see per-CLO mastery bars and per-topic mastery detail. | Must |
| FR-STU-041 | The student SHALL see attempt history with per-item outcomes. | Must |
| FR-STU-042 | A student SHALL be able to access only their own data; cross-student access SHALL be denied server-side. | Must |

#### 3.4.6 Gamification

| ID | Requirement | Priority |
|---|---|---|
| FR-STU-050 | The system SHALL award points for correct answers, weighted by item difficulty. | Must |
| FR-STU-051 | The system SHALL award badges on defined achievements (first CLO mastered, 7-day streak, misconception cleared). | Must |
| FR-STU-052 | The system SHALL track a daily activity streak. | Must |
| FR-STU-053 | The leaderboard SHALL be cohort-scoped and opt-in, and SHALL never expose another student's scores without their opt-in. | Must |
| FR-STU-054 | Points SHALL not be awarded for repeated attempts at an already-mastered item. | Must |

### 3.5 Governance Layer

| ID | Requirement | Priority |
|---|---|---|
| FR-GOV-001 | Every AI invocation SHALL append a record to an immutable audit log. | Must |
| FR-GOV-002 | Each audit record SHALL include: timestamp, actor ID, actor role, action, resource type and ID, model ID, effort, prompt hash, retrieved chunk IDs, output hash, token usage, and latency. | Must |
| FR-GOV-003 | The audit log SHALL be hash-chained: each record SHALL store the previous record's hash, and the chain SHALL be verifiable end to end. | Must |
| FR-GOV-004 | The audit log SHALL be append-only; update and delete SHALL be prevented at the database level. | Must |
| FR-GOV-005 | Chain verification SHALL be exposed as an admin action returning pass/fail and the first broken link if any. | Must |
| FR-GOV-006 | Human decisions (approve, reject, edit, release feedback) SHALL also be written to the audit log. | Must |
| FR-GOV-007 | RBAC SHALL be enforced server-side on every route and data access path; client-side hiding alone is not acceptable. | Must |
| FR-GOV-008 | A cross-role or cross-tenant access attempt SHALL return 403 and SHALL be logged. | Must |
| FR-GOV-009 | The curriculum validation console SHALL report: CLOs with no mapped PLO, CLOs with no mapped topic, topics with zero corpus coverage, Bloom levels with zero item coverage, and prerequisite cycles. | Must |
| FR-GOV-010 | The bias monitor SHALL compute per-cohort-slice metrics: mean mastery, item accuracy, at-risk flag rate, and recommendation distribution. | Must |
| FR-GOV-011 | The bias monitor SHALL flag a slice whose metric deviates beyond a configurable threshold from the cohort mean. | Must |
| FR-GOV-012 | Demographic attributes SHALL be visible only to the bias monitor and to admins, never to teachers or students. | Must |
| FR-GOV-013 | Every AI-generated artifact shown to a user SHALL be visually labelled as AI-generated. | Must |
| FR-GOV-014 | Passwords SHALL be stored as salted bcrypt hashes; plaintext or reversible storage is prohibited. | Must |

### 3.6 Administration

| ID | Requirement | Priority |
|---|---|---|
| FR-ADM-001 | The system SHALL create exactly one bootstrap admin from environment configuration on first run. | Must |
| FR-ADM-002 | Admins SHALL create users individually and via CSV bulk import with a validation preview before commit. | Must |
| FR-ADM-003 | Admins SHALL enrol users into courses with a per-course role. | Must |
| FR-ADM-004 | Admins SHALL suspend and reactivate accounts; a suspended account SHALL be denied login. | Must |
| FR-ADM-005 | Admins SHALL configure LLM tier models and effort levels at runtime. | Must |
| FR-ADM-006 | Admins SHALL configure embedding provider and retrieval parameters at runtime. | Must |
| FR-ADM-007 | Configuration changes SHALL be written to the audit log with before/after values. | Must |
| FR-ADM-008 | No route SHALL permit self-registration. | Must |

---

## 4. Data requirements

### 4.1 Curriculum data (authored, seeded)

| Asset | Volume | Source |
|---|---|---|
| Program record | 1 | Authored |
| PLOs | 12 | Standard engineering-computing PLO set |
| Course record | 1 (CS-201 Data Structures & Algorithms) | Authored |
| CLOs | 8, each with a Bloom level | Authored |
| CLO↔PLO mappings | ~20 edges with strengths | Authored |
| Topics | 30, assigned to weeks 1–14 | Authored |
| Prerequisite edges | ~45, acyclic | Authored |
| CLO↔Topic mappings | ~60 edges | Authored |
| Misconceptions | ≥ 2 per topic (~60 total) | Authored |

### 4.2 Content corpus

| Requirement | Value |
|---|---|
| Primary source | One open-access, openly-licensed textbook (e.g. *Open Data Structures*, CC BY) |
| Supplementary | Teacher-uploaded slides and notes, added at runtime |
| Target chunks | 3,000 – 5,000 |
| Licensing | Every material record SHALL carry a licensing note; only openly-licensed or institution-owned content is permitted in the demo |

### 4.3 Ground-truth / evaluation data

| Asset | Volume | Purpose |
|---|---|---|
| Bloom-labelled chunks | ≥ 150 | Measure tagger accuracy |
| Expert-written CLO-tagged questions | ≥ 50 | Quality reference for generated items |
| Labelled retrieval queries with relevant chunk IDs | ≥ 40 | Measure hit-rate@k |
| Expert ratings of generated items | ≥ 50 | Measure CLO alignment precision |

### 4.4 Synthetic cohort

| Requirement | Value |
|---|---|
| Students | 40 |
| Ability distribution | Latent ability sampled across a realistic spread |
| Behaviour profiles | Consistent, cramming, declining, disengaged |
| Response generation | Probabilistic on latent ability vs. item difficulty, with misconception-biased distractor selection |
| Labelling | All synthetic data SHALL be clearly labelled as synthetic in the UI and in any report |

---

## 5. Non-functional requirements

### 5.1 Performance

| ID | Requirement |
|---|---|
| NFR-PRF-001 | Retrieval (filter → hybrid search → graph expand → assemble) SHALL complete in under 1.5 s at p95 for a 5,000-chunk corpus. |
| NFR-PRF-002 | Generating and validating a 10-item assessment SHALL complete in under 3 minutes, with per-item streaming progress in the UI. |
| NFR-PRF-003 | Serving the next adaptive item SHALL complete in under 500 ms at p95 (retrieval-free path). |
| NFR-PRF-004 | Ingesting a 600-page PDF SHALL complete in under 30 minutes on the reference machine. |
| NFR-PRF-005 | Panel pages SHALL render meaningful content within 2 s at p95 on local deployment. |

### 5.2 Reliability

| ID | Requirement |
|---|---|
| NFR-REL-001 | Ingestion SHALL be resumable — a failed stage SHALL be retryable without re-uploading or re-running completed stages. |
| NFR-REL-002 | All LLM calls SHALL have a timeout and bounded retry with exponential backoff. |
| NFR-REL-003 | A single failed item generation SHALL NOT abort the surrounding batch. |
| NFR-REL-004 | Long generations SHALL use streaming to avoid HTTP timeouts. |
| NFR-REL-005 | The system SHALL start cleanly from `docker compose up` plus a documented bootstrap command. |

### 5.3 Security and privacy

| ID | Requirement |
|---|---|
| NFR-SEC-001 | Authentication SHALL use server-side sessions or signed tokens with a configurable secret. |
| NFR-SEC-002 | Authorization SHALL be enforced in a single, centrally audited server-side guard, not scattered per-component. |
| NFR-SEC-003 | Uploaded files SHALL be validated by MIME type and size, and stored outside the web root. |
| NFR-SEC-004 | Secrets SHALL be read from environment configuration only and SHALL never be logged or returned by an API. |
| NFR-SEC-005 | All database access SHALL use parameterised queries. |
| NFR-SEC-006 | Student personal data SHALL be excluded from LLM prompt payloads; only pseudonymous identifiers may appear. |
| NFR-SEC-007 | The system SHALL document exactly what data leaves the machine when a hosted LLM or embedding provider is configured. |

### 5.4 Configurability

| ID | Requirement |
|---|---|
| NFR-CFG-001 | LLM provider, per-tier model, and per-tier effort SHALL be runtime-configurable. |
| NFR-CFG-002 | Embedding provider SHALL be runtime-configurable, including an offline option that requires no API key. |
| NFR-CFG-003 | Retrieval parameters (k values, hop count, re-ranking on/off, thresholds) SHALL be runtime-configurable. |
| NFR-CFG-004 | Chunking parameters SHALL be configurable. |
| NFR-CFG-005 | Validation thresholds SHALL be configurable, and validation enforcement SHALL be switchable for evaluation purposes only. |
| NFR-CFG-006 | Replacing the curriculum seed files SHALL be sufficient to retarget the system to a different course. |

### 5.5 Observability

| ID | Requirement |
|---|---|
| NFR-OBS-001 | Every LLM call SHALL be traceable: prompt hash, retrieved chunk IDs, model, effort, tokens, latency, outcome. |
| NFR-OBS-002 | Token spend SHALL be aggregatable by tier, by feature, and by day. |
| NFR-OBS-003 | Structured logs SHALL carry a correlation ID linking a user action to all downstream AI calls. |
| NFR-OBS-004 | The eval harness SHALL be runnable as a single command and SHALL emit a machine-readable report. |

### 5.6 Accessibility and UX

| ID | Requirement |
|---|---|
| NFR-UX-001 | The three panels SHALL be visually distinct and SHALL share a component library. |
| NFR-UX-002 | Interfaces SHALL target WCAG 2.2 AA: keyboard navigability, visible focus, sufficient contrast, labelled form controls. |
| NFR-UX-003 | Colour SHALL never be the sole carrier of meaning (mastery, validation status, at-risk flags). |
| NFR-UX-004 | Long-running operations SHALL show determinate progress where a total is known. |

### 5.7 Maintainability

| ID | Requirement |
|---|---|
| NFR-MNT-001 | The codebase SHALL be a single TypeScript project with strict type checking enabled. |
| NFR-MNT-002 | LLM prompts SHALL live in dedicated, version-controlled modules, not inline in business logic. |
| NFR-MNT-003 | External providers (LLM, embeddings, vector store, graph store, file storage) SHALL sit behind interfaces with at least one alternative implementation each. |
| NFR-MNT-004 | Database schema changes SHALL be managed by versioned migrations. |

---

## 6. Evaluation and acceptance

### 6.1 Metrics the demo must actually produce

These are computed by the eval harness against the gold sets in §4.3.

| Metric | Definition | Target |
|---|---|---|
| **Bloom classification accuracy** | Agreement between tagger and human labels on the gold chunk set | ≥ 80 % |
| **CLO alignment precision** | Share of generated items an expert rates as genuinely assessing the target CLO | ≥ 85 % |
| **Retrieval hit-rate@8** | Share of labelled queries whose relevant chunk appears in the top 8 | ≥ 85 % |
| **Groundedness rate** | Share of generated items whose claims are all traceable to retrieved chunks | ≥ 95 % |
| **Validation rejection rate** | Share of raw generations blocked by the validation engine | Reported, not targeted |
| **Distractor quality** | Share of MCQ distractors an expert rates as plausible and non-giveaway | ≥ 80 % |

### 6.2 Metrics explicitly out of reach

The following SHALL NOT be claimed from this demonstration. They require a controlled study with a baseline, a sample-size calculation, and ethics approval.

- Learning gain (e.g. "18 % improvement")
- Quiz-quality uplift versus a human baseline (e.g. "+25 %")
- Recommendation relevance as a user-rated score at scale
- Lecture-planning time reduction as a statistically supported figure (a small n≈5 usability study may be reported, clearly labelled as underpowered)

Any report, slide, or thesis chapter produced from this system SHALL distinguish measured results (§6.1) from hypotheses (§6.2).

### 6.3 Acceptance criteria

The build is complete when all of the following hold:

**Setup**
1. `docker compose up` followed by the documented bootstrap command yields a running system with seeded curriculum, a synced knowledge graph, and a bootstrap admin.
2. The system runs end-to-end with `EMBEDDING_PROVIDER=local` and no embedding API key.

**Administration**
3. Admin can create a teacher and a student, enrol both in CS-201, and both can log in.
4. No route permits self-registration.
5. A student attempting a teacher or admin route receives 403, and the attempt appears in the audit log.

**Intelligence**
6. Teacher uploads a PDF; all six ingestion stages complete; progress is visible throughout; chunk count is non-zero.
7. Every produced chunk carries a topic, Bloom level, difficulty, LOM format, and confidence score.
8. The low-confidence review queue is populated and a teacher correction persists with `verifiedBy` set.
9. The knowledge graph renders visually and a prerequisite-closure query returns correct results.
10. A retrieval call with a CLO + Bloom filter returns only chunks matching that filter.

**Validation**
11. Generating 10 items produces at least one rejection, and the failure reasons are visible in the UI.
12. With enforcement on, a rejected item cannot be approved and cannot be served.

**Teacher engine**
13. A blueprint-driven generation produces validated MCQs and SAQs with source citations.
14. The lecture co-pilot produces a Bloom-ascending plan with citations and a formative check.
15. The CLO↔PLO matrix and the topic × Bloom coverage heatmap render, and zero-coverage cells are flagged.
16. The analytics dashboard shows cohort mastery and at-risk flags with the triggering rule displayed.

**Student engine**
17. An adaptive quiz serves only approved items and demonstrably changes difficulty in response to answers.
18. A deliberately wrong MCQ answer produces feedback naming the specific misconception, with a citation.
19. The learning plan reorders after mastery changes and respects prerequisites.
20. Points, a badge, and a streak are awarded and visible.

**Governance**
21. Every AI action in the demo appears in the audit log with model, prompt hash, and retrieved chunk IDs.
22. Chain verification passes; manually tampering with one row causes verification to fail and identify that row.
23. The curriculum validation console reports coverage gaps correctly.
24. The bias monitor produces per-slice metrics over the synthetic cohort.

**Evaluation**
25. The eval harness runs as one command and emits the §6.1 metrics with the sample sizes used.
26. The README states plainly which claims are measured and which are hypotheses.

---

## 7. Out of scope

The following are deliberately excluded from this demonstration and are documented as the path to production:

| Excluded | Reason |
|---|---|
| LTI 1.3 / LMS integration | Not needed for a single-course demo |
| SIS integration | Same |
| Institutional SSO (SAML/OIDC) and SCIM | Credentials auth is sufficient for the demo |
| Multi-tenancy | Single institution, single course |
| Real IRT calibration | Requires large-scale response data; Elo is used as a documented approximation |
| Trained at-risk prediction model | Requires historical outcome data; rules-based detection is used and labelled as such |
| Proctoring and identity verification | Out of scope |
| Mobile native applications | Responsive web only |
| Horizontal scaling, HA, Kubernetes | Single-machine deployment |
| Production compliance certification (FERPA/GDPR/EU AI Act conformity assessment) | Documented as prerequisites for production, not implemented |
| Copyrighted textbook ingestion | Only openly-licensed content is used |

---

## 8. Risks and mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Auto-tagger accuracy is too low, undermining every downstream filter | High | Measure against the gold set before building dependent features; route low-confidence chunks to human review; treat the review queue as a first-class feature |
| R2 | Generated items are plausible but pedagogically wrong | High | The validation engine plus mandatory teacher approval; ship rejection visibility so failures are seen, not hidden |
| R3 | Cold-start item bank makes adaptive selection meaningless | Medium | Seed difficulty from LLM priors and refine via Elo; disclose that this is not calibrated IRT |
| R4 | Retrieval returns topically relevant but Bloom-inappropriate content | Medium | Enforce metadata pre-filtering ahead of vector search; measure hit-rate@k under filter |
| R5 | LLM cost or latency makes the demo impractical | Medium | Per-tier model and effort configuration; prompt caching; bulk tier at low effort; local embedding option |
| R6 | Content licensing challenged | High | Open-licence corpus only; mandatory licensing note per upload |
| R7 | Stakeholders read demo metrics as efficacy results | High | Explicit measured-vs-hypothesis separation in the UI, the README, and every report |
| R8 | Gamification demotivates lower-performing students | Medium | Cohort-scoped, opt-in leaderboard; effort-weighted points; no public ranking by default |
| R9 | Synthetic cohort data is mistaken for real results | Medium | Persistent "synthetic" labelling in the UI and in exports |
| R10 | Prerequisite graph authored incorrectly, corrupting learning plans | Medium | Cycle detection at seed time; graph visualisation for faculty review |

---

## 9. Traceability

Each requirement ID in §3 maps to a design section in `design.md` and to a build phase in `prompt.md`. The mapping is maintained in `design.md` §14.
