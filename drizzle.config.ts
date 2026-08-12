import { defineConfig } from "drizzle-kit";

// DATABASE_URL is read directly rather than through src/lib/env.ts: drizzle-kit
// runs outside the app process and must not require the full env surface.
const url = process.env.DATABASE_URL ?? "postgresql://dualengine:dualengine@localhost:5433/dualengine";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
