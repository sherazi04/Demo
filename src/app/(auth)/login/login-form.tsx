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
  prefill,
}: {
  initialError?: string;
  demoAccounts?: OfferedAccount[];
  /**
   * Set when a role card linked here with a seeded account for that role. Both
   * fields are filled, not just the email: filling only the email would land
   * someone on a form they still cannot submit, since the password is not
   * theirs to know. They stay visible and editable, so what is about to be
   * sent is never hidden.
   */
  prefill?: { email: string; password: string };
}) {
  const router = useRouter();
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [password, setPassword] = useState(prefill?.password ?? "");
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
            className="w-full rounded-md border border-border bg-input px-3 py-2.5 text-sm transition-colors focus:border-primary"
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
              className="w-full rounded-md border border-border bg-input py-2.5 pl-3 pr-16 text-sm transition-colors focus:border-primary"
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
          className="w-full rounded-md bg-gradient-engine px-4 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {prefill ? (
        <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          Filled in with a seeded demo account. Press <strong>Sign in</strong> to continue, or
          replace either field with your own credentials.
        </p>
      ) : (
        demoAccounts.length > 0 && (
          <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
            Seeded demo accounts are available — pick a role on the left and this form arrives
            ready. They appear because this is not a production environment and those accounts
            exist.
          </p>
        )
      )}
    </div>
  );
}
