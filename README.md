# Metadata-Driven Dual-Engine Personalized Learning Framework

A working demonstration of an AI system for Outcome-Based Education, built to one
defining constraint:

> **No AI-generated artifact reaches a learner without being traceable to a Course
> Learning Outcome, a Bloom's taxonomy level, and the specific source content it was
> grounded on.**

Four layers, all genuinely implemented: a **Student Engine**, a **Teacher Engine**, a
shared **Intelligence Layer** (IEEE LOM metadata, curriculum knowledge graph, Graph RAG,
hybrid retrieval), and a **Governance Layer** that oversees every output.

Scope is a single course — CS-201 Data Structures & Algorithms — end to end. The data is
narrow; the architecture is not.

---

## Setup

### Prerequisites

- Node 20.11+
- Optionally Docker, for Postgres 17 + pgvector, Neo4j 5 and Redis 7

Only Postgres is required. Neo4j and Redis are optional and the system says so at runtime
when they are absent, rather than failing: see [Running without Docker](#running-without-docker).

### Bootstrap (with Docker)

```bash
cp .env.example .env          # then set AUTH_SECRET to a random 32-byte string
docker compose up -d          # Postgres, Neo4j, Redis
npm install
npm run bootstrap             # migrate → seed curriculum → sync graph → create admin
npm run demo:seed             # corpus + item bank + 40 synthetic students (no API key needed)
npm run dev                   # web app on http://localhost:3000
npm run worker                # ingestion worker, in a second terminal
```

`npm run bootstrap` is idempotent — re-running it updates the curriculum in place rather
than duplicating it.

Sign in with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` from your `.env`.

### Test accounts

`npm run seed:accounts` creates one signed-in-able account per role and fills the panels
that have nothing to show on a fresh install — an assessment, the runtime config table,
ingestion job history, badges and a leaderboard opt-in.

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.edu` | `ChangeMe!2025` (from `.env`) |
| Teacher | `teacher@example.edu` | `DemoPass!2025` |
| Student | `student@example.edu` | `DemoPass!2025` |
| Student | `student2@example.edu` | `DemoPass!2025` |

`student@example.edu` has history because the seeder **runs the real engine** — it starts
attempts, takes what the adaptive selector serves, and submits answers. Writing mastery
rows directly would look right on screen and be internally inconsistent: a mastery figure
no sequence of answers could produce, misconception hits matching no response, points that
don't add up. Everything shown is reachable by clicking.

The 40 synthetic students from `seed:cohort` are **suspended and cannot sign in** — they
exist to exercise the analytics and bias monitor, and are labelled synthetic throughout.

> These are test accounts with passwords published in a README. Delete them before any
> real use. `npm run demo:reset` deliberately does not touch them.

### Running without Docker

Docker is not required. `npm run db:local` starts a real PostgreSQL 16.4 — [PGlite]
compiled to WebAssembly, with `pgvector` and `pg_trgm` loaded — and serves it over the
actual Postgres wire protocol on `127.0.0.1:5433`. The app, the migrations and
`drizzle-kit` all connect through `DATABASE_URL` exactly as they would to a server in
Docker; there is no dev-only driver path and no code that behaves differently.

```bash
cp .env.example .env
# in .env:
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
#   DATABASE_POOL_MAX=1
npm install
npm run db:local              # leave running: local Postgres on :5433
npm run bootstrap             # in a second terminal
npm run demo:seed
npm run dev
```

`DATABASE_POOL_MAX=1` matters: the PGlite socket server accepts **one** client connection
and resets any other, so a second connection — a pool of ten, or a script run while the
dev server is up — will drop the first. Stop the dev server before running seeds or
smoke tests against the same database.

Two caveats, both handled rather than hidden:

- **No Neo4j.** Retrieval runs dense + lexical and reports `graph: unavailable` in its
  diagnostics instead of silently returning fewer results. `npm run sync:kg` warns and
  exits 0 so `bootstrap` still completes. The curriculum graph lives in Postgres and is
  the source of truth; Neo4j is a projection used for multi-hop expansion.
- **No Redis.** `INGEST_MODE=auto` (the default) probes Redis once and, if it does not
  answer, runs the six ingestion stages in-process instead of queueing them. It logs
  which path it took. Uploads then block for the length of the pipeline, which is why
  `INGEST_MODE=queue` — refuse to fall back — is what a deployment should set.

[PGlite]: https://pglite.dev

### Deploying to Vercel

Vercel runs the app; it does not give you a database. The build succeeds without one —
nothing is statically generated from the database — so a missing `DATABASE_URL` shows up
only at runtime, as *"Application error: a server-side exception has occurred. Digest:
…"*. That digest is not diagnosable on its own, which is what `/api/health` is for:
open `https://<your-app>.vercel.app/api/health` and it names exactly what is missing.

**1. Provision Postgres with pgvector.** [Neon](https://neon.tech) has a free tier and
supports the extension; Supabase and Vercel Postgres also work. Then enable the
extensions once:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

**2. Set the environment variables** in Vercel → Settings → Environment Variables:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** connection string | Serverless opens many short-lived connections |
| `DATABASE_POOL_MAX` | `1` | Each serverless instance keeps its own pool; a large one exhausts the server |
| `AUTH_SECRET` | `openssl rand -base64 32` | Required, at least 16 characters |
| `AUTH_TRUST_HOST` | `true` | Auth.js v5 must trust Vercel's proxy or callbacks point at the wrong origin |
| `APP_URL` | `https://<your-app>.vercel.app` | Used in absolute links |
| `EMBEDDING_PROVIDER` | `local` | No API key needed |
| `INGEST_MODE` | `inline` | Skips a Redis probe that would otherwise wait on every cold start |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | your own | **Change these** — the defaults are published in this README |

**3. Migrate and seed from your machine**, pointing at the cloud database:

```bash
DATABASE_URL='<your neon url>' npm run db:migrate
DATABASE_URL='<your neon url>' npm run bootstrap
DATABASE_URL='<your neon url>' npm run demo:seed     # optional demo content
```

**4. Redeploy**, then check `/api/health` — it should report `"status": "ok"`.

Two things behave differently in production, both deliberately:

- **The demo sign-in buttons do not appear.** They are withheld whenever `NODE_ENV` is
  production, so you sign in with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`.
- **Uploads run inline, inside the request.** With no Redis there is no worker, so a
  large document can exceed the serverless execution limit. The ingestion pipeline is
  better exercised locally; deploy Redis and run `npm run worker` on a host that supports
  long-lived processes if you need it in production.

### Running without any API key

The system is functional offline:

```bash
EMBEDDING_PROVIDER=local      # no key, no network — the default
```

Retrieval, adaptive selection, BKT/Elo, gamification, the audit chain and every panel work
with no `ANTHROPIC_API_KEY`. Generation, judging and LOM tagging genuinely require one, and
fail with that reason recorded rather than degrading quietly — upload a document without a
key and the `tag` stage is marked failed, naming the missing variable.

`npm run demo:seed` exists so the system is demonstrable in that state. It derives a
108-chunk corpus and an 86-item approved bank from the authored curriculum, with every
distractor drawn from a documented misconception, so the adaptive quiz and the
misconception-feedback path are genuinely exercised. That content is labelled as what it
is: `materials.kind = 'seeded_demo'`, `questions.generated_by_model =
'seeded-demo-content (no LLM)'`, and a validation report reading *"none — seeded content,
valid by construction, not judge-verified"*. It is not a demonstration of the generator.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web app |
| `npm run worker` | Ingestion worker (six-stage pipeline) |
| `npm run db:local` | Local Postgres 16.4 + pgvector on `:5433`, no Docker |
| `npm run bootstrap` | migrate → seed curriculum → sync KG → create admin |
| `npm run demo:seed` | Corpus + 86-item bank + 40 synthetic students, no API key |
| `npm run demo:reset` | Remove the synthetic cohort and seeded content |
| `npm run db:migrate` | Apply migrations |
| `npm run seed:curriculum` | Load the CS-201 spine (idempotent) |
| `npm run sync:kg` | Rebuild Neo4j from Postgres (idempotent) |
| `npm run seed:cohort` | 40 synthetic students — requires approved items first |
| `npm run eval` | Evaluation harness → `eval/report.json` + `.md` |

### Verification

Every command below runs against a live database and reports pass/fail counts.
`npm run verify` runs all of them except the HTTP suite, which needs the app running.

| Command | What it proves |
|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run test` | 179 unit tests over the algorithmic core |
| `npm run verify:schema` | 11 assertions: `vector(1024)`, HNSW cosine index, trigram index, both check constraints, append-only triggers |
| `npm run smoke` | 22 checks: audit chain, RBAC, retrieval filters, recommender, validation, DB-level approval refusal |
| `npm run smoke:ingest` | 7 checks: a real upload through the real six-stage pipeline |
| `npm run smoke:analytics` | 9 checks: at-risk rules, mastery aggregates, bias slices (needs a cohort) |
| `npm run smoke:http` | 22 checks over real HTTP: sign-in, RBAC refusals, adaptive quiz, every panel |
| `npm run verify:chain` | Audit-chain integrity |
| `npm run verify:chain -- --tamper` | **Destructive.** Proves the trigger refuses an UPDATE, and that a privileged edit made with the trigger disabled is detected and localised. Leaves the chain permanently broken — by design, since a log with a repair command is not append-only. Drop the database and re-run `bootstrap` to start a clean chain. |

---

## Demo walkthrough

1. **Admin** creates a teacher and a student, enrols both in CS-201.
2. **Admin → Validation** shows the CLO↔PLO matrix and corpus coverage.
3. **Neo4j Browser** (`http://localhost:7474`) renders the curriculum graph. Try the
   prerequisite closure:
   ```cypher
   MATCH (p:Topic)-[:PREREQ_OF*1..5]->(t:Topic {code: 'T29'}) RETURN DISTINCT p.code, p.title
   ```
4. **Teacher → Materials** uploads a PDF; all six ingestion stages report live progress.
5. **Teacher → Tags** shows the low-confidence review queue; a correction persists and
   re-syncs the graph.
6. **Teacher → Generate** builds a 10-item assessment for CLO-4 at Bloom "Apply".
   **Rejected items appear beside accepted ones with their failure reasons.**
7. **Teacher → Lecture** produces a Bloom-sequenced plan with citations.
8. **Teacher** approves the passing items; they enter the bank.
9. **Student → Practice** — answer correctly twice and difficulty rises; answer wrong and
   feedback **names the specific misconception** with a citation.
10. **Student → Plan** reorders; a badge fires.
11. **Teacher → Analytics** flags at-risk students **with the rule that fired**.
12. **Admin → Audit** replays the chain and verifies hash integrity.
13. `npm run verify:chain -- --tamper` proves tampering is detected and localised.

---

## Measured results vs hypotheses

This distinction is load-bearing. `npm run eval` prints both, and every figure carries its
sample size.

### Measurable by this system

Computed by the eval harness against the gold sets in `data/gold/`:

| Metric | How | Target |
|---|---|---|
| Bloom classification accuracy | Tagger vs ≥150 human-labelled chunks | ≥ 80 % |
| CLO alignment precision | Validator verdict vs ≥50 expert ratings | ≥ 85 % |
| Retrieval hit-rate@8 | ≥40 labelled queries through the real pipeline | ≥ 85 % |
| Groundedness rate | Persisted validation reports on generated items | ≥ 95 % |
| Validation rejection rate | Share of raw generations blocked | Reported, not targeted |

**Without the gold sets the harness reports `no gold data`, never a number.** Fabricating a
metric from an empty set is the worst thing it could do, so `notAvailable()` is the only
path to a result without one. The gold sets are not shipped — see *What you still need to
supply*.

### NOT measurable by this system

Reproduced from `requirements.md` §6.2. These require a controlled study with a baseline, a
sample-size calculation, and ethics approval:

- Learning gain (e.g. "18 % improvement")
- Quiz-quality uplift versus a human baseline (e.g. "+25 %")
- Recommendation relevance as a user-rated score at scale
- Lecture-planning time reduction as a statistically supported figure (a small n≈5
  usability study may be reported, clearly labelled as underpowered)

Any report, slide or thesis chapter drawn from this system must keep these separate.

---

## Known limitations

Stated plainly, because each one bounds what the demo can claim.

1. **Difficulty is Elo-calibrated, not IRT-calibrated.** Real 2PL/3PL calibration estimates
   discrimination and guessing parameters from a large response matrix by marginal maximum
   likelihood. This is a single-parameter online update. The code says so at
   `src/student/elo.ts`, and no UI label ever says "IRT".

2. **At-risk detection is rules-based, not a trained predictive model.** Five explicit
   conditions in `src/teacher/analytics.ts`. There is no historical outcome data to train a
   model on, and every flag displays the rule that fired plus its evidence.

3. **The `local` embedding provider is a hashed n-gram approximation.** It exists so the
   system runs with no API key. It captures lexical overlap and morphology but no
   semantics — a paraphrase with no shared substrings scores near zero, which
   `tests/embeddings.test.ts` asserts explicitly. **Retrieval figures measured on it are a
   floor, not a representative result**, and the eval harness says so in its output.

4. **The synthetic cohort is simulated.** `npm run seed:cohort` writes 40 students with
   probabilistic responses. Every row is labelled synthetic, every account is suspended,
   and the UI marks them wherever they appear. It exercises the analytics and the bias
   monitor; it demonstrates nothing about real learning.

5. **Learning gain, quiz-quality uplift and recommendation relevance are not measured.**

6. **Bloom classification and CLO alignment are LLM-judged**, validated against a modest
   gold set. The gold-set size is printed beside every figure.

7. **Single-tenant, single-course.** No LTI, no SIS, no SSO, no multi-tenancy.

8. **Not compliance-certified.** FERPA / GDPR / EU AI Act (education is high-risk under
   Annex III) obligations are documented as production prerequisites, not implemented.

---

## Architecture notes

Three deliberate deviations from the source architecture, each for a stated reason:

| Source says | This uses | Why |
|---|---|---|
| FAISS | **pgvector**, behind a `VectorStore` interface | FAISS is a library, not a service: no metadata-filtered query, no CRUD, no persistence guarantees. This system's premise is *metadata-filtered* retrieval — FAISS's weakest point. |
| GPT-3.5 / Phi-4 / Mistral | **Tiered router, `claude-opus-5`** | Three independently configurable tiers (`generation`, `judge`, `bulk`), swappable at runtime from the admin panel. |
| Implicit single-pass generation | **Separate judge tier** | A generator cannot validate itself. The judge is a distinct call with a distinct prompt. |

**Filter-first is non-negotiable.** Metadata predicates are applied *inside* the same SQL
statement as the vector search (`src/intelligence/vector/pgvector.ts`), never as a
post-filter on ANN results. Retrieving top-k by distance and filtering afterwards silently
returns fewer than k — and lets Bloom-inappropriate content through when the filtered set
is sparse. The CLO-alignment claim rests on retrieved context actually matching the
requested level.

**Validation is enforced twice.** `status = 'approved'` is refused by the service layer
(`assertApprovable`) *and* by a database check constraint, so a direct SQL write cannot
approve a failed item either.

**The audit log is append-only twice over.** A `BEFORE UPDATE OR DELETE` trigger raises,
and a second statement-level trigger guards `TRUNCATE` (which bypasses row-level triggers).
Hash chaining then makes a privileged tamper — someone who can disable the trigger —
detectable after the fact.

---

## What you still need to supply

The system runs without these; the reportable metrics do not.

| Item | Needed for | Minimum |
|---|---|---|
| Open-access textbook PDF | A real corpus | 1 book (e.g. *Open Data Structures*, CC BY) |
| Human Bloom labels | `bloom-accuracy` | 150 chunks → `data/gold/bloom-gold.jsonl` |
| Expert CLO-tagged questions | `clo-precision` | 50 items → `data/gold/expert-questions.jsonl` |
| Labelled retrieval queries | `retrieval-hit-rate` | 40 queries → `data/gold/retrieval-queries.jsonl` |
| Embedding API key | Reportable retrieval figures | Voyage or any OpenAI-compatible endpoint |
| Anthropic API key | Everything generative | — |

---

## Testing

```bash
npm run test        # 179 tests over the algorithmic core
npm run typecheck   # strict, noUncheckedIndexedAccess, no `any`
npm run verify      # the above plus every live-database suite
```

Unit coverage is deliberately concentrated on the logic that would fail silently: BKT
updates, Elo sign conventions, adaptive selection and its Bloom cap, RRF fusion, chunk
packing and overlap, chain tamper detection, prerequisite hoisting, curriculum invariants,
and the drift check. UI tests are out of scope for the demo.

Two tests are worth knowing about because they encode honesty rather than behaviour:
`tests/embeddings.test.ts` asserts the local provider *fails* on pure paraphrase, and
`tests/student-engine.test.ts` asserts the Elo calibration label never says "IRT".

Above the unit tests sit five suites that run against a live database and, in one case, a
live HTTP server — 71 checks in total. They exist because the defects that mattered most
here were invisible to both `tsc` and the unit tests: array parameters expanding to a SQL
row instead of an array, a pooled connection being reset, an at-risk rule that fired for
every student in the cohort, an unenrolled account meeting a stack trace, and a tamper test
whose own UPDATE silently affected zero rows and therefore reported a working audit chain
as broken. None of those are type errors, and none reproduce without a database.
