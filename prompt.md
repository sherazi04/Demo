# Build Prompt — Metadata-Driven Dual-Engine Personalized Learning Framework

**How to use this file.** Copy the whole of §1 into your coding agent as the opening message, with `requirements.md` and `design.md` present in the same directory. Then work phase by phase using §4, pasting one phase at a time. §2, §3, §5 and §6 are hard constraints the agent must be reminded of whenever it drifts.

---

## 1. Master brief (paste this first)

> You are building a **Metadata-Driven Dual-Engine Personalized Learning Framework** — an AI system for Outcome-Based Education. It has four layers: a **Student Engine** (personalization, adaptivity, engagement), a **Teacher Engine** (instructional support, assessment, analytics), a shared **Intelligence Layer** (IEEE LOM metadata, a curriculum knowledge graph, Graph RAG, hybrid retrieval), and a **Governance Layer** (audit, RBAC, curriculum validation, bias monitoring) that oversees all outputs.
>
> **Two documents in this directory are authoritative. Read both fully before writing any code.**
> - `requirements.md` — what to build. Every requirement carries a stable ID (`FR-INT-001`, `NFR-SEC-002`, …). Reference these IDs in commit messages and code comments.
> - `design.md` — how to build it. Architecture, technology choices and their rationale, the complete data model, algorithms, API surface, UI structure, and a twelve-phase build order.
>
> **Scope:** a single course (CS-201 Data Structures & Algorithms) end to end, with all four layers genuinely implemented. Nothing is mocked or stubbed. Narrow the data, not the architecture.
>
> **The defining constraint of this system:** no AI-generated artifact reaches a learner without being traceable to a Course Learning Outcome, a Bloom's taxonomy level, and the specific source content it was grounded on. Every design decision serves that constraint.
>
> **Stack (do not substitute):** TypeScript 5.7 strict · Next.js 15 App Router (full-stack Node, route handlers as the API) · PostgreSQL 17 + pgvector + pg_trgm · Drizzle ORM · Neo4j 5 Community · Redis + BullMQ · Anthropic Claude via `@anthropic-ai/sdk` · Auth.js v5 Credentials · Zod · Tailwind + shadcn/ui · Recharts · `unpdf`/`mammoth` for parsing · Docker Compose for local infrastructure.
>
> **Three panels, one codebase:** `/student`, `/teacher`, `/admin` — visually distinct, sharing one component library. **There is no public sign-up.** An administrator provisions every teacher and student account and manages course enrolment.
>
> **Teachers must be able to upload course material at runtime** (PDF/DOCX/PPTX/TXT/MD). Upload triggers a six-stage asynchronous pipeline — parse → chunk → LOM-tag → embed → index → graph-link — with live per-stage progress in the UI. Newly indexed material becomes retrievable immediately, with no restart or redeploy.
>
> Work through the build order in `design.md` §15, one phase at a time. Do not start a phase until the previous one is verified against its "Verified by" column. Report what you did, what you verified, and anything you could not complete, at the end of every phase.

---

## 2. Hard constraints — never violate these

### 2.1 Anthropic API contract

Getting these wrong produces 400 errors or silently empty output. The SDK is `@anthropic-ai/sdk`.

| Rule | Detail |
|---|---|
| Model ID | `claude-opus-5` — exact string, **never** append a date suffix |
| Thinking | `thinking: { type: "adaptive" }`. On `claude-opus-5` thinking is **on by default**; set it explicitly for clarity |
| Reasoning depth | `output_config: { effort: "low"｜"medium"｜"high"｜"xhigh"｜"max" }` — nested inside `output_config`, **not** a top-level field |
| Sampling | **Never send `temperature`, `top_p`, or `top_k`.** All three are rejected with a 400 on this model. Steer with prompting |
| Prefill | **Never end `messages` with an assistant turn.** Rejected with a 400. Use structured output instead |
| Thinking budget | **Never send `budget_tokens`.** Rejected with a 400. Use `effort` |
| Structured output | `client.messages.parse({ …, output_config: { format: zodOutputFormat(Schema) } })`, importing `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. Read `response.parsed_output` — it can be `null`, so guard it |
| Streaming | Use `client.messages.stream()` + `finalMessage()` whenever `max_tokens` exceeds ~16 000 |
| `max_tokens` | Default to ~16 000 non-streaming, ~64 000 streaming. Do not lowball it |
| Prompt caching | `cache_control: { type: "ephemeral" }` on the **last stable system block**. Minimum cacheable prefix on `claude-opus-5` is **512 tokens**. Verify with `usage.cache_read_input_tokens` |
| Cache hygiene | **Nothing time-varying in the cached prefix** — no timestamps, no UUIDs, no request IDs. One varying byte invalidates the whole prefix |
| Refusals | **Always check `response.stop_reason` before reading `content`.** `"refusal"` returns HTTP 200 with empty or partial content. Treat it as an outcome: log it, surface it, do not throw |
| Errors | Catch the SDK's typed error classes (`Anthropic.RateLimitError`, `Anthropic.APIError`, …) — never string-match error messages |
| Embeddings | **Anthropic does not serve embeddings.** Use the provider adapter in `design.md` §6.3 |

### 2.2 Architecture rules

1. **Filter before you search.** Metadata pre-filtering (course, topic, CLO, Bloom band, difficulty, LOM format) is applied *in the same query* as the vector search. Never fall back to unfiltered ANN — the CLO-alignment claim depends on retrieved context matching the requested cognitive level.
2. **The generator never validates itself.** The judge tier is a separate call with a separate prompt. Single-call self-validation is prohibited.
3. **Rejections are visible, not swallowed.** A failed item is persisted with `status = 'rejected'` and a machine-readable failure list, and is shown in the teacher UI alongside accepted items.
4. **Only `approved` items are ever served to a student.** Enforce this in the service layer *and* with a database check constraint.
5. **RBAC is server-side.** One central guard used by every route handler, server action, and data-touching server component. Client-side hiding is presentation only.
6. **The audit log is append-only.** Enforce with a `BEFORE UPDATE OR DELETE` trigger that raises, plus hash chaining. Every AI call and every human approval/rejection/release gets a record.
7. **Postgres is the source of truth; Neo4j is a derived read model.** The graph is rebuildable from Postgres by one idempotent sync command.
8. **Prompts live in `src/intelligence/llm/prompts/*.ts`**, never inline in business logic.
9. **External providers sit behind interfaces** (LLM, embeddings, vector store, graph store, file storage) with at least one alternative implementation each.
10. **The system must run fully offline** with `EMBEDDING_PROVIDER=local` and no embedding API key.

### 2.3 Honesty rules

These are product requirements, not stylistic preferences.

1. **Never label the Elo difficulty estimate as IRT.** It is a documented approximation.
2. **Never label the at-risk rules as a predictive model.** They are inspectable heuristics, and the fired rule is displayed with every flag.
3. **Never present synthetic cohort data as real results.** It carries a persistent "synthetic" marker in the UI and in exports.
4. **Never claim learning gain, quiz-quality uplift, or recommendation relevance.** These need a controlled study. The eval harness must reproduce the out-of-reach list from `requirements.md` §6.2 verbatim.
5. **Every metric is printed with its sample size.**
6. **Every AI-generated artifact carries a visible AI-generated marker.**

---

## 3. Coding conventions

| Area | Convention |
|---|---|
| TypeScript | `strict: true`, `noUncheckedIndexedAccess: true`. No `any`. No non-null assertions except where provably safe with a comment |
| Modules | ESM. Path alias `@/*` → `src/*` |
| Validation | One Zod schema per structured shape, colocated with the feature, reused for both LLM structured output and runtime validation |
| Errors | Typed error classes in `src/lib/errors.ts` (`SchemaViolationError`, `ValidationBlockedError`, `ForbiddenError`, `IngestStageError`). Never throw bare strings |
| Database | All access through Drizzle. Migrations via drizzle-kit, committed. No raw SQL except where a Postgres feature demands it (HNSW index creation, trigram operators, the audit trigger) |
| IDs | UUID v4 from `gen_random_uuid()` |
| Time | `timestamptz` everywhere. Never store naive local time |
| Money/scores | `real` for 0–1 scores; never floats for anything that must be exact |
| Naming | Database `snake_case`; TypeScript `camelCase`; React components `PascalCase`; route segments `kebab-case` |
| Comments | Explain *why*, never *what*. A comment restating the next line is noise |
| Logging | Structured, with a correlation ID linking a user action to all downstream AI calls. Never log secrets, prompts, or student PII |
| Tests | Vitest for the algorithmic core: BKT update, Elo update, adaptive selection, RRF fusion, chain hashing, chunking, prerequisite cycle detection. UI tests are not required for the demo |
| Accessibility | Keyboard navigable, visible focus, labelled controls, sufficient contrast. Colour is never the sole carrier of meaning |

---

## 4. Phase prompts

Paste one at a time. Each ends with a **Definition of done** that must be satisfied before moving on.

### Phase 1 — Foundation

> Implement `design.md` §3 (repository layout), §4 (complete data model), and the Docker Compose stack.
>
> Deliver: `docker-compose.yml` (Postgres 17 + pgvector, Neo4j 5 Community, Redis 7), `infra/postgres-init.sql` enabling `vector`, `pg_trgm`, and `pgcrypto`, a Next.js 15 TypeScript project, `.env.example` covering every variable in `design.md`, a Zod-validated `src/lib/env.ts`, the full Drizzle schema across `src/db/schema/{auth,curriculum,content,assessment,learning,governance}.ts`, `drizzle.config.ts`, and a working migration.
>
> The `chunks` table must carry `embedding vector(1024)` with an HNSW cosine index, and a GIN trigram index on `text`. The `audit_log` table must have `prev_hash`/`hash` columns and the append-only trigger.
>
> **Definition of done:** `docker compose up -d` followed by `npm run db:migrate` succeeds on a clean machine; every table, enum, index, and the audit trigger exist; `npm run typecheck` passes.

### Phase 2 — Curriculum spine

> Author the CS-201 curriculum as declarative seed files under `data/curriculum/`, and implement the seeder and knowledge-graph sync.
>
> Content required: 1 program, 12 PLOs (standard engineering-computing set), 1 course (CS-201, 14 weeks, 3 credit hours), **8 CLOs** each with a Bloom level, a CLO↔PLO matrix with 1–3 strengths, **30 topics** spanning complexity analysis, linear structures, recursion, trees, heaps, hashing, searching, sorting, graphs, and algorithm-design strategies — assigned to weeks 1–14, an acyclic prerequisite edge set, CLO↔Topic mappings, and **at least 2 misconceptions per topic** each with a remediation hint.
>
> Implement `scripts/seed-curriculum.ts` (idempotent) and `scripts/sync-kg.ts` implementing the graph schema in `design.md` §5. The seeder must detect and reject a prerequisite cycle before writing anything.
>
> **Definition of done:** seed and sync run clean and are re-runnable; Neo4j Browser renders the CLO→PLO→Topic graph; the prerequisite-closure query in `design.md` §5.3 returns correct results for a topic with multi-level dependencies.

### Phase 3 — Auth and RBAC

> Implement Auth.js v5 with a Credentials provider, bcrypt password hashing, JWT sessions, and the RBAC guard from `design.md` §10.1.
>
> Build: bootstrap-admin creation from env on first run (`scripts/seed-users.ts`); admin user CRUD; CSV bulk import with a dry-run preview before commit; course enrolment management; account suspend/reactivate; an invite flow where a new user sets their own password on first login.
>
> Implement `requireUser`, `requireRole`, `requireCourseAccess`, and `requireSelf`. Every 403 must be written to the audit log with the attempted resource. **No route may permit self-registration.**
>
> **Definition of done:** admin logs in, creates a teacher and a student, enrols both in CS-201, and both can log in; a student requesting a teacher route receives 403 and the attempt appears in the audit log; a suspended account cannot log in.

### Phase 4 — Intelligence core

> Implement the LLM router (`design.md` §6.1), the embeddings adapter (§6.3), the vector store interface, the Neo4j query layer, and the full retrieval pipeline (§6.4).
>
> The router exposes three tiers — `generation`, `judge`, `bulk` — each resolving model and effort from `system_config` with `.env` fallback. It must honour every rule in §2.1 of this document, retry schema violations up to a limit, and emit a call record for the audit layer.
>
> The embeddings adapter needs three implementations: `voyage`, `openai` (any OpenAI-compatible endpoint), and `local` (deterministic hashed character-n-gram, L2-normalised, no network). The system must be fully functional with `local`.
>
> The retrieval pipeline implements: metadata filter → dense (pgvector HNSW) + lexical (pg_trgm) → graph expansion over `PREREQ_OF`/`ASSESSED_BY` → Reciprocal Rank Fusion (k=60) → optional rerank → assemble with chunk IDs, LOM metadata, and source locators.
>
> Expose `POST /api/retrieve` as a diagnostic route (teacher/admin only) so the pipeline is inspectable and the eval harness can drive it.
>
> **Definition of done:** a retrieval call with a CLO + Bloom filter returns only chunks matching that filter, every result carries a chunk ID and a source locator, and the whole thing works with `EMBEDDING_PROVIDER=local` and no API keys.

### Phase 5 — Ingestion pipeline

> Implement the six-stage ingestion pipeline from `design.md` §6.5 as BullMQ jobs in a separate worker process, plus the teacher upload UI.
>
> Stages: `parse` (unpdf / mammoth / PPTX) → `chunk` (structure-aware: split at headings and slide boundaries first, then pack to the target token size with overlap, never mid-sentence) → `tag` (bulk-tier LLM, structured output, batched, course CLO and topic lists in the cached prefix) → `embed` → `index` → `kg-link`.
>
> Each stage writes an `ingest_jobs` row with status, `items_done`, and `items_total`, and is independently retryable without re-uploading. Uploads require a licensing note and reject exact duplicates by SHA-256 within the same course.
>
> **A tagger response naming a topic or CLO that is not in the curriculum is a drift failure**: set `tag_confidence = 0` and push the chunk to the top of the review queue. Never silently accept it.
>
> **Definition of done:** a teacher uploads a PDF through the UI, all six stages complete with visible progress, chunk count is non-zero, every chunk carries a topic, Bloom level, difficulty, LOM format, and confidence score, and the new content is immediately retrievable via `/api/retrieve` with no restart.

### Phase 6 — Tag review

> Build the human-in-the-loop tag review queue: `GET /api/tags/queue` ordered by ascending `tag_confidence`, inline correction UI at `/teacher/tags`, and `PATCH /api/tags/:chunkId` setting `verified_by` and `verified_at`.
>
> Show the chunk text, its current tags, the tagger's reasoning, and the source locator side by side. Corrections must re-sync the affected knowledge-graph edges.
>
> **Definition of done:** the queue surfaces the lowest-confidence chunks first; a correction persists, sets `verified_by`, and updates the graph.

### Phase 7 — Validation engine

> **Build this before the features it measures.** Implement all six checks from `design.md` §7: `drift`, `bloom_match`, `clo_alignment`, `groundedness`, `single_answer`, `distractor_quality`.
>
> Order them cheapest-first; a `drift` failure short-circuits. The Bloom classifier must **not** be told the requested level. CLO alignment combines embedding similarity, a knowledge-graph path check, and a judge verdict. Groundedness gives the judge the item and *only* the source chunks and requires every factual claim to map to a chunk ID.
>
> Each check returns `{ passed, score, detail }`; the full report persists to `questions.validation`. With `ENFORCE_VALIDATION=true`, `status` cannot become `approved` unless `validation.passed` — guard this in the service layer **and** with a DB check constraint.
>
> Also scaffold `eval/` with the four metric scripts and `npm run eval`, even though there is nothing to measure yet.
>
> **Definition of done:** a deliberately mis-levelled item (a Remember-level question requested at Apply) is rejected by `bloom_match` with a correct explanation; an item citing a fact absent from its source chunks is rejected by `groundedness`; an item naming a topic outside the curriculum is rejected by `drift`; a rejected item cannot be approved through any code path.

### Phase 8 — Teacher engine

> Implement all six teacher features from `design.md` §9 and the routes in §11.
>
> **Assessment generator** — blueprint form (CLOs, Bloom mix, count, types, difficulty band) → per-item retrieval → generation-tier structured output → validation → persist. Generate **one item at a time with its own retrieval**, not one batch call. Stream per-item progress. The results view shows **accepted and rejected items side by side with failure reasons**.
>
> **Lecture co-pilot** — Bloom-ascending, time-boxed segments with duration, Bloom level, CLO, activity type, content, instructor notes, and cited chunk IDs. Assert that Bloom is non-decreasing across segments and that at least one segment is a formative assessment; regenerate once on violation, then warn.
>
> **Curriculum tools** — CLO↔PLO matrix, topic × Bloom coverage heatmap with zero-coverage cells flagged, prerequisite graph, per-CLO item-bank coverage.
>
> **Analytics** — cohort mastery, engagement, at-risk flags with the **triggering rule displayed**, most-missed items, most-triggered misconceptions.
>
> **Resource recommender** — LOM-filtered, ranked, with tags and locators shown.
>
> **AI co-teacher** — structured draft feedback the teacher edits and explicitly releases. Never auto-send; the release action is audited.
>
> **Definition of done:** a 10-item blueprint produces validated MCQs and SAQs with citations and at least one visible rejection; the lecture plan is Bloom-ascending and cited; the coverage heatmap correctly flags an empty topic × Bloom cell.

### Phase 9 — Student engine

> Implement all six student features from `design.md` §8 and §11.
>
> **BKT mastery** with the parameters in §8.1, `pGuess` derived per item type. **Elo difficulty** per §8.2 — comment in the code that this is not IRT. **Adaptive selection** per §8.3 including the Bloom cap, exposure control, and misconception-relevance boost. **Adaptive feedback** per §8.4 — name the misconception, explain the failure point, give the correct reasoning, cite the source, and escalate to a remediation step after 3 hits. **Learning plan** per §8.5 with prerequisite hoisting and a recorded `reason` for each regeneration. **Recommendations** filtered by current topic, mastery band, and Bloom level. **Gamification** per §8.6 with an append-only points ledger, difficulty-weighted points, no farming, badges, streaks, and an opt-in cohort-scoped leaderboard.
>
> Only `approved` items may be served. A student may access only their own data.
>
> **Definition of done:** an adaptive run visibly raises difficulty after a correct streak and lowers it after errors; a deliberately wrong MCQ answer produces feedback naming the specific misconception with a citation; the learning plan reorders after mastery changes and never places a topic ahead of an unmastered prerequisite; points, a badge, and a streak are awarded and visible.

### Phase 10 — Governance

> Implement `design.md` §10 in full.
>
> **Audit chain** — `audit.append()` inside a transaction taking a row lock on the latest record; hash over the canonical field concatenation; `verifyChain()` streaming in `seq` order and returning `{ ok, checked, firstBrokenSeq? }`. Every AI call and every human approve/reject/edit/release/config-change gets a record.
>
> **Immutability** — the `BEFORE UPDATE OR DELETE` trigger, plus a documented tamper test that disables the trigger, edits one row, re-enables, and shows verification failing and naming that row.
>
> **Bias monitor** — per-`cohort_tag` slice metrics (mean mastery, item accuracy, at-risk rate, recommendation distribution) with deviation flagging and persisted snapshots. `cohort_tag` must be reachable **only** through the admin-guarded bias-monitor service.
>
> **Curriculum validation console** — all eight checks in §10.4, each reporting the offending IDs.
>
> **Definition of done:** the demo's full AI activity appears in the audit log with model, prompt hash, and retrieved chunk IDs; chain verification passes; the tamper test fails verification and names the tampered row; the validation console correctly reports a coverage gap you introduce deliberately.

### Phase 11 — Panels

> Complete all three panels per `design.md` §12 with shadcn/ui, three distinct visual identities, and one shared component library.
>
> Apply the cross-cutting UI rules: every AI artifact carries a visible AI-generated marker; every synthetic record carries a synthetic marker; validation status uses an icon **and** a text label; mastery shows a bar **and** a numeric percentage; citations render as `section_path · pp. from–to` and link to chunk detail.
>
> Meet WCAG 2.2 AA: keyboard navigable, visible focus, labelled controls, sufficient contrast, colour never the sole signal.
>
> **Definition of done:** the full demo walkthrough in §5 of this document runs start to finish without touching an API client or the database directly.

### Phase 12 — Cohort and evaluation

> Implement `scripts/seed-cohort.ts` generating **40 synthetic students** with latent abilities across a realistic spread and four behaviour profiles (consistent, cramming, declining, disengaged). Responses are probabilistic on latent ability versus item difficulty, with misconception-biased distractor selection. Every synthetic record is labelled as such.
>
> Complete the eval harness per `design.md` §13: `bloom-accuracy.ts`, `retrieval-hit-rate.ts`, `clo-precision.ts`, `groundedness.ts`, `report.ts`. Author the gold sets under `data/gold/` at the minimum sizes in `requirements.md` §4.3.
>
> Write the README: setup, bootstrap, the demo script, the measured metrics with their sample sizes, and the **Known limitations** list from `design.md` §16 reproduced in full.
>
> **Definition of done:** `npm run eval` runs as one command and emits every metric in `requirements.md` §6.1 with its sample size; the report reproduces the §6.2 out-of-reach list verbatim; the README plainly separates measured results from hypotheses.

---

## 5. Demo walkthrough (the acceptance test)

The system is finished when this runs end to end through the UI alone, in about fifteen minutes.

1. **Admin** logs in, creates a teacher and a student, enrols both in CS-201.
2. **Admin → Validation console** shows the CLO↔PLO matrix and the corpus coverage heatmap.
3. **Neo4j Browser** renders the curriculum graph; run the prerequisite-closure query live.
4. **Teacher** uploads a supplementary PDF; all six ingestion stages complete with visible progress.
5. **Teacher → Tags** shows the low-confidence review queue; correct one tag and watch it persist.
6. **Teacher → Generate** builds a 10-item assessment for CLO-4 at Bloom "Apply". **Two items are rejected**, with their failure reasons shown next to the accepted ones. ← *this is the moment that lands*
7. **Teacher → Lecture** produces a Bloom-sequenced 90-minute plan with citations.
8. **Teacher** approves the passing items; they enter the bank.
9. **Student** takes an adaptive quiz. Answer correctly twice — difficulty rises. Then answer deliberately wrong.
10. Feedback **names the misconception**, explains the failure point, and cites the source.
11. **Student → Plan** reorders; mastery drops; a badge fires.
12. **Teacher → Analytics** now flags that student as at-risk, showing the rule that fired.
13. **Admin → Audit** replays the entire chain and verifies hash integrity.
14. **Tamper test:** edit one audit row directly, re-verify, and watch it fail and name that row.

---

## 6. Reminders to re-paste when the agent drifts

Short prompts to correct the most likely failure modes.

> **Retrieval:** Metadata filtering must be applied *in the same query* as the vector search, not as a post-filter on ANN results. Re-read `design.md` §6.4.

> **Validation:** The judge is a separate LLM call with a separate prompt. Do not let the generator validate its own output in the same call. Re-read `design.md` §7.

> **Anthropic API:** Remove `temperature`, `top_p`, `top_k`, and `budget_tokens` — all four are rejected with a 400 on `claude-opus-5`. Effort goes in `output_config: { effort }`, not top-level. Check `stop_reason` before reading `content`.

> **Rejections:** Do not filter rejected items out of the response. They must be persisted with their failure reasons and displayed in the teacher UI alongside accepted items. That visibility is the feature.

> **RBAC:** Hiding a link in the UI is not authorization. Every route handler and every data-touching server component calls the central guard.

> **Honesty:** Do not call the Elo estimate IRT. Do not call the at-risk rules a model. Do not present synthetic cohort data as results. Print sample sizes with every metric.

> **Prompt caching:** You put something time-varying in the cached prefix. Timestamps, UUIDs, and request IDs must sit *after* the last `cache_control` breakpoint, or the cache never hits. Verify with `usage.cache_read_input_tokens`.

> **Batching:** Generate assessment items one at a time with per-item retrieval. Batch generation degrades CLO alignment, which is the metric this whole system exists to defend.

---

## 7. What you still need to supply

The build can start immediately with placeholders, but these three items gate the reportable metrics.

| Item | Needed for | Minimum |
|---|---|---|
| Open-access textbook PDF | A real corpus | 1 book (e.g. *Open Data Structures*, CC BY) |
| Human Bloom labels | `bloom-accuracy` metric | 150 chunks |
| Expert-written CLO-tagged questions | `clo-precision` metric | 50 items |
| Labelled retrieval queries | `retrieval-hit-rate` metric | 40 queries |
| An embedding API key | Reportable retrieval figures | Voyage or any OpenAI-compatible endpoint |
| An Anthropic API key | Everything generative | — |

Without the gold sets the system still runs; the eval harness simply reports "no gold data" instead of a number. Do not let it report a fabricated one.
