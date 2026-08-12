"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ProgressBar,
  StatusBadge,
  type StatusKind,
} from "@/components/ui/primitives";

interface MaterialRow {
  id: string;
  title: string;
  filename: string;
  sizeBytes: number;
  status: string;
  progress: number;
  error: string | null;
  pageCount: number | null;
  chunkCount: number;
  licenseNote: string;
  createdAt: string;
  indexedAt: string | null;
}

interface JobRow {
  stage: string;
  status: "queued" | "running" | "done" | "failed";
  itemsDone: number;
  itemsTotal: number;
  attempts: number;
  message: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  parse: "Parse",
  chunk: "Chunk",
  tag: "LOM tag",
  embed: "Embed",
  index: "Index",
  kg_link: "Graph link",
};

const JOB_STATUS_KIND: Record<JobRow["status"], StatusKind> = {
  queued: "pending",
  running: "running",
  done: "success",
  failed: "error",
};

export function MaterialsClient({
  courseId,
  initialMaterials,
}: {
  courseId: string;
  initialMaterials: MaterialRow[];
}) {
  const [materials, setMaterials] = useState(initialMaterials);
  const [jobsByMaterial, setJobsByMaterial] = useState<Record<string, JobRow[]>>({});
  const [error, setError] = useState<string | null>(null);

  /** Materials still moving through the pipeline — only these need polling. */
  const active = materials.filter((m) => m.status !== "indexed" && m.status !== "failed");
  const activeIds = active.map((m) => m.id).join(",");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/materials?courseId=${courseId}`);
    if (!response.ok) return;
    const body = (await response.json()) as { materials: MaterialRow[] };
    setMaterials(body.materials);
  }, [courseId]);

  useEffect(() => {
    if (activeIds.length === 0) return;

    let cancelled = false;
    const ids = activeIds.split(",").filter(Boolean);

    const tick = async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          const response = await fetch(`/api/materials/${id}/jobs`);
          if (!response.ok) return [id, []] as const;
          const body = (await response.json()) as { jobs: JobRow[] };
          return [id, body.jobs] as const;
        }),
      );
      if (cancelled) return;
      setJobsByMaterial((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      await refresh();
    };

    void tick();
    // Polling rather than websockets: the stage table is the source of truth
    // and a 1.5s poll is well within what a progress bar needs.
    const timer = setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeIds, refresh]);

  return (
    <div className="space-y-6">
      <UploadForm courseId={courseId} onUploaded={refresh} onError={setError} />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {materials.length === 0 ? (
        <EmptyState
          title="No material uploaded yet"
          hint="Upload a PDF, DOCX, PPTX, TXT or MD file to build the retrievable corpus."
        />
      ) : (
        <div className="space-y-4">
          {materials.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              jobs={jobsByMaterial[material.id] ?? []}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialCard({
  material,
  jobs,
  onChanged,
}: {
  material: MaterialRow;
  jobs: JobRow[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const retry = async (stage: string) => {
    setBusy(true);
    await fetch(`/api/materials/${material.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    await onChanged();
    setBusy(false);
  };

  const statusKind: StatusKind =
    material.status === "indexed" ? "success" : material.status === "failed" ? "error" : "running";

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>{material.title}</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {material.filename} · {(material.sizeBytes / 1024).toFixed(0)} KB
            {material.pageCount ? ` · ${material.pageCount} pages` : ""}
            {material.chunkCount > 0 ? ` · ${material.chunkCount} chunks` : ""}
          </p>
        </div>
        <StatusBadge kind={statusKind} label={material.status} />
      </CardHeader>

      <CardBody className="space-y-4">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Licence:</span> {material.licenseNote}
        </p>

        {material.error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {material.error}
          </p>
        )}

        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <li key={job.stage} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {STAGE_LABELS[job.stage] ?? job.stage}
                </span>
                <StatusBadge kind={JOB_STATUS_KIND[job.status]} label={job.status} />
              </div>

              <ProgressBar
                value={job.itemsDone}
                max={job.itemsTotal}
                label={job.status === "done" ? "complete" : "items"}
              />

              {job.message && (
                <p className="mt-2 text-xs text-destructive">{job.message}</p>
              )}

              {job.status === "failed" && (
                <Button
                  variant="secondary"
                  className="mt-2 w-full text-xs"
                  disabled={busy}
                  onClick={() => void retry(job.stage)}
                >
                  Retry this stage
                </Button>
              )}
            </li>
          ))}
        </ol>

        {jobs.length === 0 && material.status !== "indexed" && (
          <p className="text-sm text-muted-foreground">Waiting for the worker to pick this up…</p>
        )}
      </CardBody>
    </Card>
  );
}

function UploadForm({
  courseId,
  onUploaded,
  onError,
}: {
  courseId: string;
  onUploaded: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    form.set("courseId", courseId);

    const response = await fetch("/api/materials", { method: "POST", body: form });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      onError(body?.error?.message ?? "Upload failed.");
      setPending(false);
      return;
    }

    formRef.current?.reset();
    await onUploaded();
    setPending(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload material</CardTitle>
      </CardHeader>
      <CardBody>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="file" className="block text-sm font-medium">
                File
              </label>
              <input
                id="file"
                name="file"
                type="file"
                required
                accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs"
              />
              <p className="text-xs text-muted-foreground">PDF, DOCX, PPTX, TXT or MD.</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="title" className="block text-sm font-medium">
                Title
              </label>
              <input
                id="title"
                name="title"
                type="text"
                maxLength={300}
                placeholder="Defaults to the filename"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="licenseNote" className="block text-sm font-medium">
              Licensing note <span className="text-destructive">*</span>
            </label>
            <input
              id="licenseNote"
              name="licenseNote"
              type="text"
              required
              minLength={3}
              maxLength={1000}
              placeholder="e.g. Open Data Structures, CC BY 2.0 — or: institution-owned lecture notes"
              aria-describedby="license-help"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            {/* Required by FR-INT-012 — stated as a rule, not a nag. */}
            <p id="license-help" className="text-xs text-muted-foreground">
              Required. Only openly-licensed or institution-owned material may be ingested.
            </p>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Uploading…" : "Upload and start ingestion"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
