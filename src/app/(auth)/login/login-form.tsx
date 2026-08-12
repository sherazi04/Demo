"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { OfferedAccount } from "@/auth/demo-accounts";

/**
 * The failure message is deliberately identical for an unknown email, a wrong
 * password and a suspended account — distinguishing them would let an
 * unauthenticated caller enumerate accounts. The reason is recorded in the
 * audit log, where an administrator can see it.
 */
const GENERIC_FAILURE = "That email and password combination was not recognised.";

export function LoginForm({
  initialError,
  demoAccounts = [],
}: {
  initialError?: string;
  demoAccounts?: OfferedAccount[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError ? GENERIC_FAILURE : null);
  const [pending, setPending] = useState(false);

  async function submit(withEmail: string, withPassword: string) {
    setPending(true);
    setError(null);

    const result = await signIn("credentials", {
      email: withEmail,
      password: withPassword,
      redirect: false,
    });

    if (!result || result.error) {
      setError(GENERIC_FAILURE);
      setPending(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit(email, password);
  }

  /**
   * Fills the fields *and* signs in. Filling alone would leave the person
   * looking at a populated form wondering whether they still had to do
   * something; the fields are still filled so it is visible what was used.
   */
  async function useDemoAccount(account: OfferedAccount) {
    setEmail(account.email);
    setPassword(account.password);
    await submit(account.email, account.password);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={error ? "login-error" : undefined}
            aria-invalid={error ? true : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={error ? "login-error" : undefined}
              aria-invalid={error ? true : undefined}
              className="w-full rounded-md border border-input bg-background py-2 pl-3 pr-16 text-sm"
            />
            {/*
              A toggle rather than a permanently-visible field: mistyping a
              password you cannot see is the most common reason a sign-in fails
              twice in a row, and this is cheaper than a reset flow.
            */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {/* role="alert" so the failure is announced, not only shown in red. */}
        {error && (
          <p
            id="login-error"
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {demoAccounts.length > 0 && (
        <div className="space-y-3 border-t pt-5">
          <div>
            <p className="text-sm font-medium">Or explore with a demo account</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pre-seeded accounts with real activity. Shown because this is not a
              production environment and these accounts exist.
            </p>
          </div>

          <div className="space-y-2">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => void useDemoAccount(account)}
                disabled={pending}
                className="flex w-full items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left hover:bg-accent disabled:opacity-60"
              >
                <span>
                  <span className="block text-sm font-medium capitalize">
                    Sign in as {account.role}
                  </span>
                  <span className="block text-xs text-muted-foreground">{account.blurb}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{account.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
