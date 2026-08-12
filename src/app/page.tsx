import { redirect } from "next/navigation";
import { auth } from "@/auth/config";

/**
 * Role-based landing. This is a convenience redirect, not authorization — each
 * destination re-checks with the server-side guard.
 */
export default async function RootPage() {
  const session = await auth();
  const role = session?.user?.role;

  if (!role) redirect("/login");
  if (role === "admin") redirect("/admin");
  if (role === "teacher") redirect("/teacher");
  redirect("/student");
}
