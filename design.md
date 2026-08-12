# Design — Metadata-Driven Dual-Engine Personalized Learning Framework

**Document version:** 1.0
**Companion documents:** `requirements.md` (what to build), `prompt.md` (how to drive an AI coding agent to build it)
**Target:** Single-course, end-to-end demonstration; all four layers real.

---

## 1. Architecture

### 1.1 System diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Next.js 15 App Router — one TypeScript codebase, three panels   │
│                                                                  │
│   /student            /teacher             /admin                │
│   quiz, feedback,     upload, generate,    users, enrolment,     │
│   plan, progress,     lecture plan,        model config, audit,  │
│   recommendations,    curriculum, tag      chain verify, bias,   │
│   gamification        review, analytics    curriculum validation │
└───────────────────────────┬──────────────────────────────────────┘
                            │  Auth.js session → RBAC guard (server-side)
┌───────────────────────────▼──────────────────────────────────────┐
│  Route handlers  /api/*   +   Server Actions                     │
│                                                                  │
│  ┌──────────────────── VALIDATION ENGINE ─────────────────────┐  │
│  │  bloomCheck · cloAlignment · groundedness · singleAnswer   │  │
│  │  distractorQuality · driftCheck        (judge tier LLM)    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────── INTELLIGENCE LAYER ────────────────────┐  │
│  │  retrieve() : filter → hybrid(dense+lexical) → graph       │  │
│  │               expand → fuse → rerank → assemble+cite       │  │
│  │  llm.generation / llm.judge / llm.bulk   (tiered router)   │  │
│  │  embeddings.embed()  (voyage | openai | local)             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  audit.append()  — hash-chained, append-only, every AI call      │
└───┬─────────────────────┬──────────────────┬─────────────────────┘
    │                     │                  │
┌───▼──────────┐  ┌───────▼───────┐  ┌───────▼────────┐  ┌────────────┐
│ PostgreSQL   │  │ Neo4j         │  │ Redis + BullMQ │  │ Anthropic  │
│ + pgvector   │  │ curriculum    │  │ ingestion jobs │  │ Claude API │
│ + pg_trgm    │  │ knowledge     │  │                │  │            │
│ relational + │  │ graph         │  │                │  │ Embeddings │
│ vector index │  │               │  │                │  │ provider   │
└──────────────┘  └───────────────┘  └────────────────┘  └────────────┘
                                             │
                                    ┌────────▼─────────┐
                                    │ Worker process   │
                                    │ parse→chunk→tag  │
                                    │ →embed→index→KG  │
                                    └──────────────────┘
```

### 1.2 Three deliberate deviations from the source architecture diagram

| Source diagram says | This design uses | Rationale |
|---|---|---|
| FAISS semantic search | **pgvector** primary, FAISS-compatible interface retained | FAISS is a library, not a service: no metadata-filtered query, no CRUD/upsert, no persistence guarantees, no replication. The system's entire premise is *metadata-filtered* retrieval, which is FAISS's weakest point. pgvector gives filtered ANN in the same transaction as the metadata. The `VectorStore` interface keeps an alternate implementation possible so the architecture claim stays honest. |
| GPT-3.5 / Phi-4 / Mistral | **Tiered router, `claude-opus-5` default**, provider-swappable | GPT-3.5 is a legacy model well behind current models on instruction-following and structured output — precisely what CLO-constrained generation needs. The router keeps the multi-model idea (three independently configurable tiers) while defaulting to a model that can actually hold the constraint. |
| Implicit single-pass generation | **Separate judge tier** | A generator cannot validate itself. The judge is a distinct call with a distinct prompt, and it is what backs the accuracy claim. |

---

## 2. Technology stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.7, `strict: true`, `noUncheckedIndexedAccess` | One language across UI, API, worker, and scripts |
| Framework | Next.js 15 (App Router) | Full-stack Node; route handlers are the API; server components keep data access server-side by default |
| Runtime | Node 20.11+ | Native `fetch`, stable ESM |
| Relational DB | PostgreSQL 17 | Transactional integrity for the curriculum spine |
| Vector index | pgvector (HNSW, cosine) | Filtered ANN in the same query as metadata predicates |
| Lexical index | pg_trgm GIN | Lexical half of hybrid retrieval without a second service |
| ORM | Drizzle ORM + drizzle-kit | First-class `vector` column type; SQL-shaped, no hidden query magic |
| Graph DB | Neo4j 5 Community | Cypher for prerequisite closure; Neo4j Browser is a genuinely useful demo visual |
| Queue | BullMQ + Redis | Multi-stage, resumable ingestion with per-stage progress |
| LLM | Anthropic Claude via `@anthropic-ai/sdk` | Structured output, prompt caching, adaptive thinking, effort control |
| Embeddings | Adapter: Voyage AI ▸ OpenAI-compatible ▸ local | Anthropic serves no embeddings endpoint; local option makes the demo runnable offline |
| Auth | Auth.js v5 (NextAuth), Credentials provider, JWT sessions | Admin-provisioned accounts only |
| Password hashing | bcrypt | Standard, no ambiguity |
| Validation | Zod | One schema definition drives both runtime validation and LLM structured output |
| Styling | Tailwind CSS + shadcn/ui (Radix) | Three visually distinct panels from one accessible component set |
| Charts | Recharts | Analytics and coverage heatmaps |
| Document parsing | `unpdf` (PDF), `mammoth` (DOCX), custom PPTX reader | Pure Node, no Python dependency |
| Dev orchestration | Docker Compose | One command to stand up Postgres, Neo4j, Redis |

### 2.1 Why not a Python service

The only genuinely Python-favoured pieces are document parsing and local model inference. `unpdf` and `mammoth` cover parsing in Node, and both embeddings and generation are HTTP calls. A Python sidecar would add a second runtime, a second dependency tree, and a network hop for no capability gain at this scale.

---

## 3. Repository layout

```
dual-engine/
├── docker-compose.yml
├── .env.example
├── requirements.md · design.md · prompt.md · README.md
├── drizzle.config.ts · next.config.ts · tailwind.config.ts · tsconfig.json
│
├── infra/
│   └── postgres-init.sql              # vector, pg_trgm, pgcrypto extensions
│
├── data/
│   ├── curriculum/                    # declarative seed — swap to retarget the course
│   │   ├── program.ts  plos.ts  course.ts  clos.ts
│   │   ├── topics.ts   prereqs.ts  clo-topics.ts  misconceptions.ts
│   ├── gold/                          # evaluation ground truth
│   │   ├── bloom-gold.jsonl           # ≥150 human-labelled chunks
│   │   ├── expert-questions.jsonl     # ≥50 expert-written CLO-tagged items
│   │   └── retrieval-queries.jsonl    # ≥40 queries with relevant chunk ids
│   └── uploads/                       # runtime file storage (gitignored)
│
├── scripts/
│   ├── migrate.ts  seed-curriculum.ts  seed-users.ts  seed-cohort.ts
│   ├── sync-kg.ts  ingest.ts  run-eval.ts  verify-chain.ts  demo-reset.ts
│
├── src/
│   ├── db/
│   │   ├── client.ts
│   │   └── schema/  auth.ts curriculum.ts content.ts assessment.ts
│   │                learning.ts governance.ts index.ts
│   ├── lib/
│   │   ├── env.ts  logger.ts  ids.ts  hash.ts  errors.ts
│   ├── intelligence/
│   │   ├── llm/      client.ts  router.ts  tiers.ts  schemas.ts
│   │   │             prompts/{tagger,question,lecture,feedback,judge,coteacher}.ts
│   │   ├── embeddings/ index.ts  voyage.ts  openai.ts  local.ts
│   │   ├── vector/     store.ts  pgvector.ts
│   │   ├── kg/         driver.ts  schema.cypher  sync.ts  queries.ts
│   │   ├── retrieval/  filter.ts  hybrid.ts  graph-expand.ts  fuse.ts
│   │   │               rerank.ts  assemble.ts  index.ts
│   │   └── ingest/     parse.ts  chunk.ts  tag.ts  embed.ts  index-chunks.ts
│   ├── validation/
│   │   ├── bloom.ts  clo-alignment.ts  groundedness.ts
│   │   ├── distractors.ts  single-answer.ts  drift.ts  engine.ts
│   ├── teacher/  assessment-gen.ts  lecture-copilot.ts  curriculum.ts
│   │             analytics.ts  recommender.ts  coteacher.ts
│   ├── student/  adaptive.ts  bkt.ts  feedback.ts  learning-plan.ts
│   │             recommendations.ts  gamification.ts
│   ├── governance/ audit.ts  chain.ts  rbac.ts  bias-monitor.ts
│   │               curriculum-validation.ts
│   ├── worker/   index.ts  queues.ts  processors/{parse,chunk,tag,embed,index,kg}.ts
│   ├── auth/     config.ts  guard.ts  password.ts
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (student)/student/{dashboard,quiz,plan,progress,resources}/
│   │   ├── (teacher)/teacher/{dashboard,materials,tags,generate,bank,
│   │   │                       lecture,curriculum,analytics,feedback}/
│   │   ├── (admin)/admin/{users,enrolment,settings,audit,bias,validation}/
│   │   └── api/ ...                    # see §11
│   └── components/  ui/ (shadcn)  charts/  domain/
└── eval/
    ├── bloom-accuracy.ts  clo-precision.ts  retrieval-hit-rate.ts
    ├── groundedness.ts    report.ts
```

---

## 4. Data model (PostgreSQL)

Primary keys are UUID v4 via `gen_random_uuid()`. Timestamps are `timestamptz`.

### 4.1 Identity and access

**`users`** — `id`, `email` (unique), `name`, `password_hash` (bcrypt, null while `invited`), `role` (`student|teacher|admin`), `status` (`invited|active|suspended`), `external_id`, `cohort_tag`, `created_by`, `last_login_at`, `created_at`, `updated_at`

> `cohort_tag` is a coarse demographic bucket read **only** by the bias monitor. It is never joined into any teacher- or student-facing query.

**`enrollments`** — PK (`user_id`, `course_id`), `role`, `enrolled_at`

### 4.2 Curriculum spine

| Table | Key columns |
|---|---|
| `programs` | `code`, `title`, `accreditation_body` |
| `plos` | `program_id`, `code`, `statement`, `ordinal` |
| `courses` | `program_id`, `code`, `title`, `credit_hours`, `weeks` |
| `clos` | `course_id`, `code`, `statement`, `bloom_level` (1–6), `weight`, `ordinal` |
| `clo_plo_map` | PK (`clo_id`, `plo_id`), `strength` (1–3) |
| `topics` | `course_id`, `code`, `title`, `week`, `ordinal`, `summary` |
| `topic_prereqs` | PK (`topic_id`, `prereq_topic_id`) — acyclic, enforced at seed |
| `clo_topics` | PK (`clo_id`, `topic_id`) |
| `misconceptions` | `topic_id`, `code`, `description`, `remediation` |

### 4.3 Content and metadata

**`materials`** — `course_id`, `uploaded_by`, `title`, `kind`, `filename`, `mime_type`, `size_bytes`, `storage_path`, `content_hash` (sha256), `license_note`, `status` (`uploaded|parsing|chunking|tagging|embedding|indexed|failed`), `progress`, `error`, `page_count`, `chunk_count`, `supersedes_id`, `created_at`, `indexed_at`

**`chunks`** — the central table.

| Group | Columns |
|---|---|
| Identity | `id`, `material_id`, `course_id`, `ordinal` |
| Content | `text`, `token_count` |
| Locator | `page_from`, `page_to`, `section_path` |
| IEEE LOM | `topic_id`, `bloom_level` (1–6), `difficulty` (0–1), `lom_format`, `resource_type`, `tag_confidence` (0–1), `lom` (jsonb, full record) |
| Review | `verified_by`, `verified_at` |
| Retrieval | `embedding vector(1024)`, `embedding_model` |

Indexes: `hnsw (embedding vector_cosine_ops)`, `gin (text gin_trgm_ops)`, btree on `(course_id, bloom_level)`, `topic_id`, `material_id`.

`lom_format` vocabulary: `definition | worked_example | proof | exercise | figure | code | narrative`.

**`chunk_clos`** — PK (`chunk_id`, `clo_id`), `relevance` (0–1)

**`ingest_jobs`** — `material_id`, `stage`, `status`, `message`, `items_total`, `items_done`, `started_at`, `finished_at`

### 4.4 Assessment

**`questions`**

| Group | Columns |
|---|---|
| Identity | `id`, `course_id`, `clo_id`, `topic_id`, `type` (`mcq|saq|numeric|code`) |
| Bloom | `target_bloom` (requested), `measured_bloom` (classifier output) |
| Content | `stem`, `options` (jsonb), `reference_answer`, `rubric` (jsonb), `explanation` |
| Difficulty | `difficulty_prior` (LLM estimate), `difficulty_elo`, `times_served`, `times_correct` |
| Provenance | `source_chunk_ids` (jsonb array), `generated_by_model`, `validation` (jsonb) |
| Lifecycle | `status` (`draft|rejected|pending|approved|retired`), `reviewed_by`, `reviewed_at`, `review_note` |

`options` element shape:
```ts
{ key: "A"|"B"|"C"|"D", text: string, correct: boolean,
  misconceptionCode?: string, rationale: string }
```

`validation` shape:
```ts
{ passed: boolean,
  checks: Array<{ name: "bloom_match"|"clo_alignment"|"groundedness"
                      |"distractor_quality"|"single_answer"|"drift",
                  passed: boolean, score: number, detail: string }>,
  failures: string[], judgeModel: string }
```

**`assessments`** — `course_id`, `created_by`, `title`, `blueprint` (jsonb), `published`
**`assessment_items`** — `assessment_id`, `question_id`, `ordinal`, `points`
**`attempts`** — `student_id`, `course_id`, `assessment_id?`, `mode` (`adaptive|assessment|practice`), `target_clo_id?`, `items_planned`, `items_answered`, `score`, `started_at`, `finished_at`
**`attempt_items`** — `attempt_id`, `question_id`, `ordinal`, `response`, `correct`, `misconception_id?`, `feedback`, `response_ms`, `served_difficulty`, `answered_at`

### 4.5 Learning state

**`topic_mastery`** — PK (`student_id`, `topic_id`), `p_known` (0–1), `observations`, `last_correct`, `updated_at`
**`clo_mastery`** — PK (`student_id`, `clo_id`), `p_known`, `updated_at` (derived: weighted mean of constituent topic mastery)
**`learning_plans`** — `student_id`, `course_id`, `steps` (jsonb ordered array), `generated_at`, `reason`
**`misconception_hits`** — PK (`student_id`, `misconception_id`), `count`, `last_hit_at`, `cleared_at`
**`points_ledger`** — `student_id`, `delta`, `reason`, `question_id?`, `created_at` (append-only; the balance is a SUM, never a mutable counter)
**`badges`** — `student_id`, `code`, `awarded_at` (unique on the pair)
**`streaks`** — PK `student_id`, `current`, `longest`, `last_active_date`
**`leaderboard_optin`** — PK `student_id`, `opted_in`, `updated_at`

### 4.6 Governance

**`audit_log`** — append-only.

| Column | Purpose |
|---|---|
| `id`, `seq` (bigserial) | Ordering |
| `actor_id`, `actor_role` | Who |
| `action` | e.g. `question.generate`, `question.approve`, `chunk.tag`, `config.update` |
| `resource_type`, `resource_id` | What |
| `model`, `effort` | Which model produced it |
| `prompt_hash` | sha256 of the rendered prompt |
| `retrieved_chunk_ids` (jsonb) | Exactly what context was used |
| `output_hash` | sha256 of the output |
| `input_tokens`, `output_tokens`, `latency_ms` | Cost/perf |
| `outcome` | `ok | refusal | error` |
| `payload` (jsonb) | Small structured detail (never raw prompts, never PII) |
| `prev_hash`, `hash` | The chain |
| `created_at` | When |

Chain rule:
```
hash = sha256( prev_hash ‖ seq ‖ actor_id ‖ action ‖ resource_id ‖
               model ‖ prompt_hash ‖ output_hash ‖ created_at_iso )
```
The first record's `prev_hash` is `AUDIT_CHAIN_SEED`. Immutability is enforced by a `BEFORE UPDATE OR DELETE` trigger that raises an exception, plus a DB role with `INSERT, SELECT` only on this table.

**`system_config`** — `key`, `value` (jsonb), `updated_by`, `updated_at`. Holds runtime model/effort/retrieval settings. Writes emit an audit record with before/after.
**`bias_snapshots`** — `computed_at`, `slice_key`, `metric`, `value`, `cohort_mean`, `deviation`, `flagged`

---

## 5. Knowledge graph (Neo4j)

### 5.1 Schema

```
(:Program {id, code, title})
(:PLO     {id, code, statement, ordinal})
(:Course  {id, code, title})
(:CLO     {id, code, statement, bloomLevel, weight})
(:Topic   {id, code, title, week, ordinal})
(:Misconception {id, code, description})
(:LearningObject {id, bloomLevel, difficulty, lomFormat, materialId})

(:Program)-[:HAS_PLO]->(:PLO)
(:Program)-[:OFFERS]->(:Course)
(:Course)-[:HAS_CLO]->(:CLO)
(:Course)-[:COVERS]->(:Topic)
(:CLO)-[:MAPS_TO {strength}]->(:PLO)
(:CLO)-[:ASSESSED_BY]->(:Topic)
(:Topic)-[:PREREQ_OF]->(:Topic)
(:Topic)-[:HAS_MISCONCEPTION]->(:Misconception)
(:LearningObject)-[:EVIDENCE_FOR {relevance}]->(:CLO)
(:LearningObject)-[:ABOUT]->(:Topic)
```

Constraints: `CREATE CONSTRAINT ... REQUIRE n.id IS UNIQUE` on every label.

### 5.2 Sync

`scripts/sync-kg.ts` is idempotent: it `MERGE`s all nodes and relationships from Postgres, then deletes orphans whose Postgres row no longer exists. Run after curriculum seed and after each ingestion batch. Postgres is the source of truth; Neo4j is a derived read model.

### 5.3 Queries used by the system

| Purpose | Cypher shape |
|---|---|
| Prerequisite closure | `MATCH (p:Topic)-[:PREREQ_OF*1..N]->(t:Topic {id:$id}) RETURN DISTINCT p` |
| Forward dependents | `MATCH (t:Topic {id:$id})-[:PREREQ_OF*1..N]->(d:Topic) RETURN DISTINCT d` |
| CLO sibling topics | `MATCH (c:CLO {id:$id})-[:ASSESSED_BY]->(t:Topic) RETURN t` |
| Graph expansion for RAG | `MATCH (t:Topic) WHERE t.id IN $seeds MATCH (t)-[:PREREQ_OF|ASSESSED_BY*0..$hops]-(n:Topic) RETURN DISTINCT n.id` |
| CLO→PLO trace | `MATCH path=(c:CLO {id:$id})-[:MAPS_TO]->(p:PLO) RETURN path` |
| Coverage gap | `MATCH (t:Topic) WHERE NOT (:LearningObject)-[:ABOUT]->(t) RETURN t` |

Cycle detection at seed time:
`MATCH (t:Topic)-[:PREREQ_OF*1..]->(t) RETURN t` must return zero rows.

---

## 6. Intelligence layer

### 6.1 LLM router

Three named tiers, each independently configured from `system_config` with `.env` fallbacks:

| Tier | Job | Default model | Default effort |
|---|---|---|---|
| `generation` | Questions, lecture plans, feedback, explanations | `claude-opus-5` | `high` |
| `judge` | CLO/Bloom/groundedness/distractor validation | `claude-opus-5` | `high` |
| `bulk` | LOM metadata tagging during ingestion | `claude-opus-5` | `low` |

The tiers are separate so an operator can move `bulk` to a cheaper model without touching generation quality, and so `judge` can be pinned independently of `generation`.

**Anthropic API contract this design assumes** (`@anthropic-ai/sdk`):

- Model IDs are exact strings with no date suffix: `claude-opus-5`.
- Adaptive thinking: `thinking: { type: "adaptive" }`. On `claude-opus-5` thinking is **on by default** — omitting the field runs adaptive. Set it explicitly for clarity.
- Reasoning depth: `output_config: { effort: "low"|"medium"|"high"|"xhigh"|"max" }` — nested inside `output_config`, not top-level.
- **`temperature`, `top_p`, `top_k` are rejected with a 400.** Do not send them. Steer with prompting.
- **Assistant-turn prefills are rejected with a 400.** Use structured output instead.
- **`budget_tokens` is rejected with a 400.** Use `effort`.
- Structured output: `client.messages.parse({ ..., output_config: { format: zodOutputFormat(Schema) } })`, with `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. Read `response.parsed_output` (may be null — guard it).
- Prompt caching: `cache_control: { type: "ephemeral" }` on the last stable system block. Minimum cacheable prefix on `claude-opus-5` is 512 tokens. Verify with `usage.cache_read_input_tokens`.
- Streaming: use `client.messages.stream()` and `finalMessage()` whenever `max_tokens` exceeds ~16 000.
- **Always check `response.stop_reason` before reading `content`.** A value of `"refusal"` is a normal HTTP 200 with empty or partial content; treat it as an outcome, log it, surface it, do not throw.

**Router responsibilities**

1. Resolve tier → `{ model, effort }` from `system_config`, falling back to env.
2. Build the request: system blocks (stable prefix cached) + user content.
3. Attach the Zod-derived output schema where structured output is required.
4. Retry on schema-validation failure up to `LLM_SCHEMA_RETRIES` (default 2), then throw a typed `SchemaViolationError`.
5. Retry on 429/5xx with exponential backoff.
6. Record `{ model, effort, promptHash, inputTokens, outputTokens, latencyMs, outcome }` and hand it to `audit.append()`.

### 6.2 Prompt structure (shared across features)

Every generation prompt is assembled in the same order so the cached prefix is stable:

```
system[0]  Role + OBE framing + Bloom definitions + hard constraints   ← cached
system[1]  Course context: CLO statements, topic list, Bloom ceiling    ← cached
system[2]  Task-specific instruction block
user       Retrieved chunks (with ids + locators) + the concrete request
```

Volatile content (the request, the retrieved chunks) always sits **after** the cache breakpoint. Nothing time-varying — no timestamps, no UUIDs, no per-request IDs — may appear in `system[0]` or `system[1]`, or caching silently never hits.

Prompts live in `src/intelligence/llm/prompts/*.ts` as exported template functions, never inline in business logic.

### 6.3 Embeddings adapter

```ts
interface EmbeddingProvider {
  readonly id: "voyage" | "openai" | "local";
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}
```

| Implementation | Notes |
|---|---|
| `voyage` | `POST https://api.voyageai.com/v1/embeddings`; `input_type: "document"｜"query"`; batches of 128 |
| `openai` | Any OpenAI-compatible `/v1/embeddings` (OpenAI, Azure, vLLM, Ollama) |
| `local` | Deterministic hashed character-n-gram bag projected to `EMBEDDING_DIMENSIONS`, L2-normalised. No network, no key. Weaker recall — sufficient to run and demonstrate the full pipeline offline; **not** what the reported hit-rate figures should be measured on. |

Dimension changes require a re-embed of the corpus; the `embedding_model` column on `chunks` makes stale rows detectable.

### 6.4 Retrieval pipeline

```
retrieve(query, filter, options) → RetrievalResult[]

1. FILTER      SQL predicate: course_id, topic_id ∈ set, clo_id via chunk_clos,
               bloom_level ∈ band, difficulty ∈ band, lom_format ∈ set
2. DENSE       embed(query, "query") → ORDER BY embedding <=> $q LIMIT vectorK
                                       (HNSW, filter applied in the same query)
3. LEXICAL     similarity(text, $q) via pg_trgm → LIMIT lexicalK
4. GRAPH       seed topics = topics of steps 2–3 hits
               → Cypher expand PREREQ_OF / ASSESSED_BY up to graphHops
               → pull additional chunks ABOUT those topics
5. FUSE        Reciprocal Rank Fusion:  score(d) = Σ 1 / (k + rank_i(d)), k = 60
               Graph-only hits enter with a configurable rank penalty.
6. RERANK      optional cross-encoder (Voyage rerank) or LLM listwise rerank
7. ASSEMBLE    dedupe by chunk id, cap at finalK, attach
               { id, text, topic, cloIds, bloomLevel, difficulty,
                 lomFormat, pageFrom, pageTo, sectionPath }
```

Every downstream consumer receives chunk IDs and locators, which is what makes citation and groundedness checking possible at all.

**Filter-first is non-negotiable.** A Bloom-filtered query must never fall back to unfiltered ANN, because the entire CLO-alignment claim rests on the retrieved context actually matching the requested cognitive level.

### 6.5 Ingestion pipeline

Six BullMQ stages, each idempotent and independently retryable:

| Stage | Input | Output | Notes |
|---|---|---|---|
| `parse` | Uploaded file | Text blocks with page/section locators | `unpdf` / `mammoth` / PPTX reader |
| `chunk` | Text blocks | Chunk rows | Structure-aware: split at headings and slide boundaries first, then pack to `CHUNK_TARGET_TOKENS` with `CHUNK_OVERLAP_TOKENS` overlap; never split mid-sentence |
| `tag` | Chunk rows | LOM metadata per chunk | Bulk-tier LLM, structured output, batched ~10 chunks/call, course CLO+topic list in the cached prefix |
| `embed` | Chunk text | Vectors | Provider batch size; writes `embedding` + `embedding_model` |
| `index` | — | — | Ensures HNSW/GIN indexes; refreshes stats |
| `kg-link` | Chunk metadata | `LearningObject` nodes + `ABOUT`/`EVIDENCE_FOR` edges | Idempotent MERGE |

Each stage writes an `ingest_jobs` row with `items_done`/`items_total`. The teacher panel polls (or subscribes to) that table.

**Tagger output schema:**
```ts
z.object({
  topicCode: z.string(),                 // must exist in this course
  bloomLevel: z.number().int().min(1).max(6),
  difficulty: z.number().min(0).max(1),
  lomFormat: z.enum(["definition","worked_example","proof",
                     "exercise","figure","code","narrative"]),
  resourceType: z.string(),
  cloCodes: z.array(z.string()),         // must exist in this course
  keywords: z.array(z.string()).max(8),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(400),
})
```
A returned `topicCode` or `cloCode` not present in the curriculum is a **drift failure**: the chunk is marked `tag_confidence = 0` and pushed to the top of the review queue rather than silently accepted.

---

## 7. Validation engine

The subsystem that makes the accuracy claim measurable. Runs on every generated item before it can be approved.

```ts
validate(item, context) → ValidationReport
```

| Check | Method | Fails when |
|---|---|---|
| `drift` | Set membership against the curriculum spine | The item's topic or CLO is not in the approved curriculum |
| `bloom_match` | Judge-tier LLM classifies the item's cognitive demand independently of the generator; the classifier is **not told** the requested level | `measured_bloom ≠ target_bloom` |
| `clo_alignment` | (a) cosine similarity between item embedding and CLO statement embedding; (b) graph check that the item's topic is `ASSESSED_BY`-linked to the CLO; (c) judge-tier verdict with justification. Combined score. | Combined score < `CLO_ALIGN_THRESHOLD` (default 0.75) |
| `groundedness` | Judge-tier LLM receives the item and *only* the source chunks; must map every factual claim to a chunk id | Any claim is unsupported |
| `single_answer` | Judge-tier LLM evaluates each option independently for defensibility | Zero, or more than one, defensible correct option |
| `distractor_quality` | Judge-tier LLM rates each distractor for plausibility, giveaway cues (length, absolutes, grammar mismatch), and misconception mapping | Any distractor implausible or a giveaway |

Ordering is cheapest-first: `drift` (free, set lookup) → `clo_alignment` embedding half (cheap) → the judge-tier checks (expensive). A `drift` failure short-circuits.

Each check returns `{ passed, score, detail }`. The full report is persisted on `questions.validation`.

**Enforcement:** with `ENFORCE_VALIDATION=true`, `status` may not transition to `approved` unless `validation.passed` is true. The transition is guarded in the service layer *and* by a DB check constraint, so a direct SQL write cannot bypass it.

**Rejections are shown, not swallowed.** The teacher UI lists rejected items with their failure reasons next to accepted ones. This is a deliberate product decision: it is what makes the validation engine visible rather than a claim.

---

## 8. Student engine algorithms

### 8.1 Mastery — Bayesian Knowledge Tracing

Per (student, topic), four standard parameters:

| Parameter | Meaning | Default |
|---|---|---|
| `pInit` | Prior probability of mastery | 0.15 |
| `pTransit` | P(learn on this opportunity) | 0.12 |
| `pSlip` | P(wrong given mastered) | 0.10 |
| `pGuess` | P(right given not mastered) | 1 / optionCount (0.25 for 4-option MCQ) |

Update on each response:

```
correct:    P(L|obs) = pL·(1−pSlip) / ( pL·(1−pSlip) + (1−pL)·pGuess )
incorrect:  P(L|obs) = pL·pSlip     / ( pL·pSlip     + (1−pL)·(1−pGuess) )

pL' = P(L|obs) + (1 − P(L|obs))·pTransit
```

`pGuess` is derived per item type, so a 4-option MCQ and an SAQ do not share a guess rate.

**CLO mastery** is the topic-mastery mean over the CLO's linked topics, weighted by that topic's item exposure. Displayed as a 0–100 bar with a text label (never colour alone).

### 8.2 Item difficulty — Elo, explicitly not IRT

Each item carries `difficulty_elo ∈ [0,1]`, initialised from the generator's `difficulty_prior`. Each student carries a per-topic ability derived from `p_known`. On each response:

```
expected = 1 / (1 + 10^((difficulty − ability) / 0.4))
difficulty' = clamp(difficulty + K·(expected − actual), 0, 1)
K = 0.03 while times_served < 30, then 0.01
```

**This is a calibrated-difficulty approximation, not Item Response Theory.** Real 2PL/3PL IRT requires a large response matrix. Any report must state this.

### 8.3 Adaptive item selection

```
selectNext(student, topic):
  ability   = p_known(student, topic)
  targetDiff= clamp(ability + 0.05, 0.15, 0.9)      # slight desirable difficulty
  bloomCap  = 1 + floor(ability × 5)                # mastery gates cognitive level

  candidates = approved items
             WHERE topic_id = topic
               AND target_bloom <= min(bloomCap, clo.bloom_level)
               AND id NOT IN last 20 items served to this student
               AND (times_served, this student) = 0     # no repeats within a run

  score(item) = −|item.difficulty_elo − targetDiff|
              − 0.15 × exposureRate(item)               # spread the bank
              + 0.10 × misconceptionRelevance(item, student)

  return argmax(score)  # ties broken randomly
```

`misconceptionRelevance` boosts items whose distractors target a misconception this student has recently triggered — turning the bank into targeted remediation rather than random practice.

Termination: item count reached, `p_known ≥ 0.85` sustained over 3 consecutive correct responses, or student exit. All three paths persist a summary.

### 8.4 Adaptive feedback

On an incorrect MCQ response:

1. Look up the chosen option's `misconceptionCode`.
2. Resolve it to a `misconceptions` row → increment `misconception_hits`.
3. Retrieve the source chunk(s) supporting the correct reasoning.
4. Generation-tier LLM produces feedback with a fixed structure:
   - what the student's reasoning appears to be
   - the specific point at which it fails
   - the correct reasoning path
   - a citation (`section_path`, page range)
   - one concrete next step
5. Persist to `attempt_items.feedback`.
6. If the same misconception has been hit ≥ 3 times, insert a remediation step at the head of the learning plan.

No feedback ever names or reveals an unserved item.

### 8.5 Learning plan

```
buildPlan(student, course):
  1. topics ← all course topics with current p_known
  2. unmastered ← { t : p_known(t) < 0.7 }
  3. eligible ← { t ∈ unmastered : all prereqs(t) have p_known ≥ 0.7 }
  4. blocked  ← unmastered \ eligible
  5. order eligible by (course ordinal, then ascending p_known)
  6. for each blocked topic, hoist its unmastered prereqs ahead of it
  7. insert active remediation steps (misconception hits ≥ 3) at the head
  8. insert a milestone marker at each CLO boundary
```

Regenerated whenever mastery crosses a threshold or a remediation is triggered. `learning_plans.reason` records why the plan changed, which is what makes the reordering legible to the student rather than mysterious.

### 8.6 Gamification

| Rule | Detail |
|---|---|
| Points | `round(10 × (0.5 + difficulty_elo))` on a first correct answer to an item |
| No farming | Zero points for an item already answered correctly, or for a topic at `p_known ≥ 0.85` |
| Badges | `first_clo_mastered`, `streak_7`, `misconception_cleared`, `topic_perfect`, `prereq_unblocked` |
| Streak | Increments once per calendar day with ≥ 1 answered item; resets after a missed day |
| Leaderboard | Cohort-scoped, **opt-in** (`leaderboard_optin`); non-opted students are absent from the board and cannot see it |

Points live in an append-only `points_ledger`; the balance is always a `SUM`, so the award history is auditable and cannot be silently edited.

---

## 9. Teacher engine

### 9.1 Assessment generator

```
generate(blueprint) →
  for each (clo, bloomLevel, count) slot in the blueprint:
    ctx  = retrieve(clo.statement,
                    { cloId, bloomBand: [bloom, bloom], difficultyBand },
                    { finalK: 6 })
    item = llm.generation.parse(questionPrompt(clo, bloom, ctx, misconceptions),
                                QuestionSchema)
    rep  = validate(item, ctx)
    persist(item, rep, status = rep.passed ? "pending" : "rejected")
    emit progress                       ← streamed to the UI per item
```

Items are generated **one at a time with per-item retrieval**, not in one batch call. This costs more tokens but keeps each item grounded in context specific to its own CLO and Bloom level — batch generation reliably degrades alignment.

`QuestionSchema` (Zod, used for both structured output and runtime validation):
```ts
z.object({
  type: z.enum(["mcq","saq"]),
  stem: z.string().min(20),
  options: z.array(z.object({
    key: z.enum(["A","B","C","D"]),
    text: z.string(),
    correct: z.boolean(),
    misconceptionCode: z.string().nullable(),
    rationale: z.string(),
  })).length(4).optional(),
  referenceAnswer: z.string().optional(),
  rubric: z.array(z.object({ criterion: z.string(), points: z.number() })).optional(),
  explanation: z.string(),
  difficultyPrior: z.number().min(0).max(1),
  citedChunkIds: z.array(z.string()).min(1),
})
```

### 9.2 Lecture co-pilot

```
plan(topic, durationMinutes) →
  prereqs = graph prerequisite closure of topic
  ctx     = retrieve(topic.title, { topicIds: [topic, ...prereqs] }, { finalK: 12 })
  plan    = llm.generation.parse(lecturePrompt(topic, clos, duration, ctx),
                                 LecturePlanSchema)
```

`LecturePlanSchema` produces ordered segments, each with `minutes`, `bloomLevel`, `cloCode`, `activityType` (`recall | explain | demo | practice | discuss | assess`), `content`, `instructorNotes`, `citedChunkIds`. A post-generation assertion checks that `bloomLevel` is non-decreasing across segments and that at least one segment has `activityType = "assess"`; a violation triggers one regeneration attempt before surfacing a warning.

### 9.3 Analytics and at-risk rules

At-risk detection is **rules-based and inspectable**. Each fired rule is displayed with the flag.

| Rule | Condition |
|---|---|
| `low_mastery` | Mean CLO mastery < 0.4 after ≥ 20 answered items |
| `stalled` | No mastery increase across the last 15 items |
| `disengaged` | No activity for ≥ 7 days while the course is active |
| `prereq_blocked` | ≥ 3 topics blocked by the same unmastered prerequisite |
| `misconception_persistent` | Any misconception hit ≥ 5 times without clearing |

This is deliberately not a trained model — there is no historical outcome data to train one, and presenting rules as a predictive model would be dishonest.

### 9.4 AI co-teacher

Input: student response + item + rubric + retrieved supporting chunks.
Output (structured): `whatIsCorrect`, `whatIsMissing`, `misconceptionIfAny`, `suggestedScore`, `nextStep`, `citedChunkIds`.
The teacher edits and releases; nothing auto-sends. The release action is itself audited.

---

## 10. Governance implementation

### 10.1 RBAC

A single server-side guard, used by every route handler, server action, and server component that touches data:

```ts
requireUser()                              → Session | 401
requireRole("teacher" | "admin")           → Session | 403
requireCourseAccess(courseId, minRole)     → Session | 403
requireSelf(studentId)                     → Session | 403
```

Rules:
- Students read only rows where `student_id = session.user.id`.
- Teachers read only courses they are enrolled in as `teacher`.
- Admins read everything **except** they cannot see student free-text answers without an explicit, audited reason.
- Every 403 is written to the audit log with the attempted resource.

Client-side hiding is presentation only and is never the enforcement point.

### 10.2 Audit chain

`audit.append(entry)` runs inside a transaction:
1. `SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1 FOR UPDATE` (or the seed on an empty table).
2. Compute `hash` over the canonical field concatenation.
3. `INSERT`.

`verifyChain()` streams the table in `seq` order, recomputing each hash and comparing both the stored `hash` and the `prev_hash` linkage. Returns `{ ok, checked, firstBrokenSeq? }`.

Immutability:
```sql
CREATE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_immutable();
```

The demo's tamper test disables the trigger, edits one row, re-enables, and runs verification — which must fail and name that row.

### 10.3 Bias monitor

For each slice defined by `cohort_tag`, compute mean topic mastery, item accuracy, at-risk flag rate, and recommendation-type distribution. Flag any slice whose value deviates from the cohort mean by more than `BIAS_DEVIATION_THRESHOLD` (default 0.15 absolute, or 1.5× for rates). Snapshots are persisted so drift over time is visible.

`cohort_tag` is queryable only through the bias-monitor service, which is admin-guarded. No teacher- or student-facing query joins it.

### 10.4 Curriculum validation console

Runs the following checks and reports each with the offending IDs:

| Check | Query |
|---|---|
| CLO with no PLO mapping | `clos LEFT JOIN clo_plo_map` |
| CLO with no topic mapping | `clos LEFT JOIN clo_topics` |
| Topic with zero corpus coverage | `topics LEFT JOIN chunks` |
| Topic × Bloom cell with zero coverage | Grouped count over `chunks` |
| CLO × Bloom with zero approved items | Grouped count over `questions` |
| Prerequisite cycle | Cypher self-reachability |
| Item above its CLO's Bloom ceiling | `questions.target_bloom > clos.bloom_level` |
| Orphan chunk (no topic assigned) | `chunks WHERE topic_id IS NULL` |

---

## 11. API surface

All routes are under `/api`. Every handler calls the RBAC guard first. `S` = student, `T` = teacher, `A` = admin.

### Auth
| Method | Route | Roles |
|---|---|---|
| POST | `/api/auth/[...nextauth]` | public |
| POST | `/api/auth/set-password` | invited user with valid token |

### Admin
| Method | Route | Roles |
|---|---|---|
| GET/POST | `/api/admin/users` | A |
| PATCH/DELETE | `/api/admin/users/:id` | A |
| POST | `/api/admin/users/bulk` | A — CSV, dry-run preview then commit |
| GET/POST/DELETE | `/api/admin/enrollments` | A |
| GET/PUT | `/api/admin/config` | A — model tiers, effort, retrieval params |
| GET | `/api/admin/audit` | A — filter, paginate |
| POST | `/api/admin/audit/verify` | A |
| GET | `/api/admin/bias` | A |
| GET | `/api/admin/curriculum-validation` | A, T |

### Materials and ingestion
| Method | Route | Roles |
|---|---|---|
| GET/POST | `/api/materials` | T, A |
| GET | `/api/materials/:id` | T, A |
| GET | `/api/materials/:id/jobs` | T, A — polled for progress |
| POST | `/api/materials/:id/retry` | T, A |
| DELETE | `/api/materials/:id` | T, A |

### Tag review
| Method | Route | Roles |
|---|---|---|
| GET | `/api/tags/queue` | T — ascending confidence |
| PATCH | `/api/tags/:chunkId` | T — sets `verified_by` |

### Retrieval (diagnostic)
| Method | Route | Roles |
|---|---|---|
| POST | `/api/retrieve` | T, A — exposes the pipeline for the demo and eval harness |

### Teacher engine
| Method | Route | Roles |
|---|---|---|
| POST | `/api/teacher/generate` | T — streams per-item progress |
| GET | `/api/teacher/bank` | T — filter by CLO, Bloom, status |
| PATCH | `/api/teacher/bank/:id` | T — approve / reject / edit |
| GET/POST | `/api/teacher/assessments` | T |
| POST | `/api/teacher/assessments/:id/publish` | T |
| POST | `/api/teacher/lecture-plan` | T |
| GET | `/api/teacher/curriculum/matrix` | T, A |
| GET | `/api/teacher/curriculum/coverage` | T, A |
| GET | `/api/teacher/analytics` | T |
| POST | `/api/teacher/recommend` | T |
| POST | `/api/teacher/coteacher/feedback` | T |
| POST | `/api/teacher/coteacher/release` | T |

### Student engine
| Method | Route | Roles |
|---|---|---|
| POST | `/api/student/quiz/start` | S |
| GET | `/api/student/quiz/:attemptId/next` | S (self) |
| POST | `/api/student/quiz/:attemptId/answer` | S (self) |
| POST | `/api/student/quiz/:attemptId/finish` | S (self) |
| GET | `/api/student/plan` | S (self) |
| GET | `/api/student/progress` | S (self) |
| GET | `/api/student/recommendations` | S (self) |
| GET | `/api/student/gamification` | S (self) |
| PUT | `/api/student/leaderboard-optin` | S (self) |

---

## 12. UI structure

Three route groups, three distinct visual identities, one shared component library.

### Student — calm, focused, one task per screen
| Route | Content |
|---|---|
| `/student` | Next step, mastery summary, streak, active badges |
| `/student/quiz` | One item at a time; on answer, the feedback panel with the named misconception and citation |
| `/student/plan` | Ordered path; blocked topics visually distinguished; remediation steps pinned at the top |
| `/student/progress` | Per-CLO bars, per-topic detail, attempt history |
| `/student/resources` | Metadata-filtered recommendations with LOM tags shown |

### Teacher — dense, work-oriented
| Route | Content |
|---|---|
| `/teacher` | Course health, pending approvals, ingestion status |
| `/teacher/materials` | Upload, list, per-stage ingestion progress, retry |
| `/teacher/tags` | Low-confidence review queue, inline correction |
| `/teacher/generate` | Blueprint form → streaming generation → **accepted and rejected items side by side with failure reasons** |
| `/teacher/bank` | Item bank, filter by CLO/Bloom/status, approve/edit/reject |
| `/teacher/lecture` | Lecture co-pilot, plan editor, Markdown export |
| `/teacher/curriculum` | CLO↔PLO matrix, topic × Bloom coverage heatmap, prerequisite graph |
| `/teacher/analytics` | Cohort mastery, engagement, at-risk with the triggering rule shown |
| `/teacher/feedback` | Co-teacher draft queue, edit and release |

### Admin — operational, tabular
| Route | Content |
|---|---|
| `/admin` | System status, token spend by tier, job queue depth |
| `/admin/users` | CRUD, CSV import with dry-run preview |
| `/admin/enrolment` | Course roster management |
| `/admin/settings` | Per-tier model + effort, embedding provider, retrieval params |
| `/admin/audit` | Filterable log; **Verify chain** action with pass/fail and first broken link |
| `/admin/bias` | Per-slice fairness metrics with flags |
| `/admin/validation` | Curriculum validation console |

### Cross-cutting UI rules
- Every AI-generated artifact carries a visible "AI-generated" marker.
- Every synthetic cohort record carries a visible "synthetic data" marker.
- Validation status is shown with an icon **and** a text label, never colour alone.
- Mastery is shown as a bar **and** a numeric percentage.
- Citations render as `section_path · pp. from–to` and link to the chunk detail.

---

## 13. Evaluation harness

`npm run eval` executes each of the following and writes `eval/report.json` plus a Markdown summary.

| Script | Method | Output |
|---|---|---|
| `bloom-accuracy.ts` | Run the tagger over `data/gold/bloom-gold.jsonl`; compare to human labels | Accuracy, per-level confusion matrix, n |
| `retrieval-hit-rate.ts` | Run each query in `retrieval-queries.jsonl` through the full pipeline | hit-rate@1/@3/@8, MRR, n |
| `clo-precision.ts` | Sample generated items; compare validator verdict to expert ratings in `expert-questions.jsonl` | Precision, recall, agreement, n |
| `groundedness.ts` | Re-run the groundedness check over a sample of approved items | Pass rate, n |
| `report.ts` | Aggregate | Table of metric, value, sample size, and a measured-vs-hypothesis banner |

The report **must** print sample sizes next to every figure, and must reproduce the §6.2 out-of-reach list from `requirements.md` verbatim so no downstream reader mistakes a demo metric for an efficacy result.

---

## 14. Requirement → design traceability

| Requirement group | Design sections |
|---|---|
| FR-INT-001 … 007 (curriculum spine) | §4.2, §5.1, §3 (`data/curriculum/`) |
| FR-INT-010 … 019 (ingestion) | §6.5, §4.3, §11 (materials routes) |
| FR-INT-020 … 026 (LOM tagging) | §6.5 tag stage, §4.3 chunks, §12 `/teacher/tags` |
| FR-INT-030 … 034 (knowledge graph) | §5 |
| FR-INT-040 … 046 (retrieval) | §6.4, §6.3 |
| FR-INT-050 … 056 (LLM orchestration) | §6.1, §6.2 |
| FR-VAL-001 … 011 (validation) | §7 |
| FR-TCH-001 … 052 (teacher engine) | §9, §11, §12 |
| FR-STU-001 … 054 (student engine) | §8, §11, §12 |
| FR-GOV-001 … 014 (governance) | §10, §4.6 |
| FR-ADM-001 … 008 (administration) | §11 admin routes, §12 admin panel, §4.1 |
| NFR-CFG-* | §6.1 router, §6.3 adapter, `system_config` in §4.6 |
| NFR-OBS-* | §10.2, §13 |
| §6.1 metrics (requirements) | §13 |

---

## 15. Build order

Twelve phases. Each phase ends in a demonstrable state; do not begin a phase before its predecessor is verified.

| # | Phase | Deliverable | Verified by |
|---|---|---|---|
| 1 | Foundation | Compose stack, env config, Drizzle schema, migrations | `docker compose up` + migrate succeeds; all tables exist |
| 2 | Curriculum | Seed files, seeder, cycle detection, KG sync | 12 PLOs / 8 CLOs / 30 topics in Postgres and Neo4j; graph renders |
| 3 | Auth + RBAC | Auth.js, guard, admin bootstrap, user CRUD, enrolment | Admin creates a teacher and student; both log in; cross-role access returns 403 |
| 4 | Intelligence core | LLM router, embeddings adapter, vector store, retrieval pipeline | `/api/retrieve` returns filtered, cited results |
| 5 | Ingestion | Worker, six stages, upload UI, progress, retry | A PDF reaches `indexed` with non-zero chunks, all LOM-tagged |
| 6 | Tag review | Confidence queue, inline correction | Correction persists with `verified_by` |
| 7 | Validation engine | Six checks, report persistence, enforcement, eval harness skeleton | Deliberately bad item is rejected with a correct reason |
| 8 | Teacher engine | Generator, lecture co-pilot, curriculum tools, recommender, co-teacher | Blueprint produces validated items; plan is Bloom-ascending and cited |
| 9 | Student engine | BKT, adaptive selection, feedback, plan, recommendations, gamification | Difficulty visibly adapts; wrong answer names a misconception |
| 10 | Governance | Audit chain, immutability trigger, verification, bias monitor, validation console | Chain verifies; tampering is detected and localised |
| 11 | Panels | All three panels complete, accessible, distinct | Full demo walkthrough succeeds end to end |
| 12 | Cohort + eval | Synthetic cohort, full eval run, README with measured-vs-hypothesis | `npm run eval` emits all §13 metrics with sample sizes |

**Phase 7 precedes Phase 8 deliberately.** The measurement apparatus must exist before the features it measures, or the accuracy numbers become a post-hoc rationalisation.

---

## 16. Known limitations to state in the README

1. **Difficulty is Elo-calibrated, not IRT-calibrated.** Real 2PL/3PL calibration needs a large response matrix that a demo cannot produce.
2. **At-risk detection is rules-based, not a trained predictive model.** No historical outcome data exists to train one.
3. **The `local` embedding provider is a hashed n-gram approximation.** It exists so the system runs with no API key; reported retrieval figures should be measured on a real embedding provider.
4. **The synthetic cohort is simulated.** It exercises analytics and the bias monitor; it demonstrates nothing about real learning.
5. **Learning gain, quiz-quality uplift, and recommendation relevance are not measured.** They require a controlled study.
6. **Bloom classification and CLO alignment are LLM-judged**, validated against a modest gold set. The gold-set size is reported alongside every figure.
7. **Single-tenant, single-course.** No LTI, no SIS, no SSO, no multi-tenancy.
8. **Not compliance-certified.** FERPA / GDPR / EU AI Act (education is high-risk under Annex III) obligations are documented as production prerequisites, not implemented.
