import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class merge used by every UI component. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 0–1 score as a whole-number percentage, for the bar + numeric label pairs. */
export function toPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export const BLOOM_LABELS = [
  "",
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const;

export function bloomLabel(level: number | null | undefined): string {
  if (!level || level < 1 || level > 6) return "—";
  return BLOOM_LABELS[level] ?? "—";
}

/** Citation rendering: `section_path · pp. from–to` (design.md §12). */
export function formatCitation(locator: {
  sectionPath?: string | null;
  pageFrom?: number | null;
  pageTo?: number | null;
}): string {
  const parts: string[] = [];
  if (locator.sectionPath) parts.push(locator.sectionPath);
  if (locator.pageFrom != null) {
    parts.push(
      locator.pageTo != null && locator.pageTo !== locator.pageFrom
        ? `pp. ${locator.pageFrom}–${locator.pageTo}`
        : `p. ${locator.pageFrom}`,
    );
  }
  return parts.join(" · ") || "source";
}
