import { redirect } from "next/navigation";
import { auth } from "@/auth/config";
import { listOfferedDemoAccounts } from "@/auth/demo-accounts";
import { SetupRequired } from "@/components/setup-required";
import { missingSettings } from "@/lib/setup-status";
import { LoginForm } from "./login-form";
import { RoleCards } from "./role-cards";

export const metadata = { title: "Sign in · Dual-Engine Learning" };

/** The demo accounts are read per request, so seeding or removing them shows up. */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; role?: string }>;
}) {
  // Checked before `auth()`, which reads AUTH_SECRET and would throw — turning
  // a fixable configuration gap into an opaque digest.
  const missing = missingSettings();
  if (missing.length > 0) return <SetupRequired missing={missing} />;

  const session = await auth();
  if (session?.user?.id) redirect("/");

  const [{ error, role }, demoAccounts] = await Promise.all([
    searchParams,
    listOfferedDemoAccounts(),
  ]);

  // A role card links here carrying its role. When a seeded account exists for
  // it, the form arrives filled rather than empty.
  const matched = demoAccounts.find((account) => account.role === role);
  const prefill = matched ? { email: matched.email, password: matched.password } : undefined;

  return (
    <main id="main" className="min-h-screen bg-background px-6 py-16">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_minmax(0,420px)] lg:gap-16">
        {/* ── what this is ───────────────────────────────────────────────── */}
        <div className="lg:pt-6">
          <span className="label-mono inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-primary">
            <span aria-hidden="true">◈</span> System initialization
          </span>

          <h1 className="mt-6 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Metadata-Driven{" "}
            <span className="text-gradient-engine">Dual-Engine Framework</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
            A single ecosystem for outcome-based education. The{" "}
            <strong className="font-semibold text-primary">Intelligence Layer</strong> decides what
            to teach and retrieves what it is grounded on; the{" "}
            <strong className="font-semibold text-governance">Governance Layer</strong> records and
            constrains what reaches a learner.
          </p>

          {/*
            The constraint the whole design exists to enforce, stated up front.
            It is the thing worth knowing before clicking anything.
          */}
          <p className="mt-6 max-w-xl rounded-lg border border-border bg-card px-5 py-4 text-sm leading-relaxed text-muted-foreground">
            Every question, hint and lesson plan here is traceable to a course learning outcome, a
            Bloom&rsquo;s level, and the source passage it was grounded on.
          </p>

          {/*
            The role cards are the primary way in, so they are links to the
            form rather than descriptions of what you would find if you could
            get there. Each carries its role, and the form arrives prefilled.
          */}
          <div className="mt-8 max-w-xl">
            <RoleCards demoAccounts={demoAccounts} />
          </div>
        </div>

        {/* ── sign in ────────────────────────────────────────────────────── */}
        <div className="lg:pt-6">
          <div id="sign-in" className="glass rounded-lg p-7 scroll-mt-8">
            <h2 className="font-display text-xl font-semibold">Authenticate</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with your organizational account.
            </p>

            <div className="mt-6">
              <LoginForm
                initialError={error}
                demoAccounts={demoAccounts}
                prefill={prefill}
              />
            </div>
          </div>

          {/*
            Stating this is a product decision, not filler: users arriving
            without an account need to know the route is administrative, since
            there is no sign-up link to look for (FR-ADM-008).
          */}
          <p className="label-mono mt-6 text-center leading-relaxed text-muted-foreground">
            Secure authentication required. Accounts are created by an
            administrator — there is no public sign-up.
          </p>
        </div>
      </div>
    </main>
  );
}
