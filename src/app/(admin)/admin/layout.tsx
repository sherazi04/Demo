import Link from "next/link";
import { tryRequireRole, requireUser } from "@/auth/guard";
import { NotAuthorised } from "@/components/not-authorised";
import { SignOutButton } from "@/components/sign-out-button";

const NAV = [
  { href: "/admin", label: "Status" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/enrolment", label: "Enrolment" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/bias", label: "Bias monitor" },
  { href: "/admin/validation", label: "Validation" },
];

/**
 * Admin panel — operational and tabular (design.md §12). Denser than the
 * student panel, plainer than the teacher panel: this is an operations
 * console, not a workspace.
 *
 * As in the teacher layout, the non-throwing guard renders an explanation
 * instead of a 500. The denial is audited inside the guard either way.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await tryRequireRole("admin");
  if (!actor) {
    const self = await requireUser();
    return <NotAuthorised panel="admin" role={self.role} />;
  }

  return (
    <div data-panel="admin" className="min-h-screen bg-background">
      <header className="border-b bg-secondary/50">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold">Administration</span>
            <span className="text-xs text-muted-foreground">Dual-Engine Learning Framework</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{actor.name}</span>
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="px-6 py-6">
        {children}
      </main>
    </div>
  );
}
