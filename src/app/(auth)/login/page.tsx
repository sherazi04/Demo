import { redirect } from "next/navigation";
import { auth } from "@/auth/config";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Dual-Engine Learning" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) redirect("/");

  const { error } = await searchParams;

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

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoginForm initialError={error} />
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
