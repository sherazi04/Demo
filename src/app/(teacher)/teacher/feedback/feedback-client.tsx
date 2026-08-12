"use client";

import { useState } from "react";
import {
  AiGeneratedBadge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
} from "@/components/ui/primitives";

interface Draft {
  whatIsCorrect: string;
  whatIsMissing: string;
  misconceptionIfAny: string | null;
  misconceptionExplanation: string | null;
  suggestedScore: number;
  scoreRationale: string;
  nextStep: string;
  citedChunkIds: string[];
}

interface QueueItem {
  attemptItemId: string;
  stem: string;
  response: string | null;
  correct: boolean | null;
  referenceAnswer: string | null;
  rubric: Array<{ criterion: string; points: number }> | null;
  answeredAt: string | null;
  feedback: Record<string, unknown> | null;
}

export function FeedbackClient({ items }: { items: QueueItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No short-answer responses waiting"
        hint="Multiple-choice answers get automated misconception feedback from the student engine instead."
      />
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <FeedbackCard key={item.attemptItemId} item={item} />
      ))}
    </div>
  );
}

function FeedbackCard({ item }: { item: QueueItem }) {
  const stored = item.feedback as
    | { kind?: string; draft?: Draft; released?: boolean; model?: string }
    | null;

  const [draft, setDraft] = useState<Draft | null>(stored?.draft ?? null);
  const [released, setReleased] = useState(stored?.released === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable copies — what the student actually receives.
  const [whatIsCorrect, setWhatIsCorrect] = useState(stored?.draft?.whatIsCorrect ?? "");
  const [whatIsMissing, setWhatIsMissing] = useState(stored?.draft?.whatIsMissing ?? "");
  const [nextStep, setNextStep] = useState(stored?.draft?.nextStep ?? "");

  async function generate() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/teacher/coteacher/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptItemId: item.attemptItemId }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "Could not draft feedback.");
      setBusy(false);
      return;
    }

    const body = (await res.json()) as { draft: Draft };
    setDraft(body.draft);
    setWhatIsCorrect(body.draft.whatIsCorrect);
    setWhatIsMissing(body.draft.whatIsMissing);
    setNextStep(body.draft.nextStep);
    setBusy(false);
  }

  async function release() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/teacher/coteacher/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attemptItemId: item.attemptItemId,
        edited: { whatIsCorrect, whatIsMissing, nextStep, suggestedScore: draft?.suggestedScore },
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "Could not release the feedback.");
      setBusy(false);
      return;
    }

    setReleased(true);
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle className="text-sm">{item.stem}</CardTitle>
        <div className="flex items-center gap-2">
          {draft && <AiGeneratedBadge />}
          <StatusBadge
            kind={released ? "success" : draft ? "warning" : "pending"}
            label={released ? "released" : draft ? "draft — not sent" : "no draft"}
          />
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        <div className="rounded-md border bg-secondary/40 p-3">
          <p className="text-xs font-medium">Student response</p>
          <p className="mt-1 text-sm">{item.response ?? "(no response)"}</p>
        </div>

        {item.rubric && item.rubric.length > 0 && (
          <div className="text-xs">
            <p className="font-medium">Rubric</p>
            <ul className="mt-0.5 list-inside list-disc text-muted-foreground">
              {item.rubric.map((r) => (
                <li key={r.criterion}>
                  {r.criterion} ({r.points} points)
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!draft ? (
          <Button onClick={() => void generate()} disabled={busy}>
            {busy ? "Drafting…" : "Draft feedback"}
          </Button>
        ) : (
          <div className="space-y-3">
            {draft.misconceptionIfAny && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <p className="font-medium text-warning">
                  Misconception {draft.misconceptionIfAny}
                </p>
                {draft.misconceptionExplanation && (
                  <p className="mt-1">{draft.misconceptionExplanation}</p>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Suggested score:</span> {draft.suggestedScore}.{" "}
              {draft.scoreRationale}
            </p>

            {/* Editable before release — FR-TCH-051. */}
            <EditableField
              id={`correct-${item.attemptItemId}`}
              label="What is correct"
              value={whatIsCorrect}
              onChange={setWhatIsCorrect}
              disabled={released}
            />
            <EditableField
              id={`missing-${item.attemptItemId}`}
              label="What is missing"
              value={whatIsMissing}
              onChange={setWhatIsMissing}
              disabled={released}
            />
            <EditableField
              id={`next-${item.attemptItemId}`}
              label="Next step"
              value={nextStep}
              onChange={setNextStep}
              disabled={released}
            />

            {!released && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void release()} disabled={busy}>
                  {busy ? "Releasing…" : "Release to student"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  The student sees nothing until you do this. The release is audited.
                </span>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function EditableField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-70"
      />
    </div>
  );
}
