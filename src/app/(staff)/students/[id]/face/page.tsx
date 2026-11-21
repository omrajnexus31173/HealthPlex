"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { Alert, Card } from "@/components/ui";
import { EnrollWizard } from "@/components/face/EnrollWizard";
import { createClient } from "@/lib/supabase/client";

function FaceInner() {
  const params = useParams<{ id: string }>();
  const [student, setStudent] = useState<{ full_name: string; enrollment_id: string; face_enrolled: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("students")
        .select("enrollment_id, face_enrolled, profiles:profiles(full_name)")
        .eq("id", params.id)
        .maybeSingle();
      if (err) return setError(err.message);
      if (!data) return setError("Student not found");
      const p = Array.isArray(data.profiles) ? data.profiles[0] : data.profiles;
      setStudent({ full_name: p?.full_name ?? "Student", enrollment_id: data.enrollment_id, face_enrolled: data.face_enrolled });
    };
    void load();
  }, [params.id, refreshKey]);

  return (
    <Shell
      title="Face enrollment"
      subtitle="Consent-based biometric template capture"
      actions={<Link href={`/students/${params.id}`} className="hp-btn hp-btn-ghost"><ArrowLeft size={14} /> Profile</Link>}
    >
      {error ? <Alert tone="danger" title={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div>
          {student ? (
            <EnrollWizard
              studentId={params.id}
              studentName={student.full_name}
              enrollmentId={student.enrollment_id}
              alreadyEnrolled={student.face_enrolled}
              onDone={() => setRefreshKey((k) => k + 1)}
              onWithdraw={() => setRefreshKey((k) => k + 1)}
            />
          ) : (
            <Card className="p-5"><div className="hp-skeleton h-24" /></Card>
          )}
        </div>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-white">Non-biometric alternative</h3>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400">
            Face enrollment is optional. Any student can mark attendance without biometrics:
          </p>
          <ol className="mt-2.5 list-decimal space-y-1.5 pl-4 text-[11.5px] text-ink-400">
            <li>Visit the gym desk with your university ID card.</li>
            <li>A staff member verifies your enrollment ID.</li>
            <li>Staff records attendance from the Attendance Records page (manual verification) — the action is written to the audit log with the staff member&apos;s identity.</li>
          </ol>
          <div className="mt-3 rounded-xl border border-white/6 bg-navy-950/40 p-3 text-[10.5px] leading-relaxed text-ink-400">
            Biometric templates are only created after informed consent is recorded. They are kept while the enrollment is
            active and are deleted immediately on withdrawal — never removed by the six-month attendance retention job.
          </div>
        </Card>
      </div>
    </Shell>
  );
}

export default function FaceEnrollmentPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin"]}>
      <FaceInner />
    </StaffGuard>
  );
}
