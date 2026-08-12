-- Extensions required by the data model. Runs once on an empty data directory.
-- Re-runnable by hand: every statement is IF NOT EXISTS.

-- pgvector: HNSW cosine index on chunks.embedding (design.md §4.3)
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm: GIN trigram index backing the lexical half of hybrid retrieval (§6.4 step 3)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pgcrypto: gen_random_uuid() for every primary key
CREATE EXTENSION IF NOT EXISTS pgcrypto;
