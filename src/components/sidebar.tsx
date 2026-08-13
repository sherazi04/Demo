"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The dark navigation rail.
 *
 * Three states rather than two, because a sidebar that suits a desktop is
 * wrong on a phone and vice versa:
 *
 *   desktop expanded  — 280px, icon and label
 *   desktop collapsed — 72px, icon only, label in a tooltip
 *   mobile            — hidden, slides in over the content when opened
 *
 * The collapsed choice is remembered in localStorage, so it survives navigation
 * and reloads. It is read in an effect rather than during render: reading it
 * during render would produce different markup on the server and the client and
 * cause a hydration mismatch.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Single glyph, kept as text so no icon set is needed and it survives zoom. */
  icon: string;
}

const STORAGE_KEY = "de.sidebar.collapsed";

export function Sidebar({
  engineLabel,
  nav,
  actorName,
}: {
  engineLabel: string;
  nav: readonly NavItem[];
  actorName: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  // Navigating on a phone should close the drawer; leaving it open would cover
  // the page the person just asked for.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  /** The deepest matching entry wins, so /teacher/bank does not also light /teacher. */
  const activeHref = nav
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      {/* ── mobile: the button that opens the drawer ────────────────────── */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
        className="fixed left-4 top-3.5 z-30 rounded-md border border-border bg-card p-2 text-foreground shadow-sm lg:hidden"
      >
        <span aria-hidden="true" className="block text-base leading-none">
          ☰
        </span>
      </button>

      {/* ── mobile: scrim ───────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        aria-label={`${engineLabel} navigation`}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200",
          "w-[280px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          collapsed && "lg:w-[72px]",
        )}
      >
        {/* ── brand ────────────────────────────────────────────────────── */}
        <div
          className={cn(
            "flex items-center gap-3 border-b border-sidebar-border px-4 py-4",
            collapsed && "lg:justify-center lg:px-2",
          )}
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-engine-bright font-display text-xs font-bold text-[hsl(211_76%_8%)]"
          >
            DE
          </span>
          <span className={cn("min-w-0", collapsed && "lg:hidden")}>
            <span className="block truncate font-display text-sm font-semibold">CS-201</span>
            <span className="label-mono block truncate text-sidebar-accent">{engineLabel}</span>
          </span>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="ml-auto rounded-md p-1 text-sidebar-muted hover:text-sidebar-foreground lg:hidden"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/* ── destinations ─────────────────────────────────────────────── */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent/15 font-medium text-sidebar-accent"
                    : "text-sidebar-muted hover:bg-sidebar-surface hover:text-sidebar-foreground",
                  collapsed && "lg:justify-center lg:px-2",
                )}
              >
                <span aria-hidden="true" className="shrink-0 text-base leading-none">
                  {item.icon}
                </span>
                <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* ── who you are, and the collapse control ────────────────────── */}
        <div className="border-t border-sidebar-border p-3">
          <p
            className={cn(
              "truncate px-3 pb-2 text-xs text-sidebar-muted",
              collapsed && "lg:hidden",
            )}
          >
            {actorName}
          </p>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={cn(
              "hidden w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-surface hover:text-sidebar-foreground lg:flex",
              collapsed && "lg:justify-center lg:px-2",
            )}
          >
            <span aria-hidden="true" className="shrink-0 text-base leading-none">
              {collapsed ? "»" : "«"}
            </span>
            <span className={cn(collapsed && "lg:hidden")}>Collapse</span>
          </button>
        </div>
      </aside>
    </>
  );
}
