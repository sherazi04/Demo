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
      className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b px-5 py-4", className)}>{children}</div>;
}

export function CardTitle({ className, children }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold tracking-tight", className)}>{children}</h2>;
}

export function CardBody({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
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
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
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
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
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
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-all",
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
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
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
        "inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground",
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
        "inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning",
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
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">n = {sampleSize}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed px-5 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
