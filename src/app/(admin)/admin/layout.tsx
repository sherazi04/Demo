import { tryRequireRole, requireUser } from "@/auth/guard";
import { NotAuthorised } from "@/components/not-authorised";
import { PanelShell, type NavItem } from "@/components/panel-shell";

const NAV: readonly NavItem[] = [
  { href: "/admin", label: "Status", icon: "◈" },
  { href: "/admin/users", label: "Users & roles", icon: "◍" },
  { href: "/admin/enrolment", label: "Enrolment", icon: "⊞" },
  { href: "/admin/audit", label: "Audit log", icon: "⛓" },
  { href: "/admin/validation", label: "Curriculum validation", icon: "✓" },
  { href: "/admin/bias", label: "Bias monitoring", icon: "◑" },
  { href: "/admin/settings", label: "Settings", icon: "⚙" },
];

/**
 * Admin panel — the Governance side, so amethyst dominant (design.md §12).
 *
 * An operations console rather than a workspace: tabular, plain, outlined
 * controls rather than filled ones, which is what visually separates it from
 * the teal-led Student and Teacher panels.
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
    <PanelShell
      panel="admin"
      engineLabel="Governance Layer"
      actorName={actor.name}
      nav={NAV}
      headerExtra={
        <p className="truncate text-sm text-muted-foreground">
          Institutional configuration and oversight
        </p>
      }
    >
      {children}
    </PanelShell>
  );
}
