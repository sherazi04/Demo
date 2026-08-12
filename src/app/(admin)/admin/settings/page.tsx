import { requireRole } from "@/auth/guard";
import { getConfig } from "@/lib/config";
import { SettingsClient } from "./settings-client";

export const metadata = { title: "Settings · Admin" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireRole("admin");
  const config = await getConfig();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Runtime settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes take effect within a few seconds — no redeploy. Every change records its
          before and after values in the audit log.
        </p>
      </div>

      <SettingsClient initial={config} />
    </div>
  );
}
