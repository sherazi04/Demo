import "dotenv/config";

/**
 * HTTP smoke test against a running app.
 *
 *   npm run dev            (in one terminal)
 *   npm run smoke:http     (in another)
 *
 * Drives the real routes through the real middleware, the real Auth.js session
 * and the real RBAC guard — the layers that unit tests and the database smoke
 * test both sit underneath. Signs in with the bootstrap admin using the same
 * credentials flow a browser uses, including the CSRF token.
 */

const BASE = process.env["APP_URL"] ?? "http://localhost:3000";

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

/** Minimal cookie jar — enough for one session across redirects. */
const jar = new Map<string, string>();

function storeCookies(response: Response): void {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(";");
    const index = pair?.indexOf("=") ?? -1;
    if (!pair || index < 0) continue;
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (value === "" || value === "deleted") jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
    redirect: "manual",
  });
  storeCookies(response);
  return response;
}

async function main(): Promise<void> {
  console.log(`\n  HTTP SMOKE TEST — ${BASE}\n`);

  await check("server is up and /login renders", async () => {
    const response = await req("/login");
    assert(response.status === 200, `expected 200, got ${response.status}`);
    const html = await response.text();
    assert(html.includes("Sign in"), "login form not rendered");
    assert(
      html.includes("no public sign-up") || html.includes("administrator"),
      "the no-sign-up notice is missing",
    );
    return "200, form present, no sign-up notice shown";
  });

  await check("unauthenticated request to a panel redirects to /login", async () => {
    const response = await req("/teacher");
    assert(
      response.status === 307 || response.status === 302,
      `expected a redirect, got ${response.status}`,
    );
    const location = response.headers.get("location") ?? "";
    assert(location.includes("/login"), `redirected to ${location}`);
    return `${response.status} → ${location}`;
  });

  await check("unauthenticated API call is refused", async () => {
    const response = await req("/api/admin/users");
    assert(response.status === 401 || response.status === 307, `got ${response.status}`);
    return `${response.status}`;
  });

  // Probed here, verified after the admin signs in — see the check below.
  // Everything in this file goes over HTTP and never opens its own database
  // connection: the local PGlite server accepts a single client, so a second
  // connection from the test would displace the app's.
  const selfRegProbe = `selfreg-${Date.now()}@example.invalid`;

  await check("no self-registration route answers", async () => {
    const codes: number[] = [];
    for (const path of ["/register", "/signup", "/api/auth/register", "/api/auth/signup"]) {
      const response = await req(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: selfRegProbe,
          password: "hunter2hunter2",
          name: "Self Reg",
        }),
      });
      codes.push(response.status);
      assert(response.status >= 300, `${path} answered ${response.status}`);
    }
    // Auth.js answers 400 to any unknown action under /api/auth/*, so the codes
    // alone prove nothing. Whether an account appeared is checked once the
    // admin session exists.
    return `4 endpoints probed, none succeeded (${codes.join(", ")})`;
  });

  /* ── sign in as the bootstrap admin ───────────────────────────────────── */

  await check("admin signs in with the credentials provider", async () => {
    const csrfResponse = await req("/api/auth/csrf");
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
    assert(Boolean(csrfToken), "no CSRF token issued");

    const body = new URLSearchParams({
      csrfToken,
      email: process.env["BOOTSTRAP_ADMIN_EMAIL"] ?? "admin@example.edu",
      password: process.env["BOOTSTRAP_ADMIN_PASSWORD"] ?? "ChangeMe!2025",
      callbackUrl: `${BASE}/`,
      json: "true",
    });

    const response = await req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    assert(response.status < 400, `sign-in returned ${response.status}`);

    const session = await (await req("/api/auth/session")).json();
    const user = (session as { user?: { role?: string; id?: string } }).user;
    assert(Boolean(user?.id), "no session established");
    assert(user?.role === "admin", `session role is ${user?.role}`);
    return `session established, role=${user?.role}`;
  });

  await check("admin can read the user list", async () => {
    const response = await req("/api/admin/users?limit=5");
    assert(response.status === 200, `got ${response.status}`);
    const body = (await response.json()) as { users: unknown[] };
    assert(Array.isArray(body.users), "no users array");
    return `${body.users.length} users returned`;
  });

  await check("the self-registration probe created no account", async () => {
    const response = await req(`/api/admin/users?search=${encodeURIComponent(selfRegProbe)}`);
    assert(response.status === 200, `got ${response.status}`);
    const body = (await response.json()) as { users: Array<{ email: string }> };
    const match = body.users.filter((u) => u.email === selfRegProbe);
    assert(match.length === 0, "a self-registration route created an account");
    return "0 accounts created by 4 probes";
  });

  await check("admin panel pages render", async () => {
    const pages = ["/admin", "/admin/users", "/admin/audit", "/admin/validation", "/admin/bias"];
    const codes: string[] = [];
    for (const page of pages) {
      const response = await req(page);
      assert(response.status === 200, `${page} returned ${response.status}`);
      const html = await response.text();
      assert(!html.includes("Application error"), `${page} rendered a client error`);
      codes.push(`${page.split("/").pop() || "root"}=200`);
    }
    return codes.join(", ");
  });

  await check("audit chain verifies through the API", async () => {
    const response = await req("/api/admin/audit/verify", { method: "POST" });
    assert(response.status === 200, `got ${response.status}`);
    const body = (await response.json()) as { ok: boolean; checked: number; message: string };
    assert(body.ok, `chain broken: ${body.message}`);
    return `${body.checked} records verified`;
  });

  await check("curriculum validation console responds", async () => {
    const response = await req("/api/admin/curriculum-validation");
    assert(response.status === 200, `got ${response.status}`);
    const body = (await response.json()) as { checks: unknown[]; passedCount: number };
    assert(body.checks.length === 8, `expected 8 checks, got ${body.checks.length}`);
    return `${body.passedCount}/8 passing`;
  });

  await check("bias monitor responds with per-slice metrics", async () => {
    const response = await req("/api/admin/bias");
    assert(response.status === 200, `got ${response.status}`);
    const body = (await response.json()) as {
      metrics: unknown[];
      cohortSize: number;
      slices: unknown[];
    };
    assert(body.slices.length > 1, "expected several cohort slices");
    return `${body.cohortSize} students across ${body.slices.length} slices, ${body.metrics.length} metrics`;
  });

  await check("teacher pages render for an admin", async () => {
    const pages = [
      "/teacher",
      "/teacher/materials",
      "/teacher/tags",
      "/teacher/generate",
      "/teacher/bank",
      "/teacher/curriculum",
      "/teacher/analytics",
      "/teacher/lecture",
      "/teacher/feedback",
    ];
    for (const page of pages) {
      const response = await req(page);
      assert(response.status === 200, `${page} returned ${response.status}`);
      const html = await response.text();
      assert(!html.includes("Application error"), `${page} rendered a client error`);
    }
    return `${pages.length} teacher pages render`;
  });

  await check("retrieval diagnostic route returns filtered, cited results", async () => {
    const coursesResponse = await req("/api/admin/curriculum-validation");
    const { courseId } = (await coursesResponse.json()) as { courseId: string };

    const response = await req("/api/retrieve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "how does quicksort partition an array",
        filter: { courseId },
        options: { finalK: 5 },
      }),
    });
    assert(response.status === 200, `got ${response.status}`);
    const body = (await response.json()) as {
      results: Array<{ chunkId: string; citation: { sectionPath: string | null }; lom: { bloomLevel: number | null } }>;
      diagnostics: { embeddingProvider: string; timings: { totalMs: number } };
    };
    assert(body.results.length > 0, "no results");
    assert(Boolean(body.results[0]?.chunkId), "result has no chunk id");
    assert(Boolean(body.results[0]?.citation.sectionPath), "result has no source locator");
    return `${body.results.length} results, provider=${body.diagnostics.embeddingProvider}, ${body.diagnostics.timings.totalMs}ms`;
  });

  await check("item bank API returns approved items", async () => {
    const validation = await (await req("/api/admin/curriculum-validation")).json();
    const { courseId } = validation as { courseId: string };
    const response = await req(`/api/teacher/bank?courseId=${courseId}&status=approved`);
    assert(response.status === 200, `got ${response.status}`);
    const body = (await response.json()) as { items: unknown[] };
    assert(body.items.length > 0, "no approved items in the bank");
    return `${body.items.length} approved items`;
  });

  /* ── RBAC: a student must not reach teacher or admin routes ───────────── */

  /* ── provision a real student through the admin flow ──────────────────── */

  let probe: { id: string; email: string; password: string } | null = null;

  await check("admin provisions a student via the invite flow", async () => {
    const create = await req("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `rbac-probe-${Date.now()}@example.invalid`,
        name: "RBAC Probe",
        role: "student",
      }),
    });
    assert(create.status === 201, `user creation returned ${create.status}`);
    const created = (await create.json()) as { id: string; email: string; inviteToken: string };
    assert(Boolean(created.inviteToken), "no invite token issued");

    const password = "probe-password-long";
    const setPassword = await req("/api/auth/set-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: created.inviteToken, password }),
    });
    assert(setPassword.status === 200, `set-password returned ${setPassword.status}`);

    const reuse = await req("/api/auth/set-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: created.inviteToken, password: "another-password-x" }),
    });
    assert(reuse.status >= 400, `an invite token was accepted twice (${reuse.status})`);

    probe = { id: created.id, email: created.email, password };
    return "created, password set, invite token single-use";
  });

  async function signInAsProbe(): Promise<void> {
    jar.clear();
    const { csrfToken } = (await (await req("/api/auth/csrf")).json()) as { csrfToken: string };
    const signIn = await req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrfToken,
        email: probe?.email ?? "",
        password: probe?.password ?? "",
        callbackUrl: `${BASE}/`,
        json: "true",
      }).toString(),
    });
    if (signIn.status >= 400) throw new Error(`student sign-in returned ${signIn.status}`);
  }

  await check("an unenrolled student is told so, not crashed", async () => {
    await signInAsProbe();
    const session = (await (await req("/api/auth/session")).json()) as {
      user?: { role?: string };
    };
    assert(session.user?.role === "student", `session role is ${session.user?.role}`);

    // Before enrolment. A page must explain the gap; the API may 404.
    const page = await req("/student");
    assert(page.status === 200, `/student returned ${page.status} for an unenrolled student`);
    const html = await page.text();
    assert(html.includes("No course yet"), "/student did not explain the missing enrolment");

    const api = await req("/api/student/plan");
    assert(api.status === 404, `expected 404 from the API, got ${api.status}`);
    return "page 200 with an explanation, API 404";
  });

  await check("student is denied teacher and admin routes", async () => {
    const adminUsers = await req("/api/admin/users");
    assert(adminUsers.status === 403, `student got ${adminUsers.status} from /api/admin/users`);

    const bias = await req("/api/admin/bias");
    assert(bias.status === 403, `student got ${bias.status} from /api/admin/bias`);

    const teacherBank = await req("/api/teacher/bank");
    assert(teacherBank.status === 403, `student got ${teacherBank.status} from /api/teacher/bank`);

    // Pages render an explanation rather than a bare 403 — the deliberate
    // choice documented on tryRequireRole. What matters is that the refusal is
    // stated and no teacher content is rendered behind it.
    for (const [panel, marker] of [
      ["/teacher", "Tag review"],
      ["/admin", "Bias monitor"],
    ] as const) {
      const page = await req(panel);
      assert(page.status !== 500, `${panel} crashed with 500`);
      const html = await page.text();
      assert(html.includes("Not authorised"), `${panel} did not state the refusal`);
      assert(!html.includes(marker), `${panel} leaked panel content to a student`);
    }

    return "403 on admin users, bias and teacher bank; panels refuse without leaking";
  });

  await check("admin enrols the student on CS-201", async () => {
    // Back to the admin session.
    jar.clear();
    const { csrfToken } = (await (await req("/api/auth/csrf")).json()) as { csrfToken: string };
    await req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrfToken,
        email: process.env["BOOTSTRAP_ADMIN_EMAIL"] ?? "admin@example.edu",
        password: process.env["BOOTSTRAP_ADMIN_PASSWORD"] ?? "ChangeMe!2025",
        callbackUrl: `${BASE}/`,
        json: "true",
      }).toString(),
    });

    const { courseId } = (await (await req("/api/admin/curriculum-validation")).json()) as {
      courseId: string;
    };
    const response = await req("/api/admin/enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: probe?.id, courseId, role: "student" }),
    });
    assert(response.status === 201, `enrolment returned ${response.status}`);

    await signInAsProbe();
    return "enrolled and re-authenticated as the student";
  });

  await check("student's own routes work for the student", async () => {
    const plan = await req("/api/student/plan");
    assert(plan.status === 200, `student plan returned ${plan.status}`);
    const body = (await plan.json()) as { steps: unknown[]; reason: string };
    assert(Array.isArray(body.steps), "no plan steps");
    return `${body.steps.length} plan steps, reason "${body.reason}"`;
  });

  await check("adaptive quiz serves an item and accepts an answer", async () => {
    const progress = (await (await req("/api/student/progress")).json()) as {
      course: { id: string };
    };
    const start = await req("/api/student/quiz/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId: progress.course.id, itemsPlanned: 3 }),
    });
    assert(start.status === 201, `quiz start returned ${start.status}`);
    const { attemptId } = (await start.json()) as { attemptId: string };

    const next = await req(`/api/student/quiz/${attemptId}/next`);
    assert(next.status === 200, `next returned ${next.status}`);
    const served = (await next.json()) as {
      item: { attemptItemId: string; options: Array<{ key: string }> | null; stem: string } | null;
      finished: boolean;
      reason?: string;
    };
    assert(Boolean(served.item), `no item served: ${served.reason ?? "unknown"}`);
    assert(Boolean(served.item?.options?.length), "MCQ served without options");

    // Deliberately answer with an option that is not the key, to exercise the
    // misconception path. Options never carry `correct` over the wire, which is
    // itself the point — the answer key is not in the browser.
    const raw = JSON.stringify(served.item);
    assert(!raw.includes('"correct"'), "the answer key leaked to the client");

    const answer = await req(`/api/student/quiz/${attemptId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attemptItemId: served.item?.attemptItemId,
        response: served.item?.options?.[1]?.key ?? "B",
        responseMs: 4321,
      }),
    });
    assert(answer.status === 200, `answer returned ${answer.status}`);
    const result = (await answer.json()) as {
      correct: boolean;
      misconception: { code: string; description: string } | null;
      masteryBefore: number;
      masteryAfter: number;
      streak: { current: number };
    };
    return `answered (correct=${result.correct}), mastery ${result.masteryBefore.toFixed(2)}→${result.masteryAfter.toFixed(2)}${
      result.misconception ? `, misconception ${result.misconception.code} named` : ""
    }`;
  });

  await check("student panel pages render", async () => {
    for (const page of ["/student", "/student/quiz", "/student/plan", "/student/progress", "/student/resources"]) {
      const response = await req(page);
      assert(response.status === 200, `${page} returned ${response.status}`);
      const html = await response.text();
      assert(!html.includes("Application error"), `${page} rendered a client error`);
    }
    return "5 student pages render";
  });

  await check("suspending the probe account revokes access", async () => {
    // Back to the admin session to suspend it.
    jar.clear();
    const { csrfToken } = (await (await req("/api/auth/csrf")).json()) as { csrfToken: string };
    await req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrfToken,
        email: process.env["BOOTSTRAP_ADMIN_EMAIL"] ?? "admin@example.edu",
        password: process.env["BOOTSTRAP_ADMIN_PASSWORD"] ?? "ChangeMe!2025",
        callbackUrl: `${BASE}/`,
        json: "true",
      }).toString(),
    });

    const response = await req(`/api/admin/users/${probe?.id}`, { method: "DELETE" });
    assert(response.status === 200, `suspend returned ${response.status}`);
    const body = (await response.json()) as { status: string };
    assert(body.status === "suspended", `status is ${body.status}`);

    // A suspended account must not be able to sign back in.
    let signedIn = false;
    try {
      await signInAsProbe();
      const session = (await (await req("/api/auth/session")).json()) as { user?: unknown };
      signedIn = Boolean(session.user);
    } catch {
      signedIn = false;
    }
    assert(!signedIn, "a suspended account was able to sign in");
    return "suspended (not deleted, so the audit trail survives) and sign-in refused";
  });

  console.log(`\n  ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\n  ABORTED:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
