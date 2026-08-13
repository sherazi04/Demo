import { Sidebar, type NavItem } from "@/components/sidebar";
import { SignOutButton } from "@/components/sign-out-button";

export type { NavItem };

/**
 * The frame every panel sits in: a dark navigation rail on the left, a light
 * working surface on the right.
 *
 * One component rather than three copies, because the rail is what makes the
 * three panels read as one product. Panels differ by the tokens their
 * `data-panel` attribute re-points — teal for the Intelligence side, amethyst
 * for Governance — not by their structure.
 */
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
      <Sidebar engineLabel={engineLabel} nav={nav} actorName={actorName} />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-card/90 px-6 py-3 backdrop-blur">
          {/* Left padding on small screens clears the drawer button. */}
          <div className="min-w-0 pl-12 lg:pl-0">{headerExtra}</div>
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
          {stat.hint && <div className="label-mono mt-2 text-muted-foreground">{stat.hint}</div>}
        </div>
      ))}
    </div>
  );
}
