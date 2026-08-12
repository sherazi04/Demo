/**
 * Whether the app has the configuration it needs to run at all.
 *
 * Reads `process.env` directly rather than going through `@/lib/env`, because
 * that module's whole job is to throw when configuration is missing — which is
 * correct for a server that should not start, and useless for a page whose
 * purpose is to tell someone *why* it did not. Nothing here throws.
 */

export interface MissingSetting {
  name: string;
  what: string;
  how: string;
}

const REQUIRED: MissingSetting[] = [
  {
    name: "DATABASE_URL",
    what: "A PostgreSQL connection string, for a database with the pgvector and pg_trgm extensions.",
    how: "Create one at neon.tech (free tier supports pgvector), then run CREATE EXTENSION vector; and CREATE EXTENSION pg_trgm;",
  },
  {
    name: "AUTH_SECRET",
    what: "A random string of at least 16 characters, used to sign session cookies.",
    how: "Generate one with: openssl rand -base64 32",
  },
];

function isSet(name: string, minLength = 1): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length >= minLength;
}

/** The required settings that are absent. Empty means the app can start. */
export function missingSettings(): MissingSetting[] {
  return REQUIRED.filter((setting) =>
    setting.name === "AUTH_SECRET" ? !isSet(setting.name, 16) : !isSet(setting.name),
  );
}

export function isConfigured(): boolean {
  return missingSettings().length === 0;
}
