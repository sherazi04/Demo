import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, chunks, materials, questions, users } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { getConfig } from "@/lib/config";
import { hasAnthropicKey } from "@/intelligence/llm/client";
import { isReachable } from "@/intelligence/kg/driver";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  StatusBadge,
} from "@/components/ui/primitives";

export const metadata = { title: "Status · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminStatusPage() {
  await requireRole("admin");

  const [userCounts, contentCounts, tokenSpend, config, graphUp] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        admins: sql<number>`count(*) FILTER (WHERE ${users.role} = 'admin')::int`,
        teachers: sql<number>`count(*) FILTER (WHERE ${users.role} = 'teacher')::int`,
        students: sql<number>`count(*) FILTER (WHERE ${users.role} = 'student')::int`,
        synthetic: sql<number>`count(*) FILTER (WHERE ${users.isSynthetic})::int`,
        suspended: sql<number>`count(*) FILTER (WHERE ${users.status} = 'suspended')::int`,
      })
      .from(users),
    db
      .select({
        materials: sql<number>`(SELECT count(*)::int FROM ${materials})`,
        chunks: sql<number>`(SELECT count(*)::int FROM ${chunks})`,
        approved: sql<number>`(SELECT count(*)::int FROM ${questions} WHERE status = 'approved')`,
        rejected: sql<number>`(SELECT count(*)::int FROM ${questions} WHERE status = 'rejected')`,
      })
      .from(sql`(SELECT 1) AS t`),
    // Token spend by tier, from the audit log (NFR-OBS-002).
    db
      .select({
        tier: sql<string>`COALESCE(${auditLog.payload} ->> 'tier', 'other')`,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`COALESCE(sum(${auditLog.inputTokens}), 0)::int`,
        outputTokens: sql<number>`COALESCE(sum(${auditLog.outputTokens}), 0)::int`,
        cacheReads: sql<number>`COALESCE(sum(${auditLog.cacheReadTokens}), 0)::int`,
      })
      .from(auditLog)
      .where(sql`${auditLog.model} IS NOT NULL`)
      .groupBy(sql`COALESCE(${auditLog.payload} ->> 'tier', 'other')`),
    getConfig(),
    isReachable(),
  ]);

  const u = userCounts[0];
  const c = contentCounts[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">System status</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Services</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <Row label="PostgreSQL" ok detail="connected" />
            <Row
              label="Neo4j"
              ok={graphUp}
              detail={
                graphUp
                  ? "reachable"
                  : "unreachable — retrieval degrades to dense + lexical without graph expansion"
              }
            />
            <Row
              label="Anthropic API key"
              ok={hasAnthropicKey()}
              detail={
                hasAnthropicKey()
                  ? "set — generation, judging and tagging available"
                  : "not set — retrieval and the student engine still work; generation does not"
              }
            />
            <Row
              label="Embedding provider"
              ok
              detail={
                config["embedding.provider"] === "local"
                  ? `local (${config["embedding.dimensions"]}d) — offline, hashed n-gram; retrieval figures measured on it are a floor`
                  : `${config["embedding.provider"]} (${config["embedding.dimensions"]}d)`
              }
            />
            <Row
              label="Validation enforcement"
              ok={config["validation.enforce"]}
              detail={
                config["validation.enforce"]
                  ? "on — failed items cannot be approved"
                  : "OFF — failed items can be approved. Evaluation use only."
              }
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-sm">
            <p>{u?.total ?? 0} total</p>
            <p className="text-muted-foreground">
              {u?.admins ?? 0} admin · {u?.teachers ?? 0} teacher · {u?.students ?? 0} student
            </p>
            {(u?.synthetic ?? 0) > 0 && (
              <p className="text-xs text-warning">
                {u?.synthetic} synthetic account(s) — suspended, marked throughout the UI.
              </p>
            )}
            {(u?.suspended ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {u?.suspended} suspended (includes synthetic).
              </p>
            )}
            <Link href="/admin/users">
              <Button variant="secondary" className="mt-2 text-xs">
                Manage users
              </Button>
            </Link>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-3 text-sm sm:grid-cols-4">
          <Metric label="Materials" value={c?.materials ?? 0} />
          <Metric label="Indexed chunks" value={c?.chunks ?? 0} />
          <Metric label="Approved items" value={c?.approved ?? 0} />
          <Metric label="Rejected by validation" value={c?.rejected ?? 0} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Token spend by tier</CardTitle>
        </CardHeader>
        <CardBody>
          {tokenSpend.length === 0 ? (
            <p className="text-sm text-muted-foreground">No model calls recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">Token usage grouped by router tier</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="pb-2 pr-3 font-medium">Tier</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Calls</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Input</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Output</th>
                    <th scope="col" className="pb-2 font-medium">Cache reads</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenSpend.map((row) => (
                    <tr key={row.tier} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{row.tier}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.calls}</td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {row.inputTokens.toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {row.outputTokens.toLocaleString()}
                      </td>
                      {/* Non-zero cache reads confirm the prefix is caching. */}
                      <td className="py-1.5 tabular-nums">
                        {row.cacheReads.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge kind={ok ? "success" : "warning"} label={ok ? "ok" : "attention"} />
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
