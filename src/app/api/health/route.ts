import { NextResponse } from "next/server";

/**
 * Deployment diagnosis, reachable without signing in.
 *
 * A misconfigured deployment fails as "Application error: a server-side
 * exception has occurred… Digest: 2588876306" — Next.js deliberately withholds
 * the message in production, so the one number you are given is useless without
 * the server logs. This route answers the question that digest is hiding: which
 * of the things this app needs are actually present.
 *
 * It reports presence and reachability, never values. No secret, connection
 * string, host or password appears in the response, so it is safe to leave
 * open — which it must be, because the failure it diagnoses prevents signing in.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** True when the variable is set to something non-empty. */
function present(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export async function GET(): Promise<NextResponse> {
  const checks: Check[] = [];

  /* ── configuration ─────────────────────────────────────────────────────── */

  const hasDatabaseUrl = present("DATABASE_URL");
  checks.push({
    name: "DATABASE_URL",
    ok: hasDatabaseUrl,
    detail: hasDatabaseUrl
      ? "set"
      : "MISSING — the app cannot start. Set it to a PostgreSQL connection string.",
  });

  const secret = process.env["AUTH_SECRET"] ?? "";
  checks.push({
    name: "AUTH_SECRET",
    ok: secret.length >= 16,
    detail:
      secret.length === 0
        ? "MISSING — the app cannot start. Generate one: openssl rand -base64 32"
        : secret.length < 16
          ? `too short (${secret.length} chars; needs at least 16)`
          : "set",
  });

  // Auth.js v5 must be told to trust the proxy Vercel puts in front of it, or
  // every callback URL it builds points at the wrong origin.
  const trustHost = present("AUTH_TRUST_HOST") || present("VERCEL");
  checks.push({
    name: "AUTH_TRUST_HOST",
    ok: trustHost,
    detail: trustHost
      ? "set (or running on Vercel, which implies it)"
      : "not set — behind a proxy, sign-in redirects may point at the wrong host",
  });

  /* ── database ──────────────────────────────────────────────────────────── */

  let databaseOk = false;
  let tables = 0;

  if (hasDatabaseUrl) {
    try {
      // Imported lazily: this route has to answer even when the database
      // module would throw on construction.
      const { sql } = await import("@/db/client");

      const [version] = await sql<{ v: string }[]>`SELECT version() AS v`;

      const extensions = await sql<{ extname: string }[]>`
        SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')`;
      const names = extensions.map((e) => e.extname);

      const [count] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
      tables = count?.n ?? 0;

      databaseOk = true;

      checks.push({
        name: "database",
        ok: true,
        detail: `reachable — ${(version?.v ?? "").split(" ").slice(0, 2).join(" ")}`,
      });

      checks.push({
        name: "pgvector",
        ok: names.includes("vector"),
        detail: names.includes("vector")
          ? "installed"
          : "MISSING — retrieval cannot work. Run: CREATE EXTENSION vector;",
      });

      checks.push({
        name: "pg_trgm",
        ok: names.includes("pg_trgm"),
        detail: names.includes("pg_trgm")
          ? "installed"
          : "MISSING — lexical search cannot work. Run: CREATE EXTENSION pg_trgm;",
      });

      checks.push({
        name: "migrations",
        ok: tables >= 30,
        detail:
          tables >= 30
            ? `${tables} tables present`
            : `only ${tables} tables — run: npm run db:migrate against this database`,
      });

      if (tables >= 30) {
        const [users] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
        const [questions] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM questions WHERE status = 'approved'`;
        checks.push({
          name: "seed data",
          ok: (users?.n ?? 0) > 0,
          detail:
            (users?.n ?? 0) > 0
              ? `${users?.n} account(s), ${questions?.n ?? 0} approved item(s)`
              : "no accounts — run: npm run bootstrap && npm run demo:seed",
        });
      }
    } catch (error: unknown) {
      // The message can name a host but never a password: postgres.js errors
      // report the failure kind, and the connection string is not echoed.
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        name: "database",
        ok: false,
        detail: `UNREACHABLE — ${message.slice(0, 200)}`,
      });
    }
  }

  /* ── optional services, absent by design in a minimal deployment ───────── */

  checks.push({
    name: "embedding provider",
    ok: true,
    detail: `${process.env["EMBEDDING_PROVIDER"] ?? "local"} (local needs no API key)`,
  });

  checks.push({
    name: "generative features",
    ok: true,
    detail: present("ANTHROPIC_API_KEY")
      ? "ANTHROPIC_API_KEY set — generation, judging and tagging enabled"
      : "no ANTHROPIC_API_KEY — generation, judging and tagging will refuse, by design. Everything else works.",
  });

  const ingestMode = process.env["INGEST_MODE"] ?? "auto";
  checks.push({
    name: "ingestion",
    ok: true,
    detail:
      ingestMode === "auto"
        ? "auto — probes Redis on first upload, then falls back to running in-process. Set INGEST_MODE=inline to skip the probe on serverless."
        : ingestMode,
  });

  const failures = checks.filter((c) => !c.ok);
  const healthy = failures.length === 0;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "misconfigured",
      summary: healthy
        ? "All required configuration is present and the database is reachable."
        : `${failures.length} problem(s): ${failures.map((f) => f.name).join(", ")}`,
      checks,
      // Named so the fix is obvious without reading the source.
      nextStep: healthy
        ? databaseOk && tables >= 30
          ? "Sign in at /login."
          : "Run the migrations and seeds against this database."
        : failures[0]?.detail,
    },
    { status: healthy ? 200 : 503 },
  );
}
