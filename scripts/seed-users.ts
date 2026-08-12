import "dotenv/config";
import { eq, sql as raw } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { users } from "@/db/schema";
import { checkPasswordPolicy, hashPassword } from "@/auth/password";
import { append } from "@/governance/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Creates exactly one bootstrap administrator on first run (FR-ADM-001).
 *
 * Idempotent and non-destructive: if the account already exists its password is
 * left alone, so re-running the bootstrap after the admin has changed their
 * password does not silently reset it back to the environment value.
 */
async function main(): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = env.BOOTSTRAP_ADMIN_NAME;

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    throw new Error(
      `BOOTSTRAP_ADMIN_PASSWORD is too weak: ${policy.problems.join(" ")} ` +
        `Set a stronger value in .env before bootstrapping.`,
    );
  }
  if (password === "ChangeMe!2025") {
    logger.warn(
      "bootstrap admin is using the example password from .env.example — change it before any real use",
    );
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(raw`lower(${users.email}) = lower(${email})`)
    .limit(1);

  if (existing) {
    if (existing.role !== "admin") {
      await db
        .update(users)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(users.id, existing.id));
      logger.info("promoted existing bootstrap account to admin", { email });
    } else {
      logger.info("bootstrap admin already exists — leaving password untouched", { email });
    }
    return;
  }

  const [row] = await db
    .insert(users)
    .values({
      email,
      name,
      role: "admin",
      // Active immediately with a known password: the bootstrap admin has no
      // one to send them an invite.
      status: "active",
      passwordHash: await hashPassword(password),
    })
    .returning();
  if (!row) throw new Error("failed to create bootstrap admin");

  await append({
    actorId: row.id,
    actorRole: "admin",
    action: "user.create",
    resourceType: "user",
    resourceId: row.id,
    payload: { role: "admin", bootstrap: true },
  });

  logger.info("bootstrap admin created", { email, userId: row.id });
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    logger.error("user seed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await sql.end();
    process.exitCode = 1;
  });
