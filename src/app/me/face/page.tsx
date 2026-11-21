"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanFace, ShieldCheck } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Card, SectionTitle, Skeleton } from "@/components/ui";
import { EnrollWizard } from "@/components/face/EnrollWizard";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";

function MyFace() {
  const { profile } = useAuth();
  const [student, setStudent] = useState<{ enrollment_id: string; face_enrolled: boolean; face_consented_at: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (!profile) return;
    const client = createClient();
    const { data } = await client.from("students").select("enrollment_id, face_enrolled, face_consented_at").eq("id", profile.id).maybeSingle();
    setStudent(data);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <Shell title="Face enrollment" subtitle="Consent-based biometric attendance for the gym kiosk">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div>
          {loading || !student ? (
            <Card className="p-5"><Skeleton className="h-40" /></Card>
          ) : (
            <EnrollWizard
              self
              studentId={profile!.id}
              studentName={profile!.full_name}
              enrollmentId={student.enrollment_id}
              alreadyEnrolled={student.face_enrolled}
              onDone={() => setRefreshKey((k) => k + 1)}
              onWithdraw={() => setRefreshKey((k) => k + 1)}
            />
          )}
        </div>
        <div className="space-y-3">
          <Card className="p-4">
            <SectionTitle title="Your privacy controls" />
            <ul className="space-y-2 text-[11.5px] leading-relaxed text-ink-400">
              <li className="flex gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint-300" /> Your face is converted to a 128-number mathematical template and encrypted with AES-256-GCM.</li>
              <li className="flex gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint-300" /> Camera frames are processed on the kiosk device and are never uploaded or stored.</li>
              <li className="flex gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint-300" /> You can withdraw consent at any time — the template is deleted immediately.</li>
              <li className="flex gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint-300" /> Your template is never removed by the six-month attendance retention policy.</li>
            </ul>
          </Card>
          <Card className="p-4">
            <SectionTitle title="Alternative: university ID" />
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              You do not need face enrollment to use the gym. Show your GSFC University ID card at the desk and a staff member
              will verify your enrollment number and record your attendance manually. The entry is logged with that staff member&apos;s
              identity.
            </p>
          </Card>
          {student?.face_consented_at ? (
            <Card className="p-4">
              <p className="text-[11px] text-ink-400">Consent recorded on {fmtDateTime(student.face_consented_at)}</p>
            </Card>
          ) : null}
          <Card className="flex items-start gap-2 p-4">
            <ScanFace size={15} className="mt-0.5 shrink-0 text-mint-300" />
            <p className="text-[11px] leading-relaxed text-ink-400">
              At the gym entrance, stand in front of the kiosk and follow the on-screen liveness prompt (blink, turn or smile).
              Attendance is marked automatically within a couple of seconds.
            </p>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

export default function StudentFacePage() {
  return (
    <StaffGuard roles={["student"]}>
      <MyFace />
    </StaffGuard>
  );
}
