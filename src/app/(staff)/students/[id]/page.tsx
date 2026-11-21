"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarCheck, Mail, Phone, ScanFace, ShieldCheck, ShieldOff, Timer, TrendingUp } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { apiFetch, useAuth } from "@/components/AuthProvider";
import { Alert, Avatar, Button, Card, Chip, EmptyState, SectionTitle, Skeleton, StatCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { durationLabel, fmtDate, fmtDateTime, fmtTime, todayInTz } from "@/lib/format";
import { photoUrl, downloadCsv } from "@/lib/data";
import type { AttendanceRecord } from "@/lib/types";

type Detail = {
  student: {
    id: string;
    enrollment_id: string;
    academic_year: number;
    program: string | null;
    photo_path: string | null;
    face_enrolled: boolean;
    face_consent: string;
    face_consented_at: string | null;
    emergency_contact: string | null;
    created_at: string;
    profiles: { full_name: string; email: string; phone: string | null; status: string; must_change_password: boolean; last_login_at: string | null };
    departments: { name: string; code: string } | null;
  };
  attendance: AttendanceRecord[];
  stats: { total_visits: number; this_month: number; this_week: number; avg_duration: number; total_minutes: number; last_visit: string | null };
  audit: { action: string; created_at: string; notes: string | null }[];
};

function ProfileInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin" || profile?.role === "gym_admin";
  const [data, setData] = useState<Detail | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();
      const { data: student, error: studentError } = await supabase
        .from("students")
        .select("*, profiles:profiles(full_name,email,phone,status,must_change_password,last_login_at), departments(name,code)")
        .eq("id", id)
        .maybeSingle();
      if (studentError) throw studentError;
      if (!student) throw new Error("Student not found");

      const [{ data: attendance }, { data: audit }] = await Promise.all([
        supabase
          .from("attendance_records")
          .select("*")
          .eq("student_id", id)
          .order("check_in_at", { ascending: false })
          .limit(200),
        supabase
          .from("face_enrollment_audit")
          .select("action,created_at,notes")
          .eq("student_id", id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      const rows = (attendance as AttendanceRecord[]) ?? [];
      const tzToday = todayInTz();
      const monthStart = tzToday.slice(0, 7);
      const durations = rows.filter((r) => r.duration_minutes != null);
      setData({
        student: student as unknown as Detail["student"],
        attendance: rows,
        stats: {
          total_visits: rows.length,
          this_month: rows.filter((r) => r.attendance_date.startsWith(monthStart)).length,
          this_week: rows.filter((r) => new Date(r.check_in_at).getTime() > Date.now() - 7 * 864e5).length,
          avg_duration: durations.length ? Math.round(durations.reduce((s, r) => s + (r.duration_minutes ?? 0), 0) / durations.length) : 0,
          total_minutes: rows.reduce((s, r) => s + (r.duration_minutes ?? 0), 0),
          last_visit: rows[0]?.check_in_at ?? null,
        },
        audit: audit ?? [],
      });
      setPhoto(await photoUrl(student.photo_path));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load student");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const withdraw = async () => {
    if (!window.confirm("Delete this student's biometric template? They can still mark attendance with ID at the desk.")) return;
    setWithdrawing(true);
    try {
      await apiFetch("/api/admin/face/enroll", { method: "DELETE", body: JSON.stringify({ student_id: id, reason: "Withdrawn by administrator" }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to withdraw consent");
    } finally {
      setWithdrawing(false);
    }
  };

  const exportHistory = () => {
    if (!data) return;
    downloadCsv(`healthplex-attendance-${data.student.enrollment_id}.csv`, [
      ["Date", "Check in", "Check out", "Duration (min)", "Status", "Source", "Confidence"],
      ...data.attendance.map((r) => [
        r.attendance_date,
        fmtDateTime(r.check_in_at),
        r.check_out_at ? fmtDateTime(r.check_out_at) : "",
        r.duration_minutes ?? "",
        r.status,
        r.entry_source,
        r.recognition_confidence ?? "",
      ]),
    ]);
  };

  const s = data?.student;
  const statusTone = s?.profiles.status === "active" ? "green" : s?.profiles.status === "suspended" ? "red" : "gray";

  return (
    <Shell
      title={s?.profiles.full_name ?? "Student profile"}
      subtitle={s ? `${s.enrollment_id} · ${s.departments?.name ?? "Department not assigned"}` : "Loading…"}
      actions={
        <Link href="/students" className="hp-btn hp-btn-ghost">
          <ArrowLeft size={14} /> Directory
        </Link>
      }
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Error">{error}</Alert></div> : null}

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : !data || !s ? (
        <EmptyState title="Student not found" description="This student may have been archived." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
            <Card className="p-5">
              <div className="flex flex-wrap items-start gap-4">
                <Avatar name={s.profiles.full_name} url={photo} size={72} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">{s.profiles.full_name}</h2>
                    <Chip tone={statusTone as "green" | "red" | "gray"}>{s.profiles.status}</Chip>
                    {s.face_enrolled ? (
                      <Chip tone="green"><ShieldCheck size={10} /> face enrolled</Chip>
                    ) : (
                      <Chip tone="gray"><ShieldOff size={10} /> no biometrics</Chip>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[12px] text-mint-300">{s.enrollment_id}</p>
                  <div className="mt-2 grid gap-1 text-[11.5px] text-ink-400 sm:grid-cols-2">
                    <span className="flex items-center gap-1.5"><Mail size={12} /> {s.profiles.email}</span>
                    <span className="flex items-center gap-1.5"><Phone size={12} /> {s.profiles.phone ?? "—"}</span>
                    <span>Year {s.academic_year} · {s.program ?? "Program not set"}</span>
                    <span>Joined {fmtDate(s.created_at)}</span>
                    <span>Last login: {s.profiles.last_login_at ? fmtDateTime(s.profiles.last_login_at) : "never"}</span>
                    <span>Emergency: {s.emergency_contact ?? "—"}</span>
                  </div>
                </div>
              </div>
              {isAdmin ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-white/6 pt-3">
                  <Link href={`/students/${s.id}/face`} className="hp-btn hp-btn-ghost">
                    <ScanFace size={14} /> {s.face_enrolled ? "Manage face enrollment" : "Enroll face"}
                  </Link>
                  {s.face_enrolled ? (
                    <Button variant="danger" loading={withdrawing} onClick={() => void withdraw()}>
                      <ShieldOff size={14} /> Withdraw consent
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={exportHistory}>Export history</Button>
                </div>
              ) : null}
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total visits" value={data.stats.total_visits} icon={<CalendarCheck size={15} />} />
              <StatCard label="This month" value={data.stats.this_month} icon={<TrendingUp size={15} />} tone="mint" />
              <StatCard label="Avg session" value={durationLabel(data.stats.avg_duration)} icon={<Timer size={15} />} />
              <StatCard label="Total gym time" value={durationLabel(data.stats.total_minutes)} hint={data.stats.last_visit ? `Last visit ${fmtDate(data.stats.last_visit)}` : "No visits yet"} />
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card className="overflow-hidden">
              <div className="p-4 pb-2">
                <SectionTitle title="Attendance history" subtitle={`${data.attendance.length} most recent records`} action={
                  <button onClick={exportHistory} className="text-[11px] font-semibold text-mint-300 hover:underline">Export CSV</button>
                } />
              </div>
              {data.attendance.length === 0 ? (
                <div className="px-4 pb-4">
                  <EmptyState title="No attendance yet" description="Records appear here after the student's first kiosk scan." icon={<ScanFace size={20} />} />
                </div>
              ) : (
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[520px] text-left text-[12px]">
                    <thead className="sticky top-0 bg-navy-900/95 backdrop-blur">
                      <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-ink-400">
                        <th className="px-4 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">In</th>
                        <th className="px-3 py-2 font-semibold">Out</th>
                        <th className="px-3 py-2 font-semibold">Duration</th>
                        <th className="px-3 py-2 font-semibold">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.attendance.map((r) => (
                        <tr key={r.id} className="border-b border-white/4 last:border-0">
                          <td className="px-4 py-2 text-white">{fmtDate(r.attendance_date)}</td>
                          <td className="px-3 py-2 text-ink-400">{fmtTime(r.check_in_at)}</td>
                          <td className="px-3 py-2 text-ink-400">{r.check_out_at ? fmtTime(r.check_out_at) : <Chip tone="green">inside</Chip>}</td>
                          <td className="px-3 py-2 text-ink-400">{durationLabel(r.duration_minutes)}</td>
                          <td className="px-3 py-2 text-[11px] text-ink-400">{r.entry_source}{r.recognition_confidence ? ` · ${(Number(r.recognition_confidence) * 100).toFixed(0)}%` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <SectionTitle title="Biometric audit trail" subtitle="Consent and enrollment events" />
              {data.audit.length === 0 ? (
                <p className="text-[11.5px] text-ink-400">No biometric events recorded for this student.</p>
              ) : (
                <ol className="space-y-2.5">
                  {data.audit.map((a, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${a.action === "enrolled" ? "bg-mint-400" : a.action === "withdrawn" ? "bg-warn-400" : "bg-[#ff8f6b]"}`} />
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-medium capitalize text-white">{a.action.replaceAll("_", " ")}</p>
                        <p className="text-[10.5px] text-ink-400">{fmtDateTime(a.created_at)}</p>
                        {a.notes ? <p className="mt-0.5 text-[10.5px] text-ink-400/80">{a.notes}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {s.face_consented_at ? (
                <p className="mt-3 rounded-lg border border-white/6 bg-navy-950/40 px-2.5 py-2 text-[10.5px] text-ink-400">
                  Consent recorded {fmtDateTime(s.face_consented_at)} · template encrypted AES-256-GCM.
                </p>
              ) : null}
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}

export default function StudentProfilePage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin", "gym_staff"]}>
      <ProfileInner />
    </StaffGuard>
  );
}
