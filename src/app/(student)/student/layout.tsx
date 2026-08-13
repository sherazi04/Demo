import { requireUser } from "@/auth/guard";
import { PanelShell, type NavItem } from "@/components/panel-shell";

const NAV: readonly NavItem[] = [
  { href: "/student", label: "Today", icon: "◈" },
  { href: "/student/quiz", label: "Practice", icon: "◎" },
  { href: "/student/plan", label: "Learning plan", icon: "⊹" },
  { href: "/student/progress", label: "Progress", icon: "◑" },
  { href: "/student/resources", label: "Resources", icon: "≡" },
];

/**
 * Student panel — the Intelligence side, so teal throughout (design.md §12).
 *
 * Calmer than the teacher panel by construction: fewer destinations in the
 * rail, one primary action per screen. The shell and the component library are
 * identical across all three panels; only the tokens differ.
 */
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();

  return (
    <PanelShell
      panel="student"
      engineLabel="Student Engine"
      actorName={actor.name}
      nav={NAV}
      headerExtra={
        <p className="truncate text-sm text-muted-foreground">
          Welcome back, {actor.name.split(" ")[0]}
        </p>
      }
    >
      {children}
    </PanelShell>
  );
}
