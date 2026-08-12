import { currentTeacherCourseOrNull } from "@/teacher/context";
import { NotEnrolled } from "@/components/not-enrolled";
import { listBank } from "@/teacher/item-bank";
import { BankClient } from "./bank-client";

export const metadata = { title: "Item bank · Teacher" };
export const dynamic = "force-dynamic";

export default async function BankPage() {
  const enrolment = await currentTeacherCourseOrNull();
  if (!enrolment.course) return <NotEnrolled role="teacher" />;
  const { course } = enrolment;
  const items = await listBank({ courseId: course.id, limit: 100 });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Item bank</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rejected items are listed alongside accepted ones with their failure reasons.
          Only approved items are ever served to a student.
        </p>
      </div>

      <BankClient
        items={items.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
