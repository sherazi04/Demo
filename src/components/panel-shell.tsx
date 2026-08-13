import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The frame every panel sits in: a 280px navigation rail on the left, a top bar
 * naming the engine, and the page beneath it.
 *
 * One component rather than three copies, because the rail is the thing that
 * makes the three panels read as one product. Panels differ by the tokens their
 * `data-panel` attribute re-points — teal for the Intelligence side, amethyst
 * for Governance — not by their structure.
 *
 * Below `lg` the rail becomes a horizontal scrolling bar. A 280px sidebar on a
 * phone leaves nothing for the content it is meant to navigate.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Single glyph. Kept as text so no icon set is needed and it survives zoom. */
  icon: string;
}

export function PanelShell({
  panel,
  engineLabel,
  actorName,
  nav,
  children,
  headerExtra,
}: {
  panel: "student" | "teacher" | "admin";
  engineLabel: string;
  actorName: string;
  nav: readonly NavItem[];
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  return (
    <div data-panel={panel} className="min-h-screen bg-background lg:flex">
      {/* ── navigation rail ─────────────────────────────────────────────── */}
      <aside
        className="border-b border-border bg-surface-1 lg:h-screen lg:w-[280px] lg:shrink-0 lg:border-b-0 lg:border-r"
        aria-label={`${engineLabel} sections`}
      >
        <div className="lg:sticky lg:top-0">
          <div className="flex items-center gap-3 px-6 py-5">
            {/*
              The mark is the two engines as one shape: a gradient square with
              the course code. Cheaper than an SVG asset and it inherits the
              panel's accent automatically.
            */}
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-engine font-display text-xs font-bold text-[hsl(211_76%_8%)]"
            >
              DE
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-sm font-semibold">CS-201</span>
              <span className="label-mono block truncate text-primary">{engineLabel}</span>
            </span>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground lg:shrink"
              >
                <span aria-hidden="true" className="text-base leading-none opacity-70">
                  {item.icon}
                </span>
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      {/* ── content column ──────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">{headerExtra}</div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{actorName}</span>
            <SignOutButton />
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1400px] px-6 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The stat strip that opens each dashboard. Figures are display-face and
 * accented; their captions stay muted, so the number is what the eye lands on.
 */
export function StatStrip({
  stats,
}: {
  stats: ReadonlyArray<{ value: string; label: string; hint?: string }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="glass rounded-lg px-6 py-5">
          <div className="font-display text-3xl font-semibold tabular-nums text-primary">
            {stat.value}
          </div>
          <div className="mt-1 text-sm text-foreground">{stat.label}</div>
          {stat.hint && (
            <div className="label-mono mt-2 text-muted-foreground">{stat.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}
