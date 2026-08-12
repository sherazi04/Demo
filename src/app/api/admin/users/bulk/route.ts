import { z } from "zod";
import { requireRole } from "@/auth/guard";
import { CSV_TEMPLATE, commitImport, previewImport } from "@/admin/bulk-import";
import { json, route } from "@/lib/http";

const bodySchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  /** Dry run by default — a commit must be asked for explicitly (FR-ADM-002). */
  mode: z.enum(["preview", "commit"]).default("preview"),
});

export const GET = route(async () => {
  await requireRole("admin");
  return new Response(CSV_TEMPLATE, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="roster-template.csv"',
    },
  });
});

export const POST = route(async (request: Request) => {
  const actor = await requireRole("admin");
  const body = bodySchema.parse(await request.json());

  if (body.mode === "preview") {
    return json(await previewImport(body.csv));
  }

  const result = await commitImport(actor, body.csv);
  return json(result, 201);
});
