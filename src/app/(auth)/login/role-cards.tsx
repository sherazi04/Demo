import Link from "next/link";
import { cn } from "@/lib/utils";
import type { OfferedAccount } from "@/auth/demo-accounts";

/**
 * The three role selectors.
 *
 * Each is a link to the sign-in form carrying its role, so the form knows which
 * account to prepare. Plain links rather than buttons that authenticate: the
 * click lands you on the form with the email already filled, which is a step
 * you can see and correct, instead of a session appearing without you having
 * typed anything.
 *
 * Being links, they also work with JavaScript disabled, open in a new tab on
 * middle-click, and are announced correctly as navigation.
 */

interface Role {
  id: "student" | "teacher" | "admin";
  title: string;
  icon: string;
  description: string;
  /** Teal for the Intelligence side, amethyst for Governance. */
  tone: "intelligence" | "governance";
}

const ROLES: readonly Role[] = [
  {
    id: "student",
    title: "Student Portal",
    icon: "🎓",
    description:
      "Adaptive learning pathways, real-time performance analytics, personalized outcome tracking.",
    tone: "intelligence",
  },
  {
    id: "teacher",
    title: "Faculty Dashboard",
    icon: "🪪",
    description:
      "Design curriculum meta-structures, monitor cohort progression, predictive intervention models.",
    tone: "intelligence",
  },
  {
    id: "admin",
    title: "System Administrator",
    icon: "🛡",
    description:
      "Govern global meta-tags, configure compliance rubrics, manage institutional data pipelines.",
    tone: "governance",
  },
];

export function RoleCards({ demoAccounts }: { demoAccounts: OfferedAccount[] }) {
  return (
    <div className="space-y-3">
      {ROLES.map((role) => {
        const account = demoAccounts.find((candidate) => candidate.role === role.id);

        return (
          <Link
            key={role.id}
            href={`/login?role=${role.id}#sign-in`}
            scroll
            className={cn(
              "glow-hover flex w-full items-start gap-4 rounded-lg border bg-card p-5 text-left",
              role.tone === "governance" ? "border-governance/30" : "border-border",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg",
                role.tone === "governance"
                  ? "bg-governance/10 text-governance"
                  : "bg-primary/10 text-primary",
              )}
            >
              {role.icon}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-semibold">{role.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                {role.description}
              </span>
              <span
                className={cn(
                  "label-mono mt-3 block",
                  role.tone === "governance" ? "text-governance" : "text-primary",
                )}
              >
                Authenticate →
              </span>
              {account && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Demo account available: {account.name}
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
