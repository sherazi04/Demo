"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AiGeneratedBadge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
  type StatusKind,
} from "@/components/ui/primitives";
import { bloomLabel } from "@/lib/utils";

interface ValidationCheck {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
}

interface BankItem {
  id: string;
  type: string;
  stem: string;
  options: Array<{ key: string; text: string; correct: boolean; rationale: string }> | null;
  referenceAnswer: string | null;
  explanation: string;
  targetBloom: number;
  measuredBloom: number | null;
  difficultyElo: number;
  timesServed: number;
  timesCorrect: number;
  status: string;
  validation: { passed: boolean; checks: ValidationCheck[]; failures: string[] } | null;
  sourceChunkIds: string[];
  generatedByModel: string | null;
  reviewNote: string | null;
  createdAt: string;
  cloCode: string;
  topicCode: string;
  topicTitle: string;
}

const STATUS_KIND: Record<string, StatusKind> = {
  approved: "success",
  pending: "info",
  rejected: "error",
  draft: "pending",
  retired: "pending",
};

export function BankClient({ items: initial }: { items: BankItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = filter === "all" ? items : items.filter((i) => i.status === filter);

  const counts = {
    all: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    approved: items.filter((i) => i.status === "approved").length,
    rejected: items.filter((i) => i.status === "rejected").length,
  };

  async function act(id: string, action: "approve" | "reject", note?: string) {
    setBusy(id);
    setError(null);

    const res = await fetch(`/api/teacher/bank/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "reject" ? { action, note: note ?? "Rejected by teacher" } : { action }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      // Approving a failed item is refused by the service layer AND a database
      // constraint — the message says which rule blocked it.
      setError(body?.error?.message ?? "That action was refused.");
      setBusy(null);
      return;
    }

    const { status } = (await res.json()) as { status: string };
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "approved", "rejected"] as const).map((key) => (
          <Button
            key={key}
            variant={filter === key ? "primary" : "secondary"}
            className="text-xs"
            onClick={() => setFilter(key)}
          >
            {key} ({counts[key]})
          </Button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title="No items"
          hint="Generate an assessment from the Generate tab."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <Card key={item.id}>
              <CardHeader className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-sm">
                    {item.cloCode} · {item.topicCode} {item.topicTitle}
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.type.toUpperCase()} · requested Bloom {item.targetBloom} (
                    {bloomLabel(item.targetBloom)})
                    {item.measuredBloom !== null && (
                      <>
                        {" "}
                        · measured {item.measuredBloom}
                        {item.measuredBloom !== item.targetBloom && (
                          <span className="text-destructive"> (mismatch)</span>
                        )}
                      </>
                    )}
                    {" · Elo "}
                    {item.difficultyElo.toFixed(2)}
                    {item.timesServed > 0
                      ? ` · served ${item.timesServed}×, ${Math.round((item.timesCorrect / item.timesServed) * 100)}% correct`
                      : " · no responses yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <AiGeneratedBadge />
                  <StatusBadge kind={STATUS_KIND[item.status] ?? "info"} label={item.status} />
                </div>
              </CardHeader>

              <CardBody className="space-y-3">
                <p className="text-sm">{item.stem}</p>

                {item.options && (
                  <ul className="space-y-1 text-xs">
                    {item.options.map((option) => (
                      <li key={option.key} className="flex gap-2">
                        <span className="font-medium">{option.key}.</span>
                        <span>
                          {option.text}
                          {option.correct && (
                            <span className="ml-1 font-medium text-success">✓ correct</span>
                          )}
                          <br />
                          <span className="text-muted-foreground">{option.rationale}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {item.referenceAnswer && (
                  <p className="text-xs">
                    <span className="font-medium">Reference answer:</span>{" "}
                    <span className="text-muted-foreground">{item.referenceAnswer}</span>
                  </p>
                )}

                {/* Failure reasons shown beside accepted items — FR-VAL-009. */}
                {item.validation && !item.validation.passed && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                    <p className="text-xs font-medium text-destructive">
                      Failed validation — cannot be approved
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {item.validation.failures.map((failure) => (
                        <li key={failure} className="text-xs text-destructive">
                          {failure}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {item.validation && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      All {item.validation.checks.length} validation checks
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {item.validation.checks.map((check) => (
                        <li key={check.name} className="flex gap-2">
                          <span aria-hidden="true">{check.passed ? "✓" : "✕"}</span>
                          <span>
                            <span className="font-medium">{check.name}</span>{" "}
                            <span className="tabular-nums text-muted-foreground">
                              ({check.score.toFixed(2)})
                            </span>
                            <span className="sr-only">
                              {check.passed ? " passed" : " failed"}
                            </span>
                            <br />
                            <span className="text-muted-foreground">{check.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <p className="text-xs text-muted-foreground">
                  Grounded in {item.sourceChunkIds.length} chunk
                  {item.sourceChunkIds.length === 1 ? "" : "s"}
                  {item.generatedByModel ? ` · ${item.generatedByModel}` : ""}
                </p>

                {item.reviewNote && (
                  <p className="text-xs">
                    <span className="font-medium">Review note:</span>{" "}
                    <span className="text-muted-foreground">{item.reviewNote}</span>
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {item.status === "pending" && (
                    <>
                      <Button
                        className="text-xs"
                        disabled={busy === item.id}
                        onClick={() => void act(item.id, "approve")}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        className="text-xs"
                        disabled={busy === item.id}
                        onClick={() => void act(item.id, "reject")}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {item.status === "rejected" && item.validation?.passed && (
                    <Button
                      variant="secondary"
                      className="text-xs"
                      disabled={busy === item.id}
                      onClick={() => void act(item.id, "approve")}
                    >
                      Approve anyway
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
