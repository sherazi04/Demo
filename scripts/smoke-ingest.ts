import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { chunks, courses, ingestJobs, materials, users } from "@/db/schema";
import { uploadMaterial } from "@/teacher/materials";
import { ingestMode } from "@/intelligence/ingest/dispatch";
import { hasAnthropicKey } from "@/intelligence/llm/client";
import { env } from "@/lib/env";
import type { AuthedUser } from "@/auth/guard";

/**
 * Ingestion smoke test — drives a real upload through the real pipeline.
 *
 * Runs against whatever mode is configured. With no Redis this exercises the
 * inline runner, which is the point: the six-stage pipeline is otherwise only
 * reachable on a machine with a queue, and untested code is a claim rather than
 * a feature.
 *
 * The `tag` stage genuinely needs an LLM, so what is asserted depends on
 * whether ANTHROPIC_API_KEY is set. Without one, the honest expectation is that
 * parse and chunk succeed and tag fails with a recorded reason — not that the
 * pipeline magically completes.
 */

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`  PASS  ${name} — ${await fn()}`);
    passed += 1;
  } catch (error: unknown) {
    console.log(
      `  FAIL  ${name} — ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`,
    );
    failed += 1;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SAMPLE = `# Binary Search Trees

A binary search tree keeps its keys in sorted order. Every node's left subtree
contains only keys smaller than the node's own key, and its right subtree only
larger keys. This invariant is what makes lookup logarithmic rather than linear.

## Insertion

Insertion walks down from the root, comparing at each node, until it reaches an
empty position. The new node is placed there as a leaf. Insertion therefore
costs the height of the tree.

## Why balance matters

If keys arrive already sorted, every insertion goes down the same side and the
tree degenerates into a linked list. Height becomes n rather than log n, and
lookup costs the same as scanning an array. Self-balancing variants such as
AVL and red-black trees restore the logarithmic bound by rotating after
insertions that would otherwise unbalance the tree.

## Deletion

Deleting a node with two children replaces it with its in-order successor: the
smallest key in the right subtree. Replacing it with an arbitrary child would
break the ordering invariant.
`;

async function main(): Promise<void> {
  console.log("\n  INGESTION SMOKE TEST — real upload through the real pipeline\n");

  const mode = await ingestMode();
  const llm = hasAnthropicKey();
  console.log(`  mode=${mode}  llm=${llm ? "configured" : "not configured"}\n`);

  const [course] = await db.select().from(courses).where(eq(courses.code, "CS-201")).limit(1);
  if (!course) throw new Error("CS-201 not seeded. Run: npm run bootstrap");

  const [admin] = await db
    .select()
    .from(users)
    .where(eq(users.email, env.BOOTSTRAP_ADMIN_EMAIL))
    .limit(1);
  if (!admin) throw new Error("No bootstrap admin. Run: npm run seed:users");

  const actor: AuthedUser = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    status: admin.status,
  };

  // Remove a previous run's upload so the test is repeatable.
  await db.delete(materials).where(eq(materials.filename, "smoke-bst.md"));

  let materialId = "";

  await check("upload runs the pipeline and returns a correlation id", async () => {
    const result = await uploadMaterial(
      actor,
      {
        courseId: course.id,
        title: "Smoke: Binary Search Trees",
        licenseNote: "Authored for this smoke test; no third-party content.",
      },
      {
        filename: "smoke-bst.md",
        bytes: Buffer.from(SAMPLE, "utf8"),
        mimeType: "text/markdown",
      },
    );
    assert(Boolean(result.materialId), "no material id returned");
    assert(Boolean(result.correlationId), "no correlation id returned");
    materialId = result.materialId;
    return `material ${result.materialId.slice(0, 8)}…, correlation ${result.correlationId.slice(0, 8)}…`;
  });

  await check("the licence note was required and stored", async () => {
    const [row] = await db.select().from(materials).where(eq(materials.id, materialId)).limit(1);
    assert(Boolean(row?.licenseNote), "no licence note recorded");

    let rejected = false;
    try {
      await uploadMaterial(
        actor,
        { courseId: course.id, title: "No licence", licenseNote: "" },
        { filename: "no-licence.md", bytes: Buffer.from("x", "utf8"), mimeType: "text/markdown" },
      );
    } catch {
      rejected = true;
    }
    assert(rejected, "an upload without a licence note was accepted");
    return "stored, and an upload without one is refused";
  });

  await check("parse stage produced text", async () => {
    const [job] = await db
      .select()
      .from(ingestJobs)
      .where(eq(ingestJobs.materialId, materialId))
      .limit(1);
    assert(Boolean(job), "no ingest_jobs row was written");

    const rows = await db
      .select()
      .from(ingestJobs)
      .where(eq(ingestJobs.materialId, materialId));
    const parse = rows.find((r) => r.stage === "parse");
    assert(parse?.status === "done", `parse status is ${parse?.status ?? "missing"}`);
    return `parse succeeded, ${rows.length} stage row(s) recorded`;
  });

  await check("chunk stage produced chunks with source locators", async () => {
    const rows = await db.select().from(chunks).where(eq(chunks.materialId, materialId));
    assert(rows.length > 0, "no chunks were written");
    const withLocator = rows.filter((r) => r.sectionPath || r.pageFrom !== null);
    assert(
      withLocator.length === rows.length,
      `${rows.length - withLocator.length} chunk(s) have no source locator`,
    );
    const tokens = rows.map((r) => r.tokenCount ?? 0);
    return `${rows.length} chunks, ${Math.min(...tokens)}–${Math.max(...tokens)} tokens, all with locators`;
  });

  await check(
    llm ? "tag stage classified the chunks" : "tag stage fails honestly without an API key",
    async () => {
      const rows = await db
        .select()
        .from(ingestJobs)
        .where(eq(ingestJobs.materialId, materialId));
      const tag = rows.find((r) => r.stage === "tag");
      assert(Boolean(tag), "no tag stage row");

      if (!llm) {
        assert(
          tag?.status === "failed",
          `expected the tag stage to fail without a key, got ${tag?.status}`,
        );
        assert(
          /ANTHROPIC_API_KEY/i.test(tag?.message ?? ""),
          `the recorded reason does not name the missing key: ${tag?.message ?? "(none)"}`,
        );
        return "recorded as failed, naming the missing ANTHROPIC_API_KEY";
      }

      assert(tag?.status === "done", `tag status is ${tag?.status}`);
      const tagged = await db.select().from(chunks).where(eq(chunks.materialId, materialId));
      const withTopic = tagged.filter((c) => c.topicId !== null);
      assert(withTopic.length > 0, "no chunk was assigned a topic");
      return `${withTopic.length}/${tagged.length} chunks tagged to a topic`;
    },
  );

  await check("the material's status reflects what actually happened", async () => {
    const [row] = await db.select().from(materials).where(eq(materials.id, materialId)).limit(1);
    if (!llm) {
      assert(row?.status === "failed", `expected status 'failed', got '${row?.status}'`);
      assert(Boolean(row?.error), "failed material carries no error message");
      return `status '${row?.status}' with the reason recorded — not silently 'ready'`;
    }
    assert(
      row?.status === "indexed",
      `expected a completed status, got '${row?.status}'`,
    );
    return `status '${row?.status}'`;
  });

  await check("re-uploading identical bytes is refused as a duplicate", async () => {
    let rejected = false;
    let message = "";
    try {
      await uploadMaterial(
        actor,
        {
          courseId: course.id,
          title: "Smoke: Binary Search Trees (again)",
          licenseNote: "Authored for this smoke test; no third-party content.",
        },
        {
          filename: "smoke-bst-copy.md",
          bytes: Buffer.from(SAMPLE, "utf8"),
          mimeType: "text/markdown",
        },
      );
    } catch (error: unknown) {
      rejected = true;
      message = error instanceof Error ? error.message : String(error);
    }
    assert(rejected, "the same content was ingested twice");
    return `refused: ${message.slice(0, 60)}`;
  });

  // Leave the database as it was found.
  await db.delete(materials).where(eq(materials.id, materialId));

  console.log(`\n  ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    console.error("\n  ABORTED:", error instanceof Error ? error.message : String(error));
    await sql.end().catch(() => undefined);
    process.exitCode = 1;
  });
