import "dotenv/config";
import { sql as raw } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { auditLog } from "@/db/schema";
import { verifyChain } from "@/governance/audit";
import { logger } from "@/lib/logger";

/**
 * Audit chain verification, and the documented tamper test (FR-GOV-005,
 * design.md §10.2).
 *
 *   npm run verify:chain              verify only
 *   npm run verify:chain -- --tamper  run the destructive tamper test
 *
 * The tamper test proves two separate properties:
 *
 *   1. The BEFORE UPDATE trigger REFUSES an ordinary UPDATE. Immutability is
 *      enforced, not merely claimed.
 *   2. With the trigger disabled — which requires table-owner privilege, i.e.
 *      an attacker who already owns the database — the edit succeeds, and
 *      verification then FAILS AND NAMES THE ALTERED ROW.
 *
 * Property 2 is the one that matters: hash chaining is what makes a
 * privileged tamper detectable after the fact, rather than invisible.
 */

async function verifyOnly(): Promise<void> {
  const result = await verifyChain();

  if (result.ok) {
    console.log(`\n  ✓ Audit chain intact — ${result.checked} record(s) verified.\n`);
    return;
  }

  console.error(
    [
      "",
      "  ✕ AUDIT CHAIN BROKEN",
      `    First broken record: seq ${result.firstBrokenSeq}`,
      `    Reason:              ${result.reason}`,
      `    Detail:              ${result.detail}`,
      `    Records verified before the break: ${result.checked}`,
      "",
    ].join("\n"),
  );
  process.exitCode = 1;
}

async function tamperTest(): Promise<void> {
  console.log("\n  Running the audit tamper test.\n");

  const before = await verifyChain();
  if (!before.ok) {
    console.error(
      `  The chain is already broken at seq ${before.firstBrokenSeq}. Fix that before testing.\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  1. Baseline: chain intact over ${before.checked} record(s).`);

  const [target] = await db
    .select({ seq: auditLog.seq, action: auditLog.action })
    .from(auditLog)
    .orderBy(raw`${auditLog.seq} ASC`)
    .limit(1)
    .offset(Math.max(0, Math.floor(before.checked / 2)));

  if (!target) {
    console.error("  No audit records to tamper with. Run the demo first.\n");
    process.exitCode = 1;
    return;
  }

  // Step 2: prove the trigger actually refuses an ordinary UPDATE.
  let triggerHeld = false;
  try {
    await db.execute(
      raw`UPDATE audit_log SET action = 'tampered.by.test' WHERE seq = ${target.seq}`,
    );
  } catch (error: unknown) {
    triggerHeld = true;
    console.log(
      `  2. The append-only trigger REFUSED a normal UPDATE on seq ${target.seq}.`,
    );
    console.log(
      `     ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
  }

  if (!triggerHeld) {
    console.error(
      "  2. ✕ The UPDATE succeeded without disabling the trigger — immutability is NOT enforced.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Step 3: disable the trigger and tamper anyway, as a database owner could.
  console.log("  3. Disabling the trigger and editing that row directly…");

  /*
   * The tamper is issued as literal SQL on the existing connection.
   *
   * Not parameterised, and not through Drizzle's `execute`: driving DDL plus a
   * parameterised write down that path — straight after a statement the trigger
   * had just rejected — proved unreliable here, silently affecting zero rows.
   * A test of "can tampering be detected" that quietly tampers with nothing
   * reports a working mechanism as broken, which is the worst failure this test
   * could have, so the affected row count is checked rather than assumed.
   *
   * A separate connection would model an attacker more faithfully, but the
   * local PGlite server accepts only one and resets any other, so the shared
   * one is used. `seq` is coerced to a number rather than interpolated as text
   * because it is going into SQL literally.
   */
  const seq = Number(target.seq);
  if (!Number.isInteger(seq)) throw new Error(`unexpected seq value: ${String(target.seq)}`);

  let tamperedRows = 0;
  await sql.unsafe(`ALTER TABLE audit_log DISABLE TRIGGER audit_no_update`);
  try {
    const affected = await sql.unsafe(
      `UPDATE audit_log SET action = 'tampered.by.test' WHERE seq = ${seq} RETURNING seq`,
    );
    tamperedRows = affected.length;
  } finally {
    // Always re-enable, even if the update throws — leaving the table mutable
    // would be a far worse outcome than a failed test.
    await sql.unsafe(`ALTER TABLE audit_log ENABLE TRIGGER audit_no_update`);
  }
  console.log("     Trigger re-enabled.");

  if (tamperedRows !== 1) {
    console.error(
      `  3. ✕ The tampering UPDATE affected ${tamperedRows} row(s), not 1. ` +
        "Nothing was altered, so step 4 would prove nothing. Aborting.\n",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`     Altered ${tamperedRows} row (seq ${target.seq}).`);

  // Step 4: verification must now fail, and name that row.
  const after = await verifyChain();
  if (after.ok) {
    console.error(
      "  4. ✕ Verification still passes after tampering — the chain is NOT detecting edits.\n",
    );
    process.exitCode = 1;
    return;
  }

  const localised = after.firstBrokenSeq === target.seq;
  console.log(
    [
      `  4. Verification FAILED, as it must:`,
      `     First broken record: seq ${after.firstBrokenSeq}`,
      `     Reason:              ${after.reason}`,
      `     Detail:              ${after.detail}`,
      "",
      localised
        ? `  ✓ The tampered row (seq ${target.seq}) was detected and named.`
        : `  ✕ Detected a break at seq ${after.firstBrokenSeq}, but the tampered row was seq ${target.seq}.`,
      "",
      "  NOTE: this database's audit log is now permanently broken by design.",
      "        There is no repair command, and that is the point — an append-only",
      "        log with a mend button is not append-only. `npm run demo:reset` will",
      "        NOT fix it: that command deliberately leaves the audit log alone.",
      "        To start a clean chain, drop the database and re-run:",
      "            npm run db:migrate && npm run bootstrap",
      "",
    ].join("\n"),
  );

  if (!localised) process.exitCode = 1;
}

async function main(): Promise<void> {
  const tamper = process.argv.includes("--tamper");
  if (tamper) await tamperTest();
  else await verifyOnly();
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    logger.error("chain verification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await sql.end();
    process.exitCode = 1;
  });
