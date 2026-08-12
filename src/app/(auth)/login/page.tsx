import { redirect } from "next/navigation";
import { auth } from "@/auth/config";
import { listOfferedDemoAccounts } from "@/auth/demo-accounts";
import { SetupRequired } from "@/components/setup-required";
import { missingSettings } from "@/lib/setup-status";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Dual-Engine Learning" };

/** The demo accounts are read per request, so seeding or removing them shows up. */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Checked before `auth()`, which reads AUTH_SECRET and would throw — turning
  // a fixable configuration gap into an opaque digest.
  const missing = missingSettings();
  if (missing.length > 0) return <SetupRequired missing={missing} />;

  const session = await auth();
  if (session?.user?.id) redirect("/");

  const [{ error }, demoAccounts] = await Promise.all([
    searchParams,
    listOfferedDemoAccounts(),
  ]);

  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center bg-secondary px-4 py-12"
    >
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Dual-Engine Learning Framework
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Outcome-Based Education · CS-201 Data Structures &amp; Algorithms
          </p>
        </div>

        {/*
          One sentence on what the system does, for the reader who has been sent
          a link and has no idea what they are looking at. It names the property
          the whole design exists to enforce, because that is the thing worth
          knowing before clicking anything.
        */}
        <p className="mb-6 rounded-lg border bg-card/60 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
          Every question, hint and lesson plan here is traceable to a course learning
          outcome, a Bloom&rsquo;s level, and the source passage it was grounded on.
        </p>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoginForm initialError={error} demoAccounts={demoAccounts} />
        </div>

        {/*
          Stating this is a product decision, not filler: users arriving without
          an account need to know the route is administrative, since there is no
          sign-up link to look for (FR-ADM-008).
        */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Accounts are created by an administrator. There is no public sign-up.
        </p>
      </div>
    </main>
  );
}
