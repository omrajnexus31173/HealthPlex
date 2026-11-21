"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarClock, Clock, Flame, ScanFace, ShieldCheck, TrendingUp, UserRound } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, EmptyState, SectionTitle, Skeleton, StatCard } from "@/components/ui";
import { AreaChart } from "@/components/Charts";
import { createClient } from "@/lib/supabase/client";
import { durationLabel, fmtDate, fmtTime, timeAgo } from "@/lib/format";
import type { AttendanceRecord, TrainingSession } from "@/lib/types";

type Stats = {
  total_visits: number;
  this_month: number;
  this_week: number;
  last_visit: string | null;
  streak_days: number;
  avg_duration: number;
  total_minutes: number;
};

function StudentHome() {
  const { profile, settings, supabase } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [trend, setTrend] = useState<{ label: string; value: number }[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [faceEnrolled, setFaceEnrolled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      setError(null);
      const client = createClient();
      const [{ data: s }, { data: recs }, { data: ses }, { data: stu }] = await Promise.all([
        client.rpc("my_attendance_stats"),
        client.from("attendance_records").select("*").eq("student_id", profile.id).order("check_in_at", { ascending: false }).limit(30),
        client.from("training_sessions").select("*").gte("session_date", new Date().toISOString().slice(0, 10)).eq("status", "scheduled").order("session_date").limit(4),
        client.from("students").select("face_enrolled, face_consent").eq("id", profile.id).maybeSingle(),
      ]);
      setStats(s as Stats);
      const list = (recs as AttendanceRecord[]) ?? [];
      setRecords(list);
      setSessions((ses as TrainingSession[]) ?? []);
      setFaceEnrolled(Boolean(stu?.face_enrolled));

      const byDay = new Map<string, number>();
      list.forEach((r) => byDay.set(r.attendance_date, (byDay.get(r.attendance_date) ?? 0) + 1));
      setTrend(
        Array.from({ length: 14 }).map((_, i) => {
          const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10);
          return { label: d, value: byDay.get(d) ?? 0 };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load your dashboard");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const insideRow = records.find((r) => !r.check_out_at && r.status === "present");

  return (
    <Shell
      title={`Hello, ${profile?.full_name.split(" ")[0] ?? "student"}`}
      subtitle="Your HEALTHPLEX gym activity at GSFC University"
      actions={<Link href="/me/sessions" className="hp-btn hp-btn-ghost"><CalendarClock size={14} /> Sessions</Link>}
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Error">{error}</Alert></div> : null}

      {insideRow ? (
        <div className="mb-4">
          <Alert tone="success" title="You are checked in to the gym">
            Entry recorded at {fmtTime(insideRow.check_in_at)}. Scan again at the kiosk on your way out to record your exit.
          </Alert>
        </div>
      ) : null}

      {faceEnrolled === false ? (
        <div className="mb-4">
          <Alert tone="info" title="Face enrollment is not active">
            Scan your face once at the kiosk after enrolling, or mark attendance with your university ID at the gym desk.{" "}
            <Link href="/me/face" className="font-semibold text-mint-300 hover:underline">Enroll my face →</Link>
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total visits" value={stats?.total_visits ?? 0} hint={stats?.last_visit ? `last ${timeAgo(stats.last_visit)}` : "no visits yet"} icon={<CalendarCheck size={16} />} loading={loading} />
        <StatCard label="This month" value={stats?.this_month ?? 0} hint={`${stats?.this_week ?? 0} in the last 7 days`} tone="mint" icon={<TrendingUp size={16} />} loading={loading} />
        <StatCard label="Active days (30d)" value={stats?.streak_days ?? 0} hint="distinct days visited recently" icon={<Flame size={16} />} loading={loading} />
        <StatCard label="Avg session" value={durationLabel(stats?.avg_duration ?? 0)} hint={`total ${durationLabel(stats?.total_minutes ?? 0)} in the gym`} icon={<Clock size={16} />} loading={loading} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-4">
          <SectionTitle title="My gym visits" subtitle="Last 14 days" action={<Link href="/me/attendance" className="text-[11px] font-semibold text-mint-300 hover:underline">All history →</Link>} />
          {loading ? <Skeleton className="h-[180px]" /> : trend.every((t) => t.value === 0) ? (
            <EmptyState title="No visits in the last two weeks" description="Your gym attendance appears here after your first kiosk scan." icon={<ScanFace size={20} />} />
          ) : (
            <AreaChart data={trend} formatX={(v) => new Date(`${v}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} />
          )}
        </Card>

        <div className="space-y-3">
          <Card className="p-4">
            <SectionTitle title="Recent activity" subtitle="Latest entries and exits" />
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
            ) : records.length === 0 ? (
              <p className="text-[11.5px] text-ink-400">No attendance recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {records.slice(0, 6).map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-navy-950/40 px-2.5 py-1.5">
                    <div>
                      <p className="text-[11.5px] text-white">{fmtDate(r.attendance_date)}</p>
                      <p className="text-[10px] text-ink-400">{fmtTime(r.check_in_at)} {r.check_out_at ? `→ ${fmtTime(r.check_out_at)}` : "· inside"}</p>
                    </div>
                    <Chip tone={r.check_out_at ? "blue" : "green"}>{r.check_out_at ? durationLabel(r.duration_minutes) : "active"}</Chip>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <SectionTitle title="Upcoming sessions" subtitle="Book your next training block" />
            {loading ? <Skeleton className="h-16" /> : sessions.length === 0 ? (
              <p className="text-[11.5px] text-ink-400">No sessions scheduled yet.</p>
            ) : (
              <div className="space-y-1.5">
                {sessions.map((s) => (
                  <Link key={s.id} href="/me/sessions" className="block rounded-lg border border-white/5 bg-navy-950/40 px-2.5 py-1.5 hover:bg-white/4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11.5px] text-white">{s.title}</span>
                      <span className="shrink-0 text-[10px] text-ink-400">{fmtTime(s.start_time)}</span>
                    </div>
                    <p className="text-[10px] text-ink-400">{fmtDate(s.session_date)} · capacity {s.capacity}</p>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { href: "/me/face", label: "Face enrollment", desc: faceEnrolled ? "enrolled — manage consent" : "enable automatic attendance", icon: <ScanFace size={16} /> },
          { href: "/me/attendance", label: "Attendance history", desc: "weekly and monthly stats", icon: <CalendarCheck size={16} /> },
          { href: "/me/profile", label: "My profile", desc: "contact and program details", icon: <UserRound size={16} /> },
        ].map((q) => (
          <Link key={q.href} href={q.href} className="hp-card flex items-center gap-3 p-3.5 transition-transform hover:-translate-y-0.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-mint-300">{q.icon}</span>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-white">{q.label}</p>
              <p className="truncate text-[10.5px] text-ink-400">{q.desc}</p>
            </div>
          </Link>
        ))}
      </div>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[10.5px] text-ink-400/70">
        <ShieldCheck size={11} /> Gym hours today: {settings?.opening_hours?.[new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" }).toLowerCase()] ?? "—"}
      </p>
    </Shell>
  );
}

export default function StudentDashboard() {
  return (
    <StaffGuard roles={["student"]}>
      <StudentHome />
    </StaffGuard>
  );
}
