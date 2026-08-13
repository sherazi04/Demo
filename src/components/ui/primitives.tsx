import { cn } from "@/lib/utils";

/**
 * The shared component library used by all three panels (NFR-UX-001).
 *
 * Panels differ only by the CSS custom properties their layout sets, so the
 * same components read as three distinct products without three codebases.
 *
 * Accessibility rules that are enforced structurally here rather than left to
 * each caller: status is always icon + text (never colour alone, NFR-UX-003),
 * progress is always determinate where a total is known (NFR-UX-004), and
 * every meter carries its numeric value in text.
 */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-border px-6 py-4", className)}>{children}</div>;
}

export function CardTitle({ className, children }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("font-display text-base font-semibold tracking-tight", className)}>
      {children}
    </h2>
  );
}

export function CardBody({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5", className)}>{children}</div>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

/**
 * The primary action carries the teal-to-amethyst gradient — the two engines
 * meeting, used only for the one thing a screen most wants you to do.
 *
 * Its text is the deep navy rather than white. White on that gradient measures
 * roughly 1.9:1 against the teal end and fails AA outright; the navy clears 8:1
 * and keeps the gradient exactly as designed (NFR-UX-002).
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-gradient-engine text-[hsl(211_76%_8%)] font-semibold hover:brightness-110",
  secondary: "border border-border bg-transparent text-foreground hover:bg-primary/10",
  ghost: "text-muted-foreground hover:bg-primary/10 hover:text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:brightness-110",
};

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export type StatusKind = "pending" | "running" | "success" | "warning" | "error" | "info";

/** Text glyphs rather than colour-only dots — colour is never the sole signal. */
const STATUS_GLYPH: Record<StatusKind, string> = {
  pending: "○",
  running: "◐",
  success: "✓",
  warning: "!",
  error: "✕",
  info: "i",
};

const STATUS_STYLE: Record<StatusKind, string> = {
  pending: "border-border text-muted-foreground",
  running: "border-primary/40 bg-primary/10 text-primary",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-border bg-secondary text-secondary-foreground",
};

/**
 * Status is conveyed by a glyph AND a text label, so it survives greyscale,
 * colour-blindness and a screen reader.
 */
export function StatusBadge({
  kind,
  label,
  className,
}: {
  kind: StatusKind;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "label-mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        STATUS_STYLE[kind],
        className,
      )}
    >
      <span aria-hidden="true">{STATUS_GLYPH[kind]}</span>
      {label}
    </span>
  );
}

/**
 * Determinate progress bar with its value in text (NFR-UX-004).
 * `max` of 0 renders an indeterminate state honestly rather than showing 0%.
 */
export function ProgressBar({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const known = max > 0;
  const percent = known ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {known ? `${value} / ${max} (${percent}%)` : "working…"}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={known ? value : undefined}
        aria-valuemin={0}
        aria-valuemax={known ? max : undefined}
        aria-label={label}
        aria-valuetext={known ? `${percent}%` : "in progress, total unknown"}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cn(
            "h-full rounded-full bg-gradient-engine transition-all",
            !known && "w-1/3 animate-pulse",
          )}
          style={known ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}

/**
 * Mastery is shown as a bar AND a numeric percentage (design.md §12).
 */
export function MasteryMeter({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{percent}%</span>
      </div>
      <div
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${percent} percent`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className="h-full rounded-full bg-gradient-engine"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Every AI-generated artifact carries this marker (FR-GOV-013). It is a
 * component rather than a convention so it cannot be forgotten on a new view.
 */
export function AiGeneratedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "label-mono inline-flex items-center gap-1 rounded-full border border-governance/40 bg-governance/10 px-2 py-0.5 text-governance",
        className,
      )}
      title="Generated by an AI model and subject to review"
    >
      <span aria-hidden="true">✧</span> AI-generated
    </span>
  );
}

/** Persistent synthetic-data marker (R9, FR §4.4). */
export function SyntheticBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "label-mono inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning",
        className,
      )}
      title="Simulated data — demonstrates nothing about real learning"
    >
      <span aria-hidden="true">⚗</span> synthetic
    </span>
  );
}

/**
 * Sample size printed next to every metric (honesty rule 5). A figure without
 * an n is not reportable, so this component makes omitting it visible.
 */
export function MetricValue({
  value,
  sampleSize,
  label,
  hint,
}: {
  value: string;
  sampleSize: number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold tabular-nums text-primary">{value}</span>
        <span className="label-mono text-muted-foreground">n = {sampleSize}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
