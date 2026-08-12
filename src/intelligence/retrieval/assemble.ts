import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { pgArray } from "@/lib/pg-array";
import type { FusedHit } from "./fuse";
import type { RetrievalResult } from "./types";

/**
 * `db.execute<T>` requires an index signature because a raw result row is not
 * statically known to the driver.
 */
interface ChunkRow extends Record<string, unknown> {
  id: string;
  text: string;
  material_id: string;
  material_title: string;
  topic_id: string | null;
  topic_code: string | null;
  topic_title: string | null;
  clo_ids: string[] | null;
  bloom_level: number | null;
  difficulty: number | null;
  lom_format: string | null;
  resource_type: string | null;
  tag_confidence: number | null;
  verified_by: string | null;
  page_from: number | null;
  page_to: number | null;
  section_path: string | null;
}

/**
 * Hydrates fused ids into full results with LOM metadata and source locators
 * (design.md §6.4 step 7, FR-INT-044).
 *
 * Fetched in one statement rather than per id: a 40-chunk context assembled
 * with 40 round trips is the difference between comfortably meeting
 * NFR-PRF-001 and missing it.
 */
export async function assemble(
  hits: readonly FusedHit[],
  finalK: number,
): Promise<RetrievalResult[]> {
  const capped = hits.slice(0, finalK);
  if (capped.length === 0) return [];

  const ids = capped.map((h) => h.id);
  const rows = await db.execute<ChunkRow>(sql`
    SELECT
      c.id,
      c.text,
      c.material_id,
      m.title AS material_title,
      c.topic_id,
      t.code  AS topic_code,
      t.title AS topic_title,
      COALESCE(
        (SELECT array_agg(cc.clo_id) FROM chunk_clos cc WHERE cc.chunk_id = c.id),
        ARRAY[]::uuid[]
      ) AS clo_ids,
      c.bloom_level,
      c.difficulty,
      c.lom_format::text AS lom_format,
      c.resource_type,
      c.tag_confidence,
      c.verified_by,
      c.page_from,
      c.page_to,
      c.section_path
    FROM chunks c
    JOIN materials m ON m.id = c.material_id
    LEFT JOIN topics t ON t.id = c.topic_id
    WHERE c.id = ANY(${pgArray(ids)}::uuid[])
  `);

  const byId = new Map<string, ChunkRow>();
  for (const row of rows) byId.set(row.id, row);

  const results: RetrievalResult[] = [];
  // Iterate the fused order, not the SQL order — the database returns rows in
  // whatever order it likes, and losing the ranking here would silently undo
  // the entire fusion step.
  for (const hit of capped) {
    const row = byId.get(hit.id);
    if (!row) continue;

    results.push({
      id: row.id,
      text: row.text,
      score: hit.score,
      channels: hit.channels,
      materialId: row.material_id,
      materialTitle: row.material_title,
      topicId: row.topic_id,
      topicCode: row.topic_code,
      topicTitle: row.topic_title,
      cloIds: row.clo_ids ?? [],
      bloomLevel: row.bloom_level,
      difficulty: row.difficulty === null ? null : Number(row.difficulty),
      lomFormat: row.lom_format,
      resourceType: row.resource_type,
      tagConfidence: row.tag_confidence === null ? null : Number(row.tag_confidence),
      verified: row.verified_by !== null,
      pageFrom: row.page_from,
      pageTo: row.page_to,
      sectionPath: row.section_path,
    });
  }

  return results;
}

/**
 * Renders retrieved context for a prompt. Chunk ids are included inline and
 * labelled because every downstream check — groundedness especially — requires
 * the model to cite them back by id.
 */
export function renderContext(results: readonly RetrievalResult[]): string {
  if (results.length === 0) return "(no source material matched the requested filter)";

  return results
    .map((r, index) => {
      const locator = [
        r.sectionPath,
        r.pageFrom != null
          ? r.pageTo != null && r.pageTo !== r.pageFrom
            ? `pp. ${r.pageFrom}-${r.pageTo}`
            : `p. ${r.pageFrom}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const meta = [
        r.topicCode ? `topic ${r.topicCode}` : null,
        r.bloomLevel ? `bloom ${r.bloomLevel}` : null,
        r.lomFormat,
      ]
        .filter(Boolean)
        .join(", ");

      return [
        `[${index + 1}] chunk_id: ${r.id}`,
        `source: ${r.materialTitle}${locator ? ` — ${locator}` : ""}`,
        meta ? `metadata: ${meta}` : null,
        "",
        r.text,
      ]
        .filter((line) => line !== null)
        .join("\n");
    })
    .join("\n\n---\n\n");
}
