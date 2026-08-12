"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkPasswordPolicy } from "@/auth/password-policy";

export function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Client-side policy is feedback only — the same check runs server-side in
  // setPasswordWithInvite, which is the enforcement point.
  const policy = checkPasswordPolicy(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!policy.ok) {
      setError(policy.problems.join(" "));
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setPending(true);
    const response = await fetch("/api/auth/set-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "Could not set the password. The link may have expired.");
      setPending(false);
      return;
    }

    router.push("/login");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-help"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <p id="password-help" className="text-xs text-muted-foreground">
          At least 12 characters. Length matters more than punctuation — a memorable phrase
          works well.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="confirm" className="block text-sm font-medium">
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch ? true : undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {mismatch && (
          <p className="text-xs text-destructive">The two passwords do not match.</p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !policy.ok || mismatch || confirm.length === 0}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Saving…" : "Set password and continue"}
      </button>
    </form>
  );
}
