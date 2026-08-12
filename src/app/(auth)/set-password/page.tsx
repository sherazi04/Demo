import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set your password · Dual-Engine Learning" };

/**
 * First-login password set. Reached from an invite link an administrator sends;
 * the token is validated server-side and consumed on success.
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center bg-secondary px-4 py-12"
    >
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-center text-2xl font-semibold tracking-tight">
          Set your password
        </h1>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          Choose a password for your account. You will use it to sign in from now on.
        </p>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          {token ? (
            <SetPasswordForm token={token} />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              This link is missing its invite token. Ask your administrator to reissue the
              invitation.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
