import Link from "next/link";
import { requireUser } from "@/auth/guard";
import { SignOutButton } from "@/components/sign-out-button";

const NAV = [
  { href: "/student", label: "Today" },
  { href: "/student/quiz", label: "Practice" },
  { href: "/student/plan", label: "Plan" },
  { href: "/student/progress", label: "Progress" },
  { href: "/student/resources", label: "Resources" },
];

/**
 * Student panel — calm, one task per screen (design.md §12).
 *
 * Deliberately quieter than the teacher panel: fewer navigation items, more
 * whitespace, a single primary action per page. `data-panel` re-points the
 * shared tokens; the component library is identical across all three panels.
 */
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();

  return (
    <div data-panel="student" className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold">CS-201</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{actor.name}</span>
            <SignOutButton />
          </div>
        </div>
        <nav
          aria-label="Student sections"
          className="mx-auto flex max-w-3xl gap-1 px-4 pb-3"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}
