"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  StatusBadge,
  SyntheticBadge,
  type StatusKind,
} from "@/components/ui/primitives";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "student" | "teacher" | "admin";
  status: "invited" | "active" | "suspended";
  isSynthetic: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Course {
  id: string;
  code: string;
  title: string;
}

interface PreviewRow {
  line: number;
  email: string;
  name: string;
  role: string;
  courseCode: string | null;
  status: string;
  message?: string;
}

const STATUS_KIND: Record<UserRow["status"], StatusKind> = {
  active: "success",
  invited: "pending",
  suspended: "error",
};

export function UsersClient({
  initialUsers,
  courses,
}: {
  initialUsers: UserRow[];
  courses: Course[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/users?limit=200");
    if (!res.ok) return;
    const body = (await res.json()) as { users: UserRow[] };
    setUsers(body.users);
    router.refresh();
  }

  async function setStatus(id: string, op: "suspend" | "reactivate") {
    setError(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "That action was refused.");
      return;
    }
    await refresh();
  }

  return (
    <div className="space-y-6">
      {message && (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <CreateUserForm
        courses={courses}
        onCreated={async (note) => {
          setMessage(note);
          await refresh();
        }}
        onError={setError}
      />

      <BulkImport
        onCommitted={async (note) => {
          setMessage(note);
          await refresh();
        }}
        onError={setError}
      />

      <Card>
        <CardHeader>
          <CardTitle>Accounts ({users.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">All user accounts</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-2 pr-3 font-medium">Name</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Email</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Role</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Status</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Last login</th>
                  <th scope="col" className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {user.name}
                      {user.isSynthetic && <SyntheticBadge className="ml-2" />}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{user.email}</td>
                    <td className="py-2 pr-3">{user.role}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge kind={STATUS_KIND[user.status]} label={user.status} />
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString()
                        : "never"}
                    </td>
                    <td className="py-2">
                      <Button
                        variant="ghost"
                        className="text-xs"
                        onClick={() =>
                          void setStatus(
                            user.id,
                            user.status === "suspended" ? "reactivate" : "suspend",
                          )
                        }
                      >
                        {user.status === "suspended" ? "Reactivate" : "Suspend"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function CreateUserForm({
  courses,
  onCreated,
  onError,
}: {
  courses: Course[];
  onCreated: (note: string) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"student" | "teacher" | "admin">("student");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    onError(null);

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, role }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      onError(body?.error?.message ?? "Could not create the account.");
      setBusy(false);
      return;
    }

    const created = (await res.json()) as { id: string; inviteToken: string };

    if (courseId && role !== "admin") {
      await fetch("/api/admin/enrollments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: created.id,
          courseId,
          role: role === "teacher" ? "teacher" : "student",
        }),
      });
    }

    // The invite link is shown once and never recoverable — only reissuable.
    const link = `${window.location.origin}/set-password?token=${created.inviteToken}`;
    await onCreated(`Account created. Send this invite link (shown once): ${link}`);

    setEmail("");
    setName("");
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="new-name" className="block text-xs font-medium">Name</label>
            <input
              id="new-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="new-email" className="block text-xs font-medium">Email</label>
            <input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="new-role" className="block text-xs font-medium">Role</label>
            <select
              id="new-role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="student">student</option>
              <option value="teacher">teacher</option>
              <option value="admin">admin</option>
            </select>
          </div>
          {role !== "admin" && courses.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="new-course" className="block text-xs font-medium">Enrol in</label>
              <select
                id="new-course"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function BulkImport({
  onCommitted,
  onError,
}: {
  onCommitted: (note: string) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{
    rows: PreviewRow[];
    summary: { total: number; toCreate: number; toEnrolOnly: number; duplicates: number; errors: number };
    committable: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(mode: "preview" | "commit") {
    setBusy(true);
    onError(null);

    const res = await fetch("/api/admin/users/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv, mode }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      onError(body?.error?.message ?? "Import failed.");
      setBusy(false);
      return;
    }

    if (mode === "preview") {
      setPreview((await res.json()) as NonNullable<typeof preview>);
    } else {
      const body = (await res.json()) as { created: unknown[]; enrolled: number; skipped: number };
      await onCommitted(
        `Imported ${body.created.length} account(s), ${body.enrolled} enrolment(s), ${body.skipped} skipped.`,
      );
      setPreview(null);
      setCsv("");
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk import</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="csv" className="block text-xs font-medium">
            CSV — headers: email, name, role[, cohort_tag, external_id, course_code]
          </label>
          <textarea
            id="csv"
            rows={5}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"email,name,role,course_code\njo@example.edu,Jo Smith,student,CS-201"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy || csv.trim().length === 0}
            onClick={() => void run("preview")}
          >
            {busy ? "Working…" : "Preview"}
          </Button>
          {/* Commit is only offered after a clean preview — FR-ADM-002. */}
          {preview?.committable && (
            <Button disabled={busy} onClick={() => void run("commit")}>
              Commit {preview.summary.toCreate + preview.summary.toEnrolOnly} row(s)
            </Button>
          )}
        </div>

        {preview && (
          <div className="space-y-2">
            <p className="text-xs">
              {preview.summary.total} row(s): {preview.summary.toCreate} to create,{" "}
              {preview.summary.toEnrolOnly} enrol-only, {preview.summary.duplicates} duplicate,{" "}
              <span className={preview.summary.errors > 0 ? "font-medium text-destructive" : ""}>
                {preview.summary.errors} error
              </span>
              .
            </p>
            {preview.summary.errors > 0 && (
              <p className="text-xs text-destructive">
                Nothing will be imported until every error is fixed — a half-loaded roster is
                harder to reason about than one rejected outright.
              </p>
            )}
            <div className="max-h-56 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <caption className="sr-only">Import preview</caption>
                <thead className="sticky top-0 bg-secondary">
                  <tr className="text-left">
                    <th scope="col" className="px-2 py-1 font-medium">Line</th>
                    <th scope="col" className="px-2 py-1 font-medium">Email</th>
                    <th scope="col" className="px-2 py-1 font-medium">Status</th>
                    <th scope="col" className="px-2 py-1 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.line} className="border-t">
                      <td className="px-2 py-1 tabular-nums">{row.line}</td>
                      <td className="px-2 py-1">{row.email}</td>
                      <td className="px-2 py-1">
                        <StatusBadge
                          kind={
                            row.status === "error"
                              ? "error"
                              : row.status === "create"
                                ? "success"
                                : "info"
                          }
                          label={row.status}
                        />
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{row.message ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
