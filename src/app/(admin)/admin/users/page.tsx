import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { listUsers } from "@/admin/users";
import { UsersClient } from "./users-client";

export const metadata = { title: "Users · Admin" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireRole("admin");

  const [users, courseRows] = await Promise.all([
    listUsers({ limit: 200 }),
    db.select({ id: courses.id, code: courses.code, title: courses.title }).from(courses),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every account is created here. There is no public sign-up anywhere in the system.
        </p>
      </div>

      <UsersClient
        initialUsers={users.map((u) => ({
          ...u,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        }))}
        courses={courseRows}
      />
    </div>
  );
}
