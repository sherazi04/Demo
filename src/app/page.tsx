import { redirect } from "next/navigation";
import { auth } from "@/auth/config";
import { SetupRequired } from "@/components/setup-required";
import { missingSettings } from "@/lib/setup-status";

/**
 * Role-based landing. This is a convenience redirect, not authorization — each
 * destination re-checks with the server-side guard.
 */
export const dynamic = "force-dynamic";

export default async function RootPage() {
  // Before `auth()`, which reads AUTH_SECRET and throws when it is absent. A
  // deployment missing its configuration should say so, not return a 500.
  const missing = missingSettings();
  if (missing.length > 0) return <SetupRequired missing={missing} />;

  const session = await auth();
  const role = session?.user?.role;

  if (!role) redirect("/login");
  if (role === "admin") redirect("/admin");
  if (role === "teacher") redirect("/teacher");
  redirect("/student");
}
