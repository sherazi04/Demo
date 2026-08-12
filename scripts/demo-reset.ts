import "dotenv/config";
import { eq, sql as raw } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { attempts, materials, questions, users } from "@/db/schema";
import { logger } from "@/lib/logger";

/**
 * Resets demo state so the walkthrough can be run again from a clean slate.
 *
 *   npm run demo:reset            remove synthetic cohort + seeded demo content
 *   npm run demo:reset -- --all   also remove uploaded materials and every item
 *
 * The curriculum spine and real user accounts are never touched.
 *
 * The audit log is deliberately NOT cleared: it is append-only by design, and a
 * reset command that quietly erased it would defeat the property the governance
 * layer exists to demonstrate. To start the chain over, drop the database and
 * re-run `npm run bootstrap`.
 */

const PROVENANCE = "seeded-demo-content (no LLM)";

async function main(): Promise<void> {
  const all = process.argv.includes("--all");

  const synthetic = await db
    .delete(users)
    .where(eq(users.isSynthetic, true))
    .returning({ id: users.id });

  // Attempts, mastery, ledger, badges and streaks cascade with the user rows.
  logger.info("removed synthetic cohort", { students: synthetic.length });

  const seededItems = await db
    .delete(questions)
    .where(eq(questions.generatedByModel, PROVENANCE))
    .returning({ id: questions.id });

  const seededMaterial = await db
    .delete(materials)
    .where(eq(materials.kind, "seeded_demo"))
    .returning({ id: materials.id });

  let extraItems = 0;
  let extraMaterials = 0;
  let extraAttempts = 0;

  if (all) {
    const items = await db.delete(questions).returning({ id: questions.id });
    const mats = await db.delete(materials).returning({ id: materials.id });
    const atts = await db.delete(attempts).returning({ id: attempts.id });
    extraItems = items.length;
    extraMaterials = mats.length;
    extraAttempts = atts.length;
  }

  const [remaining] = await db.execute<{ audit: number }>(
    raw`SELECT count(*)::int AS audit FROM audit_log`,
  );

  console.log(
    [
      "",
      `  Removed ${synthetic.length} synthetic student(s).`,
      `  Removed ${seededItems.length} seeded item(s) and ${seededMaterial.length} seeded material(s).`,
      all
        ? `  --all: also removed ${extraItems} item(s), ${extraMaterials} material(s), ${extraAttempts} attempt(s).`
        : "  Uploaded materials and generated items were kept. Use --all to remove them.",
      "",
      `  The audit log is untouched (${remaining?.audit ?? 0} records). It is append-only`,
      "  by design — clearing it here would defeat the property it demonstrates.",
      "",
      "  Re-seed with:  npm run seed:demo && npm run seed:cohort",
      "",
    ].join("\n"),
  );
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    logger.error("demo reset failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await sql.end();
    process.exitCode = 1;
  });
