import { tryRequireRole, requireUser } from "@/auth/guard";
import { NotAuthorised } from "@/components/not-authorised";
import { PanelShell, type NavItem } from "@/components/panel-shell";

const NAV: readonly NavItem[] = [
  { href: "/teacher", label: "Dashboard", icon: "◈" },
  { href: "/teacher/materials", label: "Materials", icon: "▤" },
  { href: "/teacher/tags", label: "Tag review", icon: "◫" },
  { href: "/teacher/generate", label: "Generate", icon: "✧" },
  { href: "/teacher/bank", label: "Item bank", icon: "◰" },
  { href: "/teacher/lecture", label: "Lecture co-pilot", icon: "◐" },
  { href: "/teacher/curriculum", label: "Curriculum", icon: "⊹" },
  { href: "/teacher/analytics", label: "Analytics", icon: "◱" },
  { href: "/teacher/feedback", label: "AI co-teacher", icon: "◇" },
];

/**
 * Teacher panel — works across both engines, so teal leads with amethyst
 * highlights (design.md §12). Dense and work-oriented: nine destinations
 * against the student panel's five.
 *
 * The non-throwing guard is used so a student who follows a stale link meets a
 * sentence rather than a 500. The refusal is identical either way: it is
 * audited inside the guard, and children never render.
 */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const actor = await tryRequireRole("teacher");
  if (!actor) {
    const self = await requireUser();
    return <NotAuthorised panel="teacher" role={self.role} />;
  }

  return (
    <PanelShell
      panel="teacher"
      engineLabel="Teacher Engine"
      actorName={actor.name}
      nav={NAV}
      headerExtra={
        <p className="truncate text-sm text-muted-foreground">
          CS-201 · Data Structures &amp; Algorithms
        </p>
      }
    >
      {children}
    </PanelShell>
  );
}
