import type { MissingSetting } from "@/lib/setup-status";

/**
 * Shown instead of a crash when the app is deployed without its configuration.
 *
 * Without this, a deployment missing DATABASE_URL fails as "Application error:
 * a server-side exception has occurred. Digest: …" — Next.js withholds the
 * message in production by design, so the person looking at the screen gets a
 * number and nothing else. A deployed site that explains what it needs is not a
 * broken site; an opaque digest is.
 *
 * Only names of settings appear here, never values.
 */
export function SetupRequired({ missing }: { missing: MissingSetting[] }) {
  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center bg-secondary px-4 py-12"
    >
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Setup required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Dual-Engine Learning Framework · the app is deployed but not yet configured
          </p>
        </div>

        <div className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm">
            {missing.length === 1
              ? "One required setting is missing:"
              : `${missing.length} required settings are missing:`}
          </p>

          <ul className="space-y-4">
            {missing.map((setting) => (
              <li key={setting.name} className="rounded-md border bg-background p-4">
                <code className="text-sm font-semibold">{setting.name}</code>
                <p className="mt-1 text-sm text-muted-foreground">{setting.what}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">How: </span>
                  {setting.how}
                </p>
              </li>
            ))}
          </ul>

          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">On Vercel</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Settings → Environment Variables → add the values above.</li>
              <li>
                Also set <code>AUTH_TRUST_HOST=true</code>, <code>DATABASE_POOL_MAX=1</code> and{" "}
                <code>INGEST_MODE=inline</code>.
              </li>
              <li>
                From your machine, against the same database:{" "}
                <code>npm run db:migrate</code> then <code>npm run bootstrap</code>.
              </li>
              <li>Redeploy.</li>
            </ol>
          </div>

          <p className="text-xs text-muted-foreground">
            <a href="/api/health" className="underline">
              /api/health
            </a>{" "}
            reports the full picture, including whether the database is reachable and
            whether the migrations have run. It lists names and reachability only — never
            values.
          </p>
        </div>
      </div>
    </main>
  );
}
