import Link from "next/link";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import type { AppRole } from "@/auth/config";

const HOME: Record<AppRole, string> = {
  student: "/student",
  teacher: "/teacher",
  admin: "/admin",
};

/**
 * Shown when a signed-in account reaches a panel above its role.
 *
 * The refusal has already happened and been audited in the guard — this only
 * decides what the person sees. Without it a server component throws and the
 * account meets a 500, which reads as a broken system rather than a boundary
 * doing its job.
 */
export function NotAuthorised({ panel, role }: { panel: string; role: AppRole | null }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Not authorised</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm text-muted-foreground">
          <p>
            Your account does not have access to the {panel} panel. This attempt has been
            recorded in the audit log.
          </p>
          {role !== null && (
            <Link href={HOME[role] ?? "/"}>
              <Button variant="secondary">Go to your {role} panel</Button>
            </Link>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
