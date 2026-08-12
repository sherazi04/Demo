import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { chunks, materials, questions } from "@/db/schema";
import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { queueStats } from "@/teacher/tag-review";
import { validateCurriculum } from "@/governance/curriculum-validation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  StatusBadge,
} from "@/components/ui/primitives";

export const metadata = { title: "Dashboard · Teacher" };
export const dynamic = "force-dynamic";

export default async function TeacherDashboard() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;

  const [itemCounts, materialCounts, chunkCount, tagStats, validation] = await Promise.all([
    db
      .select({
        pending: sql<number>`count(*) FILTER (WHERE ${questions.status} = 'pending')::int`,
        approved: sql<number>`count(*) FILTER (WHERE ${questions.status} = 'approved')::int`,
        rejected: sql<number>`count(*) FILTER (WHERE ${questions.status} = 'rejected')::int`,
      })
      .from(questions)
      .where(eq(questions.courseId, course.id)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        indexed: sql<number>`count(*) FILTER (WHERE ${materials.status} = 'indexed')::int`,
        failed: sql<number>`count(*) FILTER (WHERE ${materials.status} = 'failed')::int`,
        running: sql<number>`count(*) FILTER (WHERE ${materials.status} NOT IN ('indexed','failed'))::int`,
      })
      .from(materials)
      .where(eq(materials.courseId, course.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(chunks)
      .where(eq(chunks.courseId, course.id)),
    queueStats(course.id),
    validateCurriculum(course.id),
  ]);

  const items = itemCounts[0] ?? { pending: 0, approved: 0, rejected: 0 };
  const mats = materialCounts[0] ?? { total: 0, indexed: 0, failed: 0, running: 0 };
  const errors = validation.checks.filter((c) => !c.passed && c.severity === "error");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {course.code} {course.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Course health at a glance.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Indexed chunks" value={chunkCount[0]?.count ?? 0} />
        <Tile
          label="Awaiting approval"
          value={items.pending}
          href="/teacher/bank"
          tone={items.pending > 0 ? "action" : undefined}
        />
        <Tile label="Approved items" value={items.approved} href="/teacher/bank" />
        <Tile
          label="Tags to review"
          value={tagStats.unverified}
          href="/teacher/tags"
          tone={tagStats.drifted > 0 ? "warn" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ingestion</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p>
              {mats.indexed} of {mats.total} material{mats.total === 1 ? "" : "s"} indexed.
            </p>
            {mats.running > 0 && (
              <StatusBadge kind="running" label={`${mats.running} in progress`} />
            )}
            {mats.failed > 0 && (
              <StatusBadge kind="error" label={`${mats.failed} failed`} />
            )}
            {tagStats.drifted > 0 && (
              <p className="text-xs text-destructive">
                {tagStats.drifted} chunk(s) had a drift failure — the tagger named something
                outside the curriculum. They are at the top of the review queue.
              </p>
            )}
            {tagStats.untagged > 0 && (
              <p className="text-xs text-warning">
                {tagStats.untagged} chunk(s) have no topic and are invisible to filtered
                retrieval until assigned.
              </p>
            )}
            <Link href="/teacher/materials">
              <Button variant="secondary" className="text-xs">
                Manage material
              </Button>
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Curriculum health</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p>
              {validation.passedCount} of {validation.checks.length} checks passing.
            </p>
            {errors.length === 0 ? (
              <StatusBadge kind="success" label="no blocking issues" />
            ) : (
              <ul className="space-y-1">
                {errors.map((check) => (
                  <li key={check.id} className="text-xs text-destructive">
                    <span className="font-medium">{check.label}:</span>{" "}
                    {check.offenders.slice(0, 5).join(", ")}
                    {check.offenders.length > 5 ? ` +${check.offenders.length - 5} more` : ""}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/admin/validation">
              <Button variant="secondary" className="text-xs">
                Open validation console
              </Button>
            </Link>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item bank</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <p>
            {items.approved} approved · {items.pending} awaiting review ·{" "}
            {/* Rejections are surfaced here too — they are evidence the
                validation engine is doing work, not noise to hide. */}
            <span className={items.rejected > 0 ? "font-medium" : ""}>
              {items.rejected} rejected by validation
            </span>
          </p>
          <div className="flex gap-2">
            <Link href="/teacher/generate">
              <Button className="text-xs">Generate assessment</Button>
            </Link>
            <Link href="/teacher/lecture">
              <Button variant="secondary" className="text-xs">
                Plan a lecture
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: "warn" | "action";
}) {
  const body = (
    <div className="rounded-md border bg-card px-3 py-2 transition-colors hover:bg-accent">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === "warn"
            ? "text-2xl font-semibold tabular-nums text-warning"
            : tone === "action"
              ? "text-2xl font-semibold tabular-nums text-primary"
              : "text-2xl font-semibold tabular-nums"
        }
      >
        {value}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
