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
import { bloomLabel, formatCitation } from "@/lib/utils";

interface QueueItem {
  chunkId: string;
  text: string;
  materialTitle: string;
  sectionPath: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  topicId: string | null;
  topicCode: string | null;
  topicTitle: string | null;
  bloomLevel: number | null;
  difficulty: number | null;
  lomFormat: string | null;
  resourceType: string | null;
  tagConfidence: number | null;
  cloIds: string[];
  reasoning: string | null;
  keywords: string[];
  driftReasons: string[];
  verified: boolean;
  verifiedAt: string | null;
}

interface Stats {
  total: number;
  unverified: number;
  untagged: number;
  drifted: number;
  lowConfidence: number;
}

interface Options {
  topics: Array<{ id: string; code: string; title: string; week: number }>;
  clos: Array<{ id: string; code: string; statement: string; bloomLevel: number }>;
}

const LOM_FORMATS = [
  "definition",
  "worked_example",
  "proof",
  "exercise",
  "figure",
  "code",
  "narrative",
] as const;

export function TagReviewClient({
  courseId,
  initialItems,
  initialStats,
  options,
}: {
  courseId: string;
  initialItems: QueueItem[];
  initialStats: Stats;
  options: Options;
}) {
  const [items, setItems] = useState(initialItems);
  const [stats, setStats] = useState(initialStats);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/tags/queue?courseId=${courseId}&limit=50`);
    if (!response.ok) return;
    const body = (await response.json()) as { items: QueueItem[]; stats: Stats };
    setItems(body.items);
    setStats(body.stats);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Chunks" value={stats.total} />
        <StatTile label="Awaiting review" value={stats.unverified} />
        <StatTile label="Untagged" value={stats.untagged} tone={stats.untagged > 0 ? "warn" : undefined} />
        <StatTile label="Drift failures" value={stats.drifted} tone={stats.drifted > 0 ? "error" : undefined} />
        <StatTile label="Low confidence" value={stats.lowConfidence} />
      </div>

      {message && (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {message}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          hint="Every chunk in this course has been verified, or no material has been ingested yet."
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ReviewCard
              key={item.chunkId}
              item={item}
              options={options}
              onSaved={async (note) => {
                setMessage(note);
                await refresh();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "error";
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === "error"
            ? "text-lg font-semibold tabular-nums text-destructive"
            : tone === "warn"
              ? "text-lg font-semibold tabular-nums text-warning"
              : "text-lg font-semibold tabular-nums"
        }
      >
        {value}
      </div>
    </div>
  );
}

function ReviewCard({
  item,
  options,
  onSaved,
}: {
  item: QueueItem;
  options: Options;
  onSaved: (note: string) => Promise<void>;
}) {
  const [topicId, setTopicId] = useState(item.topicId ?? "");
  const [bloomLevel, setBloomLevel] = useState(item.bloomLevel ?? 2);
  const [difficulty, setDifficulty] = useState(item.difficulty ?? 0.5);
  const [lomFormat, setLomFormat] = useState(item.lomFormat ?? "narrative");
  const [cloIds, setCloIds] = useState<string[]>(item.cloIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confidence = item.tagConfidence;
  const confidenceKind =
    item.driftReasons.length > 0
      ? "error"
      : confidence === null
        ? "pending"
        : confidence < 0.6
          ? "warning"
          : "success";

  async function save() {
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/tags/${item.chunkId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topicId: topicId || null,
        bloomLevel,
        difficulty,
        lomFormat,
        resourceType: item.resourceType,
        cloIds,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "Could not save the correction.");
      setSaving(false);
      return;
    }

    const body = (await response.json()) as { graphResynced: boolean };
    await onSaved(
      body.graphResynced
        ? "Correction saved and the knowledge graph was re-synced."
        : "Correction saved.",
    );
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="truncate">{item.materialTitle}</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatCitation(item)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AiGeneratedBadge />
          <StatusBadge
            kind={confidenceKind}
            label={
              item.driftReasons.length > 0
                ? "drift failure"
                : confidence === null
                  ? "untagged"
                  : `confidence ${(confidence * 100).toFixed(0)}%`
            }
          />
          {item.verified && <StatusBadge kind="success" label="verified" />}
        </div>
      </CardHeader>

      <CardBody className="grid gap-6 lg:grid-cols-2">
        {/* Left: the chunk itself, with the tagger's reasoning beneath it. */}
        <div className="space-y-3">
          <div className="max-h-64 overflow-y-auto rounded-md border bg-secondary/40 p-3 text-sm leading-relaxed">
            {item.text}
          </div>

          {item.driftReasons.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              <p className="font-medium">The tagger referenced something outside the curriculum:</p>
              <ul className="mt-1 list-inside list-disc">
                {item.driftReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="mt-1">
                Confidence was forced to zero and the tag was not applied. Assign the correct
                topic below.
              </p>
            </div>
          )}

          {item.reasoning && (
            <div className="rounded-md border p-3 text-xs">
              <p className="font-medium">Tagger&rsquo;s reasoning</p>
              <p className="mt-1 text-muted-foreground">{item.reasoning}</p>
              {item.keywords.length > 0 && (
                <p className="mt-2 text-muted-foreground">
                  <span className="font-medium text-foreground">Keywords:</span>{" "}
                  {item.keywords.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: the correction form. */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={`topic-${item.chunkId}`} className="block text-sm font-medium">
              Topic
            </label>
            <select
              id={`topic-${item.chunkId}`}
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— not assigned —</option>
              {options.topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.code} · {topic.title} (week {topic.week})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`bloom-${item.chunkId}`} className="block text-sm font-medium">
                Bloom level
              </label>
              <select
                id={`bloom-${item.chunkId}`}
                value={bloomLevel}
                onChange={(e) => setBloomLevel(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {[1, 2, 3, 4, 5, 6].map((level) => (
                  <option key={level} value={level}>
                    {level} — {bloomLabel(level)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`format-${item.chunkId}`} className="block text-sm font-medium">
                LOM format
              </label>
              <select
                id={`format-${item.chunkId}`}
                value={lomFormat}
                onChange={(e) => setLomFormat(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {LOM_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`difficulty-${item.chunkId}`} className="block text-sm font-medium">
              Difficulty <span className="tabular-nums text-muted-foreground">({difficulty.toFixed(2)})</span>
            </label>
            <input
              id={`difficulty-${item.chunkId}`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Evidence for CLOs</legend>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {options.clos.map((clo) => (
                <label key={clo.id} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={cloIds.includes(clo.id)}
                    onChange={(e) =>
                      setCloIds((prev) =>
                        e.target.checked
                          ? [...prev, clo.id]
                          : prev.filter((id) => id !== clo.id),
                      )
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{clo.code}</span>{" "}
                    <span className="text-muted-foreground">
                      (Bloom {clo.bloomLevel}) {clo.statement.slice(0, 90)}…
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? "Saving…" : "Save correction and mark verified"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
