"use client";

import { useState } from "react";
import {
  AiGeneratedBadge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ProgressBar,
  StatusBadge,
} from "@/components/ui/primitives";
import { bloomLabel } from "@/lib/utils";

interface Clo {
  id: string;
  code: string;
  statement: string;
  bloomLevel: number;
}

interface Slot {
  cloId: string;
  bloomLevel: number;
  count: number;
  type: "mcq" | "saq";
}

interface CheckResult {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
}

interface ResultItem {
  index: number;
  questionId?: string;
  status: "generating" | "retrieved" | "pending" | "rejected" | "error";
  cloCode?: string;
  bloomLevel?: number;
  stem?: string;
  chunkCount?: number;
  failures?: string[];
  checks?: CheckResult[];
  message?: string;
}

export function GenerateClient({ courseId, clos }: { courseId: string; clos: Clo[] }) {
  const firstClo = clos[0];
  const [title, setTitle] = useState("Formative assessment");
  const [slots, setSlots] = useState<Slot[]>(
    firstClo
      ? [{ cloId: firstClo.id, bloomLevel: Math.min(3, firstClo.bloomLevel), count: 5, type: "mcq" }]
      : [],
  );
  const [difficulty, setDifficulty] = useState<[number, number]>([0.3, 0.8]);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<ResultItem[]>([]);
  const [summary, setSummary] = useState<{ accepted: number; rejected: number; errored: number } | null>(null);
  const [total, setTotal] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);

  const completed = items.filter((i) =>
    ["pending", "rejected", "error"].includes(i.status),
  ).length;

  async function run() {
    setRunning(true);
    setItems([]);
    setSummary(null);
    setFatal(null);

    const response = await fetch("/api/teacher/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId, title, slots, difficultyBand: difficulty }),
    });

    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setFatal(body?.error?.message ?? "Generation could not start.");
      setRunning(false);
      return;
    }

    // NDJSON: one event per line, so a partial trailing line is buffered.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim().length === 0) continue;
        applyEvent(JSON.parse(line));
      }
    }

    setRunning(false);
  }

  function applyEvent(event: Record<string, unknown>) {
    const kind = event["kind"] as string;

    if (kind === "start") {
      setTotal(event["totalItems"] as number);
      return;
    }
    if (kind === "done") {
      setSummary({
        accepted: event["accepted"] as number,
        rejected: event["rejected"] as number,
        errored: event["errored"] as number,
      });
      return;
    }
    if (kind === "fatal") {
      setFatal(event["message"] as string);
      return;
    }

    const index = event["index"] as number;
    setItems((prev) => {
      const next = [...prev];
      const existing = next.findIndex((i) => i.index === index);
      const base: ResultItem = next[existing] ?? { index, status: "generating" };

      let updated: ResultItem = base;
      if (kind === "item-start") {
        updated = {
          ...base,
          status: "generating",
          cloCode: event["cloCode"] as string,
          bloomLevel: event["bloomLevel"] as number,
        };
      } else if (kind === "item-retrieved") {
        updated = { ...base, status: "retrieved", chunkCount: event["chunkCount"] as number };
      } else if (kind === "item-done") {
        updated = {
          ...base,
          status: event["status"] as "pending" | "rejected",
          questionId: event["questionId"] as string,
          stem: event["stem"] as string,
          failures: event["failures"] as string[],
          checks: event["checks"] as CheckResult[],
        };
      } else if (kind === "item-error") {
        updated = { ...base, status: "error", message: event["message"] as string };
      }

      if (existing >= 0) next[existing] = updated;
      else next.push(updated);
      return next.sort((a, b) => a.index - b.index);
    });
  }

  const accepted = items.filter((i) => i.status === "pending");
  const rejected = items.filter((i) => i.status === "rejected");
  const errored = items.filter((i) => i.status === "error");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Blueprint</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="title" className="block text-sm font-medium">
              Assessment title
            </label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium">Slots</span>
            {slots.map((slot, index) => {
              const clo = clos.find((c) => c.id === slot.cloId);
              return (
                <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                  <div className="space-y-1">
                    <label htmlFor={`clo-${index}`} className="block text-xs font-medium">
                      Outcome
                    </label>
                    <select
                      id={`clo-${index}`}
                      value={slot.cloId}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((s, i) => (i === index ? { ...s, cloId: e.target.value } : s)),
                        )
                      }
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    >
                      {clos.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} (ceiling {c.bloomLevel})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor={`bloom-${index}`} className="block text-xs font-medium">
                      Bloom
                    </label>
                    <select
                      id={`bloom-${index}`}
                      value={slot.bloomLevel}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((s, i) =>
                            i === index ? { ...s, bloomLevel: Number(e.target.value) } : s,
                          ),
                        )
                      }
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    >
                      {[1, 2, 3, 4, 5, 6]
                        // A slot above its CLO's ceiling is rejected by the drift
                        // check, so it is not offered here.
                        .filter((l) => !clo || l <= clo.bloomLevel)
                        .map((level) => (
                          <option key={level} value={level}>
                            {level} — {bloomLabel(level)}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor={`type-${index}`} className="block text-xs font-medium">
                      Type
                    </label>
                    <select
                      id={`type-${index}`}
                      value={slot.type}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((s, i) =>
                            i === index ? { ...s, type: e.target.value as "mcq" | "saq" } : s,
                          ),
                        )
                      }
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="mcq">MCQ</option>
                      <option value="saq">SAQ</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor={`count-${index}`} className="block text-xs font-medium">
                      Count
                    </label>
                    <input
                      id={`count-${index}`}
                      type="number"
                      min={1}
                      max={20}
                      value={slot.count}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((s, i) =>
                            i === index ? { ...s, count: Number(e.target.value) } : s,
                          ),
                        )
                      }
                      className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                  </div>

                  {slots.length > 1 && (
                    <Button
                      variant="ghost"
                      className="text-xs"
                      onClick={() => setSlots((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              );
            })}

            <Button
              variant="secondary"
              className="text-xs"
              onClick={() =>
                setSlots((prev) => {
                  const clo = clos[0];
                  return clo
                    ? [...prev, { cloId: clo.id, bloomLevel: Math.min(3, clo.bloomLevel), count: 3, type: "mcq" }]
                    : prev;
                })
              }
            >
              Add slot
            </Button>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">
              Difficulty band{" "}
              <span className="tabular-nums text-muted-foreground">
                ({difficulty[0].toFixed(2)} – {difficulty[1].toFixed(2)})
              </span>
            </legend>
            <div className="flex max-w-sm items-center gap-3">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={difficulty[0]}
                aria-label="Minimum difficulty"
                onChange={(e) =>
                  setDifficulty(([, hi]) => [Math.min(Number(e.target.value), hi), hi])
                }
                className="w-full"
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={difficulty[1]}
                aria-label="Maximum difficulty"
                onChange={(e) =>
                  setDifficulty(([lo]) => [lo, Math.max(Number(e.target.value), lo)])
                }
                className="w-full"
              />
            </div>
          </fieldset>

          <Button onClick={() => void run()} disabled={running || slots.length === 0}>
            {running ? "Generating…" : "Generate assessment"}
          </Button>
        </CardBody>
      </Card>

      {fatal && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {fatal}
        </p>
      )}

      {(running || items.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <ProgressBar value={completed} max={total} label="items generated and validated" />
            {summary && (
              <p role="status" className="text-sm">
                <span className="font-medium">{summary.accepted}</span> passed validation,{" "}
                <span className="font-medium">{summary.rejected}</span> rejected,{" "}
                <span className="font-medium">{summary.errored}</span> errored.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {/*
        Accepted and rejected side by side — FR-VAL-009. The rejected column is
        not an error log: it is the evidence that the validation engine is doing
        something, and it is why the accuracy claim is inspectable.
      */}
      {items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-labelledby="accepted-heading" className="space-y-3">
            <h2 id="accepted-heading" className="text-sm font-semibold">
              Passed validation ({accepted.length})
            </h2>
            {accepted.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            )}
            {accepted.map((item) => (
              <ItemCard key={item.index} item={item} tone="success" />
            ))}
          </section>

          <section aria-labelledby="rejected-heading" className="space-y-3">
            <h2 id="rejected-heading" className="text-sm font-semibold">
              Rejected ({rejected.length + errored.length})
            </h2>
            {rejected.length + errored.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing rejected.</p>
            )}
            {rejected.map((item) => (
              <ItemCard key={item.index} item={item} tone="error" />
            ))}
            {errored.map((item) => (
              <Card key={item.index}>
                <CardBody>
                  <StatusBadge kind="warning" label="could not generate" />
                  <p className="mt-2 text-sm text-muted-foreground">{item.message}</p>
                </CardBody>
              </Card>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, tone }: { item: ResultItem; tone: "success" | "error" }) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {item.cloCode} · Bloom {item.bloomLevel}
          </span>
          {item.chunkCount !== undefined && <span>{item.chunkCount} source chunks</span>}
        </div>
        <div className="flex items-center gap-2">
          <AiGeneratedBadge />
          <StatusBadge
            kind={tone === "success" ? "success" : "error"}
            label={tone === "success" ? "awaiting approval" : "rejected"}
          />
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm">{item.stem}</p>

        {item.failures && item.failures.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <p className="text-xs font-medium text-destructive">Why this was rejected</p>
            <ul className="mt-1 space-y-1">
              {item.failures.map((failure) => (
                <li key={failure} className="text-xs text-destructive">
                  {failure}
                </li>
              ))}
            </ul>
          </div>
        )}

        {item.checks && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              All {item.checks.length} validation checks
            </summary>
            <ul className="mt-2 space-y-1.5">
              {item.checks.map((check) => (
                <li key={check.name} className="flex gap-2">
                  <span aria-hidden="true">{check.passed ? "✓" : "✕"}</span>
                  <span>
                    <span className="font-medium">{check.name}</span>{" "}
                    <span className="tabular-nums text-muted-foreground">
                      ({check.score.toFixed(2)})
                    </span>
                    <span className="sr-only">{check.passed ? " passed" : " failed"}</span>
                    <br />
                    <span className="text-muted-foreground">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardBody>
    </Card>
  );
}
