import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

/**
 * Shown when a signed-in account is not enrolled on any course.
 *
 * There is no self-enrolment: an administrator places every account on a
 * course. Reaching a panel without an enrolment is therefore an ordinary
 * administrative gap, not an error, and it should read like one.
 */
export function NotEnrolled({ role }: { role: "student" | "teacher" }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No course yet</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2 text-sm text-muted-foreground">
        <p>
          Your account is signed in, but it is not enrolled on a course
          {role === "teacher" ? " as a teacher" : ""} yet.
        </p>
        <p>
          Enrolment is done by an administrator — there is no self-enrolment in this system.
          Ask them to add this account to a course, then reload this page.
        </p>
      </CardBody>
    </Card>
  );
}
