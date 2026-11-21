"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Dumbbell,
  Percent,
  ScanFace,
  TrendingUp,
  Users,
  UserCheck,
  XCircle,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Avatar, Card, CapacityBar, Chip, EmptyState, Progress, SectionTitle, Skeleton, StatCard } from "@/components/ui";
import { AreaChart, BarsChart, Donut } from "@/components/Charts";
import { fmtClock, fmtTime, percent, timeAgo } from "@/lib/format";
import type { DashboardStats, TrainingSession } from "@/lib/types";

type Trend = { day: string; visits: number; unique_students: number };
type DeptRow = { department: string; code: string; visits: number; unique_students: number; students: number };
type FeedRow = {
  id: string;
  student_id: string;
  full_name: string;
  enrollment_id: string;
  photo_path: string | null;
  check_in_at: string;
  check_out_at: string | null;
  department: string | null;
  entry_source: string;
};
type Monthly = { year: number; month: number; total_visits: number; unique_students: number };
type DeptAtt = { department: string; code: string; students: number; present_days: number; absent_days: number; attendance_pct: number | null };
type LowAttendance = { student_id: string; full_name: string; enrollment_id: string; department: string; present_days: number; eligible_days: number; attendance_pct: number | null };
type AttToday = { date: string; is_operating_day: boolean; eligible_students: number; present: number; absent: number; incomplete: number; attendance_pct: number | null };
type AttMonth = { year: number; month: number; from: string; to: string; eligible_days: number; present_student_days: number; attendance_pct: number | null; total_visits: number; avg_visit_minutes: number | null };
type DashAttendance = { timezone: string; generated_at: string; eligible_students: number; today: AttToday; month: AttMonth; departments: DeptAtt[]; low_attendance: LowAttendance[] };
type Alertish = { id: string; title: string; body: string | null; severity: string; created_at: string; link: string | null };

function DashboardInner() {
  const { profile, settings, supabase } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [peaks, setPeaks] = useState<{ hour: number; visits: number }[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [equipment, setEquipment] = useState<{ total: number; down: number; faults: number }>({ total: 0, down: 0, faults: 0 });
  const [alerts, setAlerts] = useState<Alertish[]>([]);
  const [att, setAtt] = useState<DashAttendance | null>(null);
  const [monthly, setMonthly] = useState<Monthly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      setError(null);
      const [s, t, d, p, f, ses, eq, al, attRes, mRes] = await Promise.all([
        supabase.rpc("dashboard_stats"),
        supabase.rpc("attendance_trend", { p_days: 14 }),
        supabase.rpc("department_stats", { p_days: 30 }),
        supabase.rpc("peak_hours", { p_days: 30 }),
        supabase.rpc("live_feed", { p_limit: 12 }),
        supabase
          .from("training_sessions")
          .select("*")
          .gte("session_date", new Date().toISOString().slice(0, 10))
          .eq("status", "scheduled")
          .order("session_date")
          .order("start_time")
          .limit(5),
        supabase.from("equipment").select("status"),
        supabase.from("notifications").select("id,title,body,severity,created_at,link").order("created_at", { ascending: false }).limit(6),
        supabase.rpc("attendance_dashboard_stats"),
        supabase.from("attendance_monthly_summary").select("year,month,total_visits,unique_students").order("year", { ascending: false }).order("month", { ascending: false }).limit(6),
      ]);
      if (s.error) throw s.error;
      setStats(s.data as DashboardStats);
      setAtt((attRes.data as DashAttendance | null) ?? null);
      setMonthly(((mRes.data as Monthly[]) ?? []).map((r) => ({ ...r, total_visits: Number(r.total_visits), unique_students: Number(r.unique_students) })).reverse());
      setTrend(((t.data as Trend[]) ?? []).map((r) => ({ ...r, visits: Number(r.visits), unique_students: Number(r.unique_students) })));
      setDepts(((d.data as DeptRow[]) ?? []).map((r) => ({ ...r, visits: Number(r.visits), students: Number(r.students) })));
      setPeaks(((p.data as { hour: number; visits: number }[]) ?? []).map((r) => ({ hour: Number(r.hour), visits: Number(r.visits) })));
      setFeed((f.data as FeedRow[]) ?? []);
      setSessions((ses.data as TrainingSession[]) ?? []);
      const rows = (eq.data as { status: string }[]) ?? [];
      setEquipment({
        total: rows.filter((r) => r.status !== "retired").length,
        down: rows.filter((r) => r.status === "maintenance" || r.status === "out_of_service").length,
        faults: rows.filter((r) => r.status !== "operational" && r.status !== "retired").length,
      });
      setAlerts((al.data as Alertish[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    const tick = setInterval(() => setClock(new Date()), 1000);
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, () => void load())
      .subscribe();
    return () => {
      clearInterval(timer);
      clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [load, supabase]);

  const inside = stats?.currently_inside ?? 0;
  const capacity = stats?.capacity ?? settings?.capacity ?? 0;
  const monthDelta =
    stats && stats.last_month_visits > 0
      ? Math.round(((stats.this_month_visits - stats.last_month_visits) / stats.last_month_visits) * 100)
      : null;
  const deptColors = ["#4fe0a2", "#38bdf8", "#a78bfa", "#fbbf24", "#f472b6", "#34d399"];
  const topDepts = depts.filter((d) => d.visits > 0).slice(0, 5);
  const peakLabel = peaks.length
    ? [...peaks].sort((a, b) => b.visits - a.visits)[0]
    : null;

  return (
    <Shell
      title={`Welcome, ${profile?.full_name.split(" ")[0] ?? ""}`}
      subtitle={`${settings?.gym_name ?? "HEALTHPLEX"} · ${fmtClock(clock)} IST`}
      actions={
        <Link href="/kiosk" className="hp-btn hp-btn-primary hidden sm:inline-flex">
          <ScanFace size={15} /> Open kiosk
        </Link>
      }
    >
      {error ? (
        <div className="mb-4">
          <Alert tone="danger" title="Could not load live data">
            {error}
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Currently inside"
          value={`${inside}/${capacity}`}
          hint={inside >= capacity ? "At capacity — entry should be paused" : `${capacity - inside} spaces available`}
          tone={inside >= capacity ? "danger" : inside / Math.max(capacity, 1) > 0.75 ? "warn" : "mint"}
          icon={<Activity size={16} />}
          loading={loading}
        />
        <StatCard label="Today's visits" value={stats?.today_visits ?? 0} hint={`${stats?.today_unique ?? 0} unique students`} icon={<UserCheck size={16} />} loading={loading} />
        <StatCard
          label="Registered students"
          value={stats?.total_students ?? 0}
          hint={`${stats?.face_enrolled ?? 0} face-enrolled · ${stats?.active_students ?? 0} active`}
          icon={<Users size={16} />}
          loading={loading}
        />
        <StatCard
          label="7-day attendance rate"
          value={`${stats?.attendance_rate ?? 0}%`}
          hint={
            monthDelta == null
              ? "of registered students visited this week"
              : `${stats?.this_month_visits ?? 0} visits this month (${monthDelta >= 0 ? "+" : ""}${monthDelta}% vs last month)`
          }
          tone="mint"
          icon={<TrendingUp size={16} />}
          loading={loading}
        />
      </div>

      {/* ---------- Attendance intelligence (month to date, all from live DB) ---------- */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Eligible students"
          value={att?.eligible_students ?? "—"}
          hint="active, not deleted"
          icon={<Users size={16} />}
          loading={loading}
        />
        <StatCard
          label={att?.today.is_operating_day === false ? "Gym closed today" : "Present today"}
          value={att?.today.is_operating_day === false ? "—" : att?.today.present ?? "—"}
          hint={
            att == null
              ? "awaiting data"
              : att.today.is_operating_day
                ? `${att.today.absent} absent · ${att.today.incomplete} pending resolution`
                : "non-operating day / weekly off"
          }
          icon={<CheckCircle2 size={16} />}
          tone="mint"
          loading={loading}
        />
        <StatCard
          label="Absent today"
          value={att?.today.is_operating_day === false ? "—" : att?.today.absent ?? "—"}
          hint="no verified visit of 30+ min"
          icon={<XCircle size={16} />}
          loading={loading}
        />
        <StatCard
          label="Month attendance"
          value={att?.month.attendance_pct == null ? (loading ? "—" : "N/A") : `${att.month.attendance_pct}%`}
          hint={att ? `${att.month.eligible_days} operating days elapsed` : "month to date"}
          icon={<Percent size={16} />}
          loading={loading}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="p-4">
          <SectionTitle
            title="Department-wise attendance"
            subtitle="Present student-days ÷ eligible days · month to date"
          />
          {loading ? (
            <Skeleton className="h-36" />
          ) : !att || att.departments.length === 0 ? (
            <p className="py-6 text-center text-[11.5px] text-ink-400">No departments or attendance yet.</p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {att.departments.map((d) => (
                <li key={`${d.department}-${d.code}`}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px]">
                    <span className="truncate font-medium text-white">{d.department}</span>
                    <span className="shrink-0 text-ink-400">
                      {d.present_days}/{d.students * (att.month.eligible_days || 0)} ·{" "}
                      <b className="text-mint-300">{d.attendance_pct == null ? "N/A" : `${d.attendance_pct}%`}</b>
                    </span>
                  </div>
                  <Progress value={d.attendance_pct ?? 0} tone={d.attendance_pct == null ? "warn" : d.attendance_pct >= 75 ? "mint" : d.attendance_pct >= 50 ? "warn" : "danger"} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle
            title="Low attendance"
            subtitle="Below 50% this month · needs a nudge"
            action={
              profile?.role === "super_admin" || profile?.role === "gym_admin" ? (
                <Link href="/attendance/reports" className="text-[11px] font-semibold text-mint-300 hover:underline">
                  full report →
                </Link>
              ) : null
            }
          />
          {loading ? (
            <Skeleton className="h-36" />
          ) : !att || att.low_attendance.length === 0 ? (
            <p className="py-6 text-center text-[11.5px] text-ink-400">No students below 50% this month. Well done.</p>
          ) : (
            <ul className="mt-2 divide-y divide-white/5">
              {att.low_attendance.slice(0, 5).map((s) => (
                <li key={s.student_id} className="flex items-center gap-2.5 py-2">
                  <Avatar name={s.full_name} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-white">{s.full_name}</p>
                    <p className="truncate text-[10px] text-ink-400">{s.enrollment_id} · {s.department}</p>
                  </div>
                  <Chip tone="red">{s.attendance_pct == null ? "N/A" : `${s.attendance_pct}%`}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Monthly frequency" subtitle="Resolved visits & unique students per month" />
          {loading ? (
            <Skeleton className="h-36" />
          ) : monthly.length === 0 ? (
            <p className="py-6 text-center text-[11.5px] text-ink-400">Monthly summaries appear after the first completed month.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {monthly.map((m) => (
                <li key={`${m.year}-${m.month}`} className="flex items-center justify-between rounded-lg border border-white/6 bg-navy-950/40 px-3 py-2 text-[11.5px]">
                  <span className="font-medium text-white">{new Date(m.year, m.month - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</span>
                  <span className="text-ink-400">{m.total_visits} visits · {m.unique_students} unique</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between rounded-xl border border-mint-500/15 bg-mint-500/5 px-3 py-2.5">
            <div>
              <p className="text-[10.5px] uppercase tracking-wider text-ink-400">Average visit (month)</p>
              <p className="mt-0.5 text-lg font-semibold text-white">
                {att?.month.avg_visit_minutes == null ? "—" : `${att.month.avg_visit_minutes.toFixed(1)} min`}
              </p>
            </div>
            <Clock size={18} className="text-mint-300" />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card className="p-4">
          <SectionTitle
            title="Attendance trend"
            subtitle="Daily gym visits · last 14 days (Asia/Kolkata)"
            action={<Chip tone="green">Live from database</Chip>}
          />
          {loading ? (
            <Skeleton className="h-[190px] w-full" />
          ) : trend.every((t) => t.visits === 0) ? (
            <EmptyState title="No attendance recorded yet" description="Visits will appear here as students check in at the gym kiosk." icon={<ScanFace size={22} />} />
          ) : (
            <AreaChart
              data={trend.map((t) => ({ label: t.day, value: t.visits }))}
              formatX={(v) => new Date(`${v}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
              label="Daily attendance trend"
            />
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Live occupancy" subtitle="Entry / exit state from the kiosk" />
          {loading ? (
            <Skeleton className="h-[190px] w-full" />
          ) : (
            <div className="space-y-4">
              <CapacityBar inside={inside} capacity={capacity} />
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3">
                  <p className="text-[10.5px] uppercase tracking-wider text-ink-400">Peak hour (30d)</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {peakLabel ? `${peakLabel.hour.toString().padStart(2, "0")}:00` : "—"}
                  </p>
                  <p className="text-[10.5px] text-ink-400">{peakLabel ? `${peakLabel.visits} visits` : "no data yet"}</p>
                </div>
                <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3">
                  <p className="text-[10.5px] uppercase tracking-wider text-ink-400">Open faults</p>
                  <p className="mt-1 text-lg font-semibold text-white">{stats?.open_faults ?? 0}</p>
                  <p className="text-[10.5px] text-ink-400">{equipment.down} equipment down</p>
                </div>
              </div>
              <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-white">Recent alerts</p>
                  <Link href="/security/audit" className="text-[10.5px] text-mint-300 hover:underline">
                    audit
                  </Link>
                </div>
                {alerts.length === 0 ? (
                  <p className="text-[11px] text-ink-400">No alerts. All systems nominal.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {alerts.slice(0, 3).map((a) => (
                      <li key={a.id} className="flex items-start gap-2 text-[11px]">
                        <AlertTriangle
                          size={12}
                          className={a.severity === "critical" ? "mt-0.5 shrink-0 text-[#ff8f6b]" : "mt-0.5 shrink-0 text-warn-400"}
                        />
                        <span className="min-w-0 flex-1 truncate text-ink-400">{a.title}</span>
                        <span className="shrink-0 text-ink-400/60">{timeAgo(a.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <SectionTitle
            title="Live attendance feed"
            subtitle="Most recent gym activity"
            action={
              <Link href="/monitor" className="text-[11px] font-semibold text-mint-300 hover:underline">
                Live monitor →
              </Link>
            }
          />
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : feed.length === 0 ? (
            <EmptyState
              title="No gym activity yet"
              description="Once students scan at the kiosk, their entries and exits will stream here in real time."
              icon={<ScanFace size={22} />}
            />
          ) : (
            <div className="divide-y divide-white/5">
              {feed.map((f) => (
                <div key={f.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={f.full_name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-white">{f.full_name}</p>
                    <p className="truncate text-[11px] text-ink-400">
                      {f.enrollment_id} · {f.department ?? "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    {f.check_out_at ? (
                      <Chip tone="blue">Out {fmtTime(f.check_out_at)}</Chip>
                    ) : (
                      <Chip tone="green">In {fmtTime(f.check_in_at)}</Chip>
                    )}
                    <p className="mt-1 text-[10px] text-ink-400/70">
                      {f.entry_source === "face" ? "face scan" : f.entry_source === "id_fallback" ? "ID fallback" : f.entry_source}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Department mix" subtitle="Visits in the last 30 days" />
          {loading ? (
            <Skeleton className="h-[150px] w-full" />
          ) : topDepts.length === 0 ? (
            <EmptyState title="No department data yet" description="Appears once attendance is recorded." />
          ) : (
            <Donut
              slices={topDepts.map((d, i) => ({ label: d.code, value: d.visits, color: deptColors[i % deptColors.length] }))}
              centerValue={String(topDepts.reduce((s, d) => s + d.visits, 0))}
              centerLabel="visits"
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <SectionTitle
            title="Peak gym hours"
            subtitle="Check-ins by hour · last 30 days"
            action={
              <Link href="/attendance/analytics" className="text-[11px] font-semibold text-mint-300 hover:underline">
                Full analytics →
              </Link>
            }
          />
          {loading ? (
            <Skeleton className="h-[160px] w-full" />
          ) : peaks.length === 0 ? (
            <EmptyState title="No hourly data yet" description="Peak hours are computed from real check-in timestamps." />
          ) : (
            <BarsChart data={peaks.map((p) => ({ label: `${String(p.hour).padStart(2, "0")}`, value: p.visits }))} />
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle
            title="Upcoming sessions"
            subtitle="Next scheduled training"
            action={
              <Link href="/sessions" className="text-[11px] font-semibold text-mint-300 hover:underline">
                All →
              </Link>
            }
          />
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState title="No sessions scheduled" description="Create a training session to see it here." icon={<CalendarClock size={20} />} />
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border border-white/6 bg-navy-950/40 p-2.5">
                  <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-mint-500/10 text-mint-300">
                    <span className="text-[9px] uppercase leading-none">
                      {new Date(`${s.session_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { month: "short" })}
                    </span>
                    <span className="text-[12px] font-bold leading-none">
                      {new Date(`${s.session_date}T00:00:00+05:30`).getDate()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-white">{s.title}</p>
                    <p className="text-[10.5px] text-ink-400">
                      {fmtTime(s.start_time)}–{fmtTime(s.end_time)} · cap {s.capacity}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between rounded-xl border border-white/6 bg-navy-950/40 p-3">
            <div className="flex items-center gap-2">
              <Dumbbell size={15} className="text-ink-400" />
              <div>
                <p className="text-[11px] text-ink-400">Equipment operational</p>
                <p className="text-[13px] font-semibold text-white">
                  {equipment.total - equipment.down}/{equipment.total || 0}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-ink-400">Upcoming</p>
              <p className="text-[13px] font-semibold text-white">{stats?.upcoming_sessions ?? 0}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { href: "/kiosk", label: "Attendance kiosk", desc: "Face scan at the entrance", icon: <ScanFace size={17} /> },
          { href: "/students", label: "Student directory", desc: "Records, photos, enrollment", icon: <Users size={17} /> },
          { href: "/attendance", label: "Attendance records", desc: "Search, correct, export", icon: <UserCheck size={17} /> },
          { href: "/equipment", label: "Equipment", desc: "Inventory and maintenance", icon: <Dumbbell size={17} /> },
        ].map((q) => (
          <Link key={q.href} href={q.href} className="hp-card group flex items-center gap-3 p-3.5 transition-transform hover:-translate-y-0.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-mint-300">{q.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-white">{q.label}</p>
              <p className="truncate text-[10.5px] text-ink-400">{q.desc}</p>
            </div>
            <ArrowUpRight size={14} className="text-ink-400 transition-transform group-hover:-translate-y-0.5 group-hover:text-mint-300" />
          </Link>
        ))}
      </div>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-[10.5px] text-ink-400/60">
        <ArrowDownRight size={11} /> All figures are computed from live Supabase queries · {percent(inside, capacity)}% capacity in use
      </p>
    </Shell>
  );
}

export default function DashboardPage() {
  return (
    <StaffGuard>
      <DashboardInner />
    </StaffGuard>
  );
}
