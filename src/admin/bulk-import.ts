import { eq, inArray, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { courses, users } from "@/db/schema";
import { parseCsvTable } from "@/lib/csv";
import { BadRequestError } from "@/lib/errors";
import { createUser, enrol, roleSchema } from "./users";
import type { AuthedUser } from "@/auth/guard";

/**
 * CSV roster import with a mandatory dry-run preview (FR-ADM-002).
 *
 * `preview` and `commit` share one validation pass, so what the administrator
 * approves is exactly what gets written — a preview computed by different code
 * from the commit is a preview you cannot trust.
 */

const REQUIRED_HEADERS = ["email", "name", "role"] as const;

const rowSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  role: roleSchema,
  cohort_tag: z.string().max(64).optional().default(""),
  external_id: z.string().max(128).optional().default(""),
  course_code: z.string().max(64).optional().default(""),
});

export type RowStatus = "create" | "enrol_only" | "skip_duplicate" | "error";

export interface PreviewRow {
  line: number;
  email: string;
  name: string;
  role: string;
  courseCode: string | null;
  status: RowStatus;
  /** Why this row will be skipped or rejected — shown in the preview table. */
  message?: string;
}

export interface ImportPreview {
  rows: PreviewRow[];
  summary: {
    total: number;
    toCreate: number;
    toEnrolOnly: number;
    duplicates: number;
    errors: number;
  };
  /** True when at least one row is actionable and none is malformed. */
  committable: boolean;
}

export async function previewImport(csv: string): Promise<ImportPreview> {
  const table = parseCsvTable(csv);
  if (table.headers.length === 0) throw new BadRequestError("The CSV file is empty.");

  const missing = REQUIRED_HEADERS.filter((h) => !table.headers.includes(h));
  if (missing.length > 0) {
    throw new BadRequestError(
      `CSV is missing required column(s): ${missing.join(", ")}. Expected headers: email, name, role[, cohort_tag, external_id, course_code].`,
    );
  }

  // Email comparison is case-insensitive throughout (the unique index is on
  // lower(email)), so the existence probe must lower both sides.
  const emails = [
    ...new Set(table.rows.map((r) => (r["email"] ?? "").trim().toLowerCase()).filter(Boolean)),
  ];
  const existing =
    emails.length > 0
      ? await db
          .select({ email: users.email })
          .from(users)
          .where(inArray(raw<string>`lower(${users.email})`, emails))
      : [];
  const existingEmails = new Set(existing.map((e) => e.email.toLowerCase()));

  const courseRows = await db.select({ id: courses.id, code: courses.code }).from(courses);
  const knownCourses = new Set(courseRows.map((c) => c.code));

  const seenInFile = new Set<string>();
  const rows: PreviewRow[] = table.rows.map((record, index) => {
    const line = index + 2; // +1 for zero-index, +1 for the header row
    const parsed = rowSchema.safeParse(record);

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        line,
        email: record["email"] ?? "",
        name: record["name"] ?? "",
        role: record["role"] ?? "",
        courseCode: record["course_code"] || null,
        status: "error",
        message: first ? `${first.path.join(".") || "row"}: ${first.message}` : "Invalid row",
      };
    }

    const data = parsed.data;
    const key = data.email.toLowerCase();
    const courseCode = data.course_code || null;

    if (courseCode && !knownCourses.has(courseCode)) {
      return {
        line,
        email: data.email,
        name: data.name,
        role: data.role,
        courseCode,
        status: "error",
        message: `Unknown course code "${courseCode}".`,
      };
    }

    if (seenInFile.has(key)) {
      return {
        line,
        email: data.email,
        name: data.name,
        role: data.role,
        courseCode,
        status: "error",
        message: "Duplicate email within this file.",
      };
    }
    seenInFile.add(key);

    if (existingEmails.has(key)) {
      // An existing account is not an error: the common case is adding an
      // already-provisioned student to another course.
      return {
        line,
        email: data.email,
        name: data.name,
        role: data.role,
        courseCode,
        status: courseCode ? "enrol_only" : "skip_duplicate",
        message: courseCode
          ? "Account exists — will be enrolled only."
          : "Account already exists — no change.",
      };
    }

    return {
      line,
      email: data.email,
      name: data.name,
      role: data.role,
      courseCode,
      status: "create",
    };
  });

  const summary = {
    total: rows.length,
    toCreate: rows.filter((r) => r.status === "create").length,
    toEnrolOnly: rows.filter((r) => r.status === "enrol_only").length,
    duplicates: rows.filter((r) => r.status === "skip_duplicate").length,
    errors: rows.filter((r) => r.status === "error").length,
  };

  return {
    rows,
    summary,
    // Refuse a partial import: a roster half-loaded is harder to reason about
    // than one rejected outright with the offending lines named.
    committable: summary.errors === 0 && summary.toCreate + summary.toEnrolOnly > 0,
  };
}

export interface ImportResult {
  created: Array<{ email: string; inviteToken: string }>;
  enrolled: number;
  skipped: number;
}

export async function commitImport(actor: AuthedUser, csv: string): Promise<ImportResult> {
  const preview = await previewImport(csv);
  if (!preview.committable) {
    throw new BadRequestError(
      preview.summary.errors > 0
        ? `Import rejected: ${preview.summary.errors} row(s) have errors. Fix them and preview again.`
        : "Import contains no rows to apply.",
    );
  }

  const courseRows = await db.select({ id: courses.id, code: courses.code }).from(courses);
  const courseIdByCode = new Map(courseRows.map((c) => [c.code, c.id]));

  const created: Array<{ email: string; inviteToken: string }> = [];
  let enrolled = 0;
  let skipped = 0;

  for (const row of preview.rows) {
    if (row.status === "skip_duplicate") {
      skipped += 1;
      continue;
    }

    let userId: string | undefined;

    if (row.status === "create") {
      const result = await createUser(actor, {
        email: row.email,
        name: row.name,
        role: row.role as "student" | "teacher" | "admin",
      });
      created.push({ email: result.email, inviteToken: result.inviteToken });
      userId = result.id;
    } else if (row.status === "enrol_only") {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(raw`lower(${users.email}) = lower(${row.email})`)
        .limit(1);
      userId = existing?.id;
    }

    if (userId && row.courseCode) {
      const courseId = courseIdByCode.get(row.courseCode);
      if (courseId) {
        await enrol(actor, userId, courseId, row.role === "teacher" ? "teacher" : "student");
        enrolled += 1;
      }
    }
  }

  return { created, enrolled, skipped };
}

/** Header line for the downloadable template. */
export const CSV_TEMPLATE = "email,name,role,cohort_tag,external_id,course_code\n";
