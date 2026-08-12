import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import {
  getCloPloMatrix,
  getCoverageHeatmap,
  getItemBankCoverage,
  getPrereqGraph,
} from "@/teacher/curriculum";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  StatusBadge,
} from "@/components/ui/primitives";
import { bloomLabel } from "@/lib/utils";

export const metadata = { title: "Curriculum · Teacher" };
export const dynamic = "force-dynamic";

/** Strength labels: colour is never the sole carrier of meaning (NFR-UX-003). */
const STRENGTH_LABEL: Record<number, string> = { 1: "low", 2: "med", 3: "high" };

export default async function CurriculumPage() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;

  const [matrix, coverage, bank, prereq] = await Promise.all([
    getCloPloMatrix(course.id),
    getCoverageHeatmap(course.id),
    getItemBankCoverage(course.id),
    getPrereqGraph(course.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Curriculum</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {course.code} {course.title} · {matrix.clos.length} outcomes,{" "}
          {coverage.cells.length} topics, {coverage.totalChunks} indexed chunks.
        </p>
      </div>

      {/* ── CLO ↔ PLO matrix (FR-TCH-020) ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>CLO ↔ PLO contribution matrix</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Contribution strength of each course outcome to each programme outcome
              </caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="pb-2 pr-3 text-left font-medium">CLO</th>
                  <th scope="col" className="pb-2 pr-3 text-left font-medium">Bloom</th>
                  {matrix.plos.map((plo) => (
                    <th key={plo.id} scope="col" className="pb-2 px-1 font-medium" title={plo.statement}>
                      {plo.code.replace("PLO-", "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.clos.map((clo) => (
                  <tr key={clo.id} className="border-b last:border-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                      {clo.code}
                    </th>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {clo.bloomLevel} · {bloomLabel(clo.bloomLevel)}
                    </td>
                    {matrix.plos.map((plo) => {
                      const strength = matrix.cells[clo.id]?.[plo.id];
                      return (
                        <td key={plo.id} className="px-1 py-1.5 text-center">
                          {strength ? (
                            <span
                              className="inline-block rounded bg-primary/15 px-1 font-medium"
                              title={`${clo.code} → ${plo.code}: ${STRENGTH_LABEL[strength]}`}
                            >
                              {strength}
                            </span>
                          ) : (
                            <span className="text-muted-foreground" aria-label="no contribution">
                              ·
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {matrix.unmappedCloIds.length > 0 && (
            <p className="mt-3 text-xs text-destructive">
              {matrix.unmappedCloIds.length} outcome(s) map to no PLO.
            </p>
          )}
        </CardBody>
      </Card>

      {/* ── Coverage heatmap (FR-TCH-021) ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Corpus coverage — topic × Bloom</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Chunk counts by topic and Bloom level</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="pb-2 pr-3 text-left font-medium">Topic</th>
                  <th scope="col" className="pb-2 pr-2 text-left font-medium">Wk</th>
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <th key={level} scope="col" className="pb-2 px-2 font-medium">
                      B{level}
                    </th>
                  ))}
                  <th scope="col" className="pb-2 pl-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {coverage.cells.map((cell) => (
                  <tr key={cell.topicId} className="border-b last:border-0">
                    <th scope="row" className="py-1 pr-3 text-left font-normal">
                      <span className="font-medium">{cell.topicCode}</span>{" "}
                      <span className="text-muted-foreground">{cell.topicTitle}</span>
                    </th>
                    <td className="py-1 pr-2 tabular-nums text-muted-foreground">{cell.week}</td>
                    {cell.counts.map((count, index) => (
                      <td key={index} className="px-2 py-1 text-center tabular-nums">
                        {count === 0 ? (
                          // Zero-coverage cells are flagged with a glyph as well
                          // as styling, so the gap survives greyscale.
                          <span
                            className="inline-block rounded bg-warning/20 px-1 font-medium text-warning"
                            title={`No material for ${cell.topicCode} at Bloom ${index + 1}`}
                          >
                            0
                          </span>
                        ) : (
                          count
                        )}
                      </td>
                    ))}
                    <td className="py-1 pl-2 text-center font-medium tabular-nums">
                      {cell.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {coverage.zeroCoverage.length} topic × Bloom cell(s) have no material.
            {coverage.emptyTopics.length > 0 && (
              <span className="text-destructive">
                {" "}
                {coverage.emptyTopics.length} topic(s) have none at all:{" "}
                {coverage.emptyTopics.map((t) => t.topicCode).join(", ")}.
              </span>
            )}
          </p>
        </CardBody>
      </Card>

      {/* ── Item bank coverage (FR-TCH-023) ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Item bank — approved items per CLO × Bloom</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Approved item counts by outcome and level</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="pb-2 pr-3 text-left font-medium">CLO</th>
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <th key={level} scope="col" className="pb-2 px-2 font-medium">B{level}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bank.clos.map((clo) => (
                  <tr key={clo.id} className="border-b last:border-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                      {clo.code}
                      <span className="ml-1 font-normal text-muted-foreground">
                        (ceiling {clo.bloomLevel})
                      </span>
                    </th>
                    {[1, 2, 3, 4, 5, 6].map((level) => {
                      const count = bank.cells[clo.id]?.[level] ?? 0;
                      // Above the ceiling is correct, not a gap.
                      const applicable = level <= clo.bloomLevel;
                      return (
                        <td key={level} className="px-2 py-1.5 text-center tabular-nums">
                          {!applicable ? (
                            <span className="text-muted-foreground" aria-label="above ceiling">
                              —
                            </span>
                          ) : count === 0 ? (
                            <span className="inline-block rounded bg-warning/20 px-1 font-medium text-warning">
                              0
                            </span>
                          ) : (
                            count
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bank.gaps.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {bank.gaps.length} CLO × Bloom combination(s) below their ceiling have no
              approved items — adaptive selection has nothing to serve there.
            </p>
          )}
        </CardBody>
      </Card>

      {/* ── Prerequisite graph (FR-TCH-022) ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Topic prerequisites</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-xs text-muted-foreground">
            {prereq.edges.length} edges over {prereq.nodes.length} topics. The full graph is
            explorable in Neo4j Browser at <code>http://localhost:7474</code>.
          </p>
          <ul className="space-y-1 text-xs">
            {prereq.nodes.map((node) => {
              const requires = prereq.edges
                .filter((e) => e.to === node.id)
                .map((e) => prereq.nodes.find((n) => n.id === e.from)?.code)
                .filter(Boolean);
              if (requires.length === 0) return null;
              return (
                <li key={node.id} className="flex flex-wrap gap-1">
                  <span className="font-medium">{node.code}</span>
                  <span className="text-muted-foreground">requires</span>
                  {requires.map((code) => (
                    <span key={code} className="rounded bg-secondary px-1 font-mono">
                      {code}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2 text-xs">
        <StatusBadge kind="info" label={`${matrix.clos.length} outcomes`} />
        <StatusBadge kind="info" label={`${coverage.cells.length} topics`} />
        <StatusBadge kind="info" label={`${prereq.edges.length} prerequisite edges`} />
      </div>
    </div>
  );
}
