"use client";

import { useState } from "react";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

type Config = Record<string, unknown>;

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function SettingsClient({ initial }: { initial: Config }) {
  const [config, setConfig] = useState<Config>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, value: unknown) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/admin/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string; detail?: unknown } }
        | null;
      setError(body?.error?.message ?? "Could not save the settings.");
      setBusy(false);
      return;
    }

    setMessage("Saved. The change is recorded in the audit log with its before and after values.");
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {message && (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Model tiers</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The tiers are independent so `bulk` can move to a cheaper model without touching
            generation quality, and `judge` can be pinned separately — a judge that moves
            whenever the generator moves is not an independent check.
          </p>
          {(["generation", "judge", "bulk"] as const).map((tier) => (
            <div key={tier} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label htmlFor={`${tier}-model`} className="block text-xs font-medium">
                  {tier} model
                </label>
                <input
                  id={`${tier}-model`}
                  value={String(config[`llm.${tier}.model`] ?? "")}
                  onChange={(e) => set(`llm.${tier}.model`, e.target.value)}
                  className="w-56 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${tier}-effort`} className="block text-xs font-medium">
                  effort
                </label>
                <select
                  id={`${tier}-effort`}
                  value={String(config[`llm.${tier}.effort`] ?? "high")}
                  onChange={(e) => set(`llm.${tier}.effort`, e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {EFFORTS.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retrieval</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Vector k"
            keyName="retrieval.vectorK"
            config={config}
            onChange={set}
          />
          <NumberField
            label="Lexical k"
            keyName="retrieval.lexicalK"
            config={config}
            onChange={set}
          />
          <NumberField
            label="Final k"
            keyName="retrieval.finalK"
            config={config}
            onChange={set}
          />
          <NumberField
            label="Graph hops"
            keyName="retrieval.graphHops"
            config={config}
            onChange={set}
          />
          <NumberField label="RRF k" keyName="retrieval.rrfK" config={config} onChange={set} />
          <div className="space-y-1">
            <label htmlFor="rerank" className="block text-xs font-medium">
              Re-ranking
            </label>
            <select
              id="rerank"
              value={config["retrieval.rerankEnabled"] ? "on" : "off"}
              onChange={(e) => set("retrieval.rerankEnabled", e.target.value === "on")}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="off">off</option>
              <option value="on">on</option>
            </select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Validation</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="enforce" className="block text-xs font-medium">
              Enforcement
            </label>
            <select
              id="enforce"
              value={config["validation.enforce"] ? "on" : "off"}
              onChange={(e) => set("validation.enforce", e.target.value === "on")}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="on">on — failed items cannot be approved</option>
              <option value="off">off — evaluation only</option>
            </select>
            {!config["validation.enforce"] && (
              <p className="text-xs text-destructive">
                With enforcement off, a failed item can be approved through the service layer.
                The database check constraint still refuses it, so approval will error rather
                than silently succeed. Intended for evaluation only.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              label="CLO alignment threshold"
              keyName="validation.cloAlignThreshold"
              config={config}
              onChange={set}
              step={0.05}
            />
            <NumberField
              label="Groundedness threshold"
              keyName="validation.groundednessThreshold"
              config={config}
              onChange={set}
              step={0.05}
            />
            <NumberField
              label="Distractor threshold"
              keyName="validation.distractorThreshold"
              config={config}
              onChange={set}
              step={0.05}
            />
          </div>
        </CardBody>
      </Card>

      <Button onClick={() => void save()} disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

function NumberField({
  label,
  keyName,
  config,
  onChange,
  step = 1,
}: {
  label: string;
  keyName: string;
  config: Config;
  onChange: (key: string, value: unknown) => void;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={keyName} className="block text-xs font-medium">
        {label}
      </label>
      <input
        id={keyName}
        type="number"
        step={step}
        value={Number(config[keyName] ?? 0)}
        onChange={(e) => onChange(keyName, Number(e.target.value))}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}
