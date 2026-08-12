import Link from "next/link";
import { tryRequireRole, requireUser } from "@/auth/guard";
import { NotAuthorised } from "@/components/not-authorised";
import { SignOutButton } from "@/components/sign-out-button";

const NAV = [
  { href: "/teacher", label: "Dashboard" },
  { href: "/teacher/materials", label: "Materials" },
  { href: "/teacher/tags", label: "Tag review" },
  { href: "/teacher/generate", label: "Generate" },
  { href: "/teacher/bank", label: "Item bank" },
  { href: "/teacher/lecture", label: "Lecture" },
  { href: "/teacher/curriculum", label: "Curriculum" },
  { href: "/teacher/analytics", label: "Analytics" },
  { href: "/teacher/feedback", label: "Feedback" },
];

/**
 * Teacher panel — dense and work-oriented (design.md §12).
 *
 * `data-panel` re-points the shared colour tokens; the component library is
 * identical across all three panels. The guard call here is real enforcement
 * for everything this layout renders, not decoration — each child page and
 * route handler calls it again for its own data.
 *
 * The non-throwing variant is used so a student who follows a stale link meets
 * a sentence rather than a 500. The refusal is identical either way: it is
 * audited inside the guard, and children never render.
 */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const actor = await tryRequireRole("teacher");
  if (!actor) {
    const self = await requireUser();
    return <NotAuthorised panel="teacher" role={self.role} />;
  }

  return (
    <div data-panel="teacher" className="min-h-screen bg-secondary/40">
      <header className="border-b bg-background">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold">Teacher</span>
            <span className="text-xs text-muted-foreground">CS-201 · Dual-Engine</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{actor.name}</span>
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="Teacher sections" className="flex gap-1 overflow-x-auto px-4 pb-2">
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
