import "dotenv/config";
import postgres from "postgres";

/**
 * Post-migration schema assertions.
 *
 * Checks the structures the application depends on and that a plain
 * `\d`-style eyeball would miss: the pgvector column width, the HNSW operator
 * class, the trigram index, the approval check constraint, and the
 * append-only triggers. Run after `npm run db:migrate`.
 */
const sql = postgres(process.env["DATABASE_URL"] ?? "", { max: 1 });

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

try {
  const tables = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const tableCount = tables[0]?.n ?? 0;
  add("tables", tableCount >= 31, `${tableCount} base tables (expected 31 + migrations)`);

  const enums = await sql<{ n: number }[]>`
    SELECT count(DISTINCT t.typname)::int AS n
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid`;
  add("enums", (enums[0]?.n ?? 0) >= 9, `${enums[0]?.n} enum types`);

  const vec = await sql<{ atttypmod: number; typname: string }[]>`
    SELECT a.atttypmod, t.typname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE c.relname = 'chunks' AND a.attname = 'embedding'`;
  // pgvector encodes the dimension directly in atttypmod.
  add(
    "chunks.embedding is vector(1024)",
    vec[0]?.typname === "vector" && vec[0]?.atttypmod === 1024,
    `${vec[0]?.typname}(${vec[0]?.atttypmod})`,
  );

  const idx = await sql<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'chunks'`;
  const hnsw = idx.find((i) => i.indexdef.includes("hnsw"));
  add(
    "HNSW cosine index",
    Boolean(hnsw?.indexdef.includes("vector_cosine_ops")),
    hnsw?.indexdef ?? "missing",
  );
  const trgm = idx.find((i) => i.indexdef.includes("gin_trgm_ops"));
  add("GIN trigram index on chunks.text", Boolean(trgm), trgm?.indexdef ?? "missing");

  const constraint = await sql<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conname = 'questions_approved_requires_validation'`;
  add(
    "approval check constraint",
    constraint.length === 1,
    constraint.length === 1 ? "present" : "MISSING — failed items could be approved by raw SQL",
  );

  const licence = await sql<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conname = 'materials_license_note_required'`;
  add(
    "licence note check constraint",
    licence.length === 1,
    licence.length === 1
      ? "present"
      : "MISSING — an unattributed material could be written to the corpus",
  );

  const triggers = await sql<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal`;
  const names = triggers.map((t) => t.tgname);
  add("audit_no_update trigger", names.includes("audit_no_update"), names.join(", ") || "none");
  add("audit_no_truncate trigger", names.includes("audit_no_truncate"), names.join(", ") || "none");

  const fks = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`;
  add("foreign keys", (fks[0]?.n ?? 0) >= 40, `${fks[0]?.n} foreign keys`);

  // The unique index that makes duplicate uploads impossible within a course.
  const dupe = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_indexes
    WHERE indexname = 'materials_course_hash_unique'`;
  add("materials dedupe index", (dupe[0]?.n ?? 0) === 1, "unique (course_id, content_hash)");
} catch (error: unknown) {
  add("schema query", false, error instanceof Error ? error.message : String(error));
}

await sql.end();

const failed = checks.filter((c) => !c.ok);
for (const check of checks) {
  console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
}
console.log(
  failed.length === 0
    ? `\n  All ${checks.length} schema checks passed.\n`
    : `\n  ${failed.length} of ${checks.length} schema checks FAILED.\n`,
);
if (failed.length > 0) process.exitCode = 1;
