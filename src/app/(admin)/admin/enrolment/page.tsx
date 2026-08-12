import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { requireRole } from "@/auth/guard";
import { listCourseRoster, listUsers } from "@/admin/users";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
  SyntheticBadge,
} from "@/components/ui/primitives";

export const metadata = { title: "Enrolment · Admin" };
export const dynamic = "force-dynamic";

export default async function EnrolmentPage() {
  await requireRole("admin");

  const [course] = await db
    .select({ id: courses.id, code: courses.code, title: courses.title })
    .from(courses)
    .limit(1);

  if (!course) {
    return (
      <EmptyState
        title="No course seeded"
        hint="Run npm run seed:curriculum to load the curriculum spine."
      />
    );
  }

  const [roster, allUsers] = await Promise.all([
    listCourseRoster(course.id),
    listUsers({ limit: 200 }),
  ]);

  const enrolledIds = new Set(roster.map((r) => r.userId));
  const unenrolled = allUsers.filter((u) => !enrolledIds.has(u.id) && u.role !== "admin");

  const teachers = roster.filter((r) => r.role === "teacher");
  const students = roster.filter((r) => r.role === "student");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Enrolment — {course.code} {course.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {teachers.length} teacher{teachers.length === 1 ? "" : "s"} · {students.length}{" "}
          student{students.length === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
        </CardHeader>
        <CardBody>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is enrolled yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Enrolled users for {course.code}</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-2 pr-3 font-medium">Name</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Email</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Course role</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Account</th>
                    <th scope="col" className="pb-2 font-medium">Enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((row) => (
                    <tr key={row.userId} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        {row.name}
                        {row.isSynthetic && <SyntheticBadge className="ml-2" />}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{row.email}</td>
                      <td className="py-2 pr-3">{row.role}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge
                          kind={
                            row.status === "active"
                              ? "success"
                              : row.status === "invited"
                                ? "pending"
                                : "error"
                          }
                          label={row.status}
                        />
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {row.enrolledAt.toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {unenrolled.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Not enrolled ({unenrolled.length})</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm">
              {unenrolled.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center gap-2">
                  <span>{user.name}</span>
                  <span className="text-xs text-muted-foreground">{user.email}</span>
                  <span className="text-xs text-muted-foreground">({user.role})</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Enrol from the Users page when creating an account, or via{" "}
              <code>POST /api/admin/enrollments</code>.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
