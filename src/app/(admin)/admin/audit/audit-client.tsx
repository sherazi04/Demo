"use client";

import { useState } from "react";
import { Button, Card, CardBody, CardHeader, CardTitle, StatusBadge } from "@/components/ui/primitives";

interface AuditRecord {
  seq: number;
  createdAt: string;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  model: string | null;
  effort: string | null;
  promptHash: string | null;
  retrievedChunkIds: string[] | null;
  outputHash: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  outcome: string;
  correlationId: string | null;
  hash: string;
}

interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBrokenSeq: number | null;
  reason: string | null;
  detail: string | null;
  message: string;
}

export function AuditClient({
  initialRecords,
  totals,
}: {
  initialRecords: AuditRecord[];
  totals: { records: number; inputTokens: number; outputTokens: number; refusals: number; errors: number };
}) {
  const [records] = useState(initialRecords);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  async function runVerify() {
    setVerifying(true);
    const res = await fetch("/api/admin/audit/verify", { method: "POST" });
    setVerify((await res.json()) as VerifyResult);
    setVerifying(false);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Records" value={totals.records} />
        <Tile label="Input tokens" value={totals.inputTokens} />
        <Tile label="Output tokens" value={totals.outputTokens} />
        <Tile label="Refusals" value={totals.refusals} />
        <Tile label="Errors" value={totals.errors} tone={totals.errors > 0 ? "warn" : undefined} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Chain integrity</CardTitle>
          <Button onClick={() => void runVerify()} disabled={verifying}>
            {verifying ? "Verifying…" : "Verify chain"}
          </Button>
        </CardHeader>
        <CardBody>
          {verify ? (
            <div
              role="status"
              className={
                verify.ok
                  ? "rounded-md border border-success/40 bg-success/10 p-3"
                  : "rounded-md border border-destructive/40 bg-destructive/10 p-3"
              }
            >
              <div className="flex items-center gap-2">
                <StatusBadge
                  kind={verify.ok ? "success" : "error"}
                  label={verify.ok ? "intact" : "broken"}
                />
                <p className="text-sm font-medium">{verify.message}</p>
              </div>
              {/* On failure the first broken link is named, not just reported. */}
              {!verify.ok && (
                <dl className="mt-2 space-y-0.5 text-xs">
                  <div>
                    <dt className="inline font-medium">First broken record: </dt>
                    <dd className="inline tabular-nums">seq {verify.firstBrokenSeq}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Reason: </dt>
                    <dd className="inline">{verify.reason}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Records verified before the break: </dt>
                    <dd className="inline tabular-nums">{verify.checked}</dd>
                  </div>
                </dl>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Recomputes every record&rsquo;s hash and its link to the previous record. A
              failure names the first altered row.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Audit log records, most recent first</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="pb-2 pr-3 font-medium">Seq</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">When</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Actor</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Action</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Model</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Tokens</th>
                  <th scope="col" className="pb-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <>
                    <tr
                      key={record.seq}
                      className="cursor-pointer border-b last:border-0 hover:bg-accent"
                      onClick={() => setExpanded(expanded === record.seq ? null : record.seq)}
                    >
                      <td className="py-1.5 pr-3 tabular-nums">{record.seq}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {new Date(record.createdAt).toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-3">
                        {record.actorName ?? "—"}
                        {record.actorRole && (
                          <span className="ml-1 text-muted-foreground">({record.actorRole})</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{record.action}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {record.model ?? "—"}
                        {record.effort ? ` · ${record.effort}` : ""}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">
                        {record.inputTokens != null
                          ? `${record.inputTokens}/${record.outputTokens ?? 0}`
                          : "—"}
                      </td>
                      <td className="py-1.5">
                        <StatusBadge
                          kind={
                            record.outcome === "ok"
                              ? "success"
                              : record.outcome === "refusal"
                                ? "warning"
                                : "error"
                          }
                          label={record.outcome}
                        />
                      </td>
                    </tr>
                    {expanded === record.seq && (
                      <tr key={`${record.seq}-detail`} className="border-b bg-secondary/40">
                        <td colSpan={7} className="p-3">
                          <dl className="grid gap-1 sm:grid-cols-2">
                            <Detail label="Resource">
                              {record.resourceType}
                              {record.resourceId ? `:${record.resourceId}` : ""}
                            </Detail>
                            <Detail label="Correlation ID">{record.correlationId ?? "—"}</Detail>
                            <Detail label="Prompt hash">
                              <span className="font-mono">{record.promptHash ?? "—"}</span>
                            </Detail>
                            <Detail label="Output hash">
                              <span className="font-mono">{record.outputHash ?? "—"}</span>
                            </Detail>
                            <Detail label="Latency">
                              {record.latencyMs != null ? `${record.latencyMs} ms` : "—"}
                            </Detail>
                            <Detail label="Record hash">
                              <span className="font-mono">{record.hash.slice(0, 32)}…</span>
                            </Detail>
                            {/* Exactly what context the call saw (FR-GOV-002). */}
                            <Detail label="Retrieved chunks">
                              {record.retrievedChunkIds && record.retrievedChunkIds.length > 0
                                ? `${record.retrievedChunkIds.length}: ${record.retrievedChunkIds
                                    .slice(0, 3)
                                    .join(", ")}${record.retrievedChunkIds.length > 3 ? "…" : ""}`
                                : "—"}
                            </Detail>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline font-medium">{label}: </dt>
      <dd className="inline break-all text-muted-foreground">{children}</dd>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === "warn"
            ? "text-lg font-semibold tabular-nums text-warning"
            : "text-lg font-semibold tabular-nums"
        }
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
