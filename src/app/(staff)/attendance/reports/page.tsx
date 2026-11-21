"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarRange,
  CheckCircle2,
  Clock,
  Download,
  FileBarChart2,
  FileText,
  Percent,
  Users,
  XCircle,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, EmptyState, SectionTitle, Skeleton, StatCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv, exportAttendancePdf } from "@/lib/data";
import { durationLabel, fmtDate, todayInTz } from "@/lib/format";

type ReportStudent = {
  student_id: string;
  full_name: string;
  enrollment_id: string;
  department: string;
  department_code: string;
  eligible_days: number;
  present_days: number;
  absent_days: number;
  incomplete_visits: number;
  visits: number;
  attendance_pct: number | null;
  total_minutes: number;
  avg_visit_minutes: number | null;
};

type ReportOverall = {
  students: number;
  eligible_days: number;
  student_eligible_days: number;
  present_days: number;
  absent_days: number;
  incomplete_visits: number;
  total_minutes: number;
  visits: number;
  attendance_pct: number | null;
  avg_visit_minutes: number | null;
};

type ReportPayload = {
  from: string;
  to: string;
  requested_to: string;
  days_eligible: number;
  timezone: string;
  generated_at: string;
  students: ReportStudent[];
  overall: ReportOverall;
};

type Mode = "month" | "two" | "custom";
type SortKey = "full_name" | "eligible_days" | "present_days" | "absent_days" | "incomplete_visits" | "attendance_pct" | "total_minutes";

const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthEnd = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;

function pctLabel(pct: number | null | undefined): string {
  return pct == null ? "N/A" : `${pct.toFixed(1)}%`;
}

function pctTone(pct: number | null | undefined): "green" | "amber" | "red" | "gray" {
  if (pct == null) return "gray";
  if (pct >= 75) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

function ReportsInner() {
  const { profile } = useAuth();
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [customFrom, setCustomFrom] = useState(() => `${monthKey(new Date())}-01`);
  const [customTo, setCustomTo] = useState(() => todayInTz());
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("full_name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const range = useMemo(() => {
    if (mode === "custom") return { from: customFrom, to: customTo };
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return { from: `${month}-01`, to: monthEnd(y || new Date().getFullYear(), m || 1) };
    if (mode === "month") return { from: `${month}-01`, to: monthEnd(y, m) };
    // two consecutive months: selected month + the month after it
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    return { from: `${month}-01`, to: monthEnd(next.y, next.m) };
  }, [mode, month, customFrom, customTo]);

  const rangeValid = range.from <= range.to;

  const load = useCallback(async () => {
    if (!rangeValid) {
      setError("The start date must be before the end date.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc("attendance_frequency_report", {
        p_from: range.from,
        p_to: range.to,
      });
      if (err) throw new Error(err.message);
      const payload = data as ReportPayload;
      setReport({
        ...payload,
        students: (payload.students ?? []).map((s) => ({
          ...s,
          present_days: Number(s.present_days),
          absent_days: Number(s.absent_days),
          incomplete_visits: Number(s.incomplete_visits),
          eligible_days: Number(s.eligible_days),
          visits: Number(s.visits),
          total_minutes: Number(s.total_minutes),
          avg_visit_minutes: s.avg_visit_minutes == null ? null : Number(s.avg_visit_minutes),
          attendance_pct: s.attendance_pct == null ? null : Number(s.attendance_pct),
        })),
        overall: {
          ...payload.overall,
          students: Number(payload.overall?.students ?? 0),
          present_days: Number(payload.overall?.present_days ?? 0),
          absent_days: Number(payload.overall?.absent_days ?? 0),
          incomplete_visits: Number(payload.overall?.incomplete_visits ?? 0),
          eligible_days: Number(payload.overall?.eligible_days ?? 0),
          total_minutes: Number(payload.overall?.total_minutes ?? 0),
          visits: Number(payload.overall?.visits ?? 0),
          attendance_pct: payload.overall?.attendance_pct == null ? null : Number(payload.overall.attendance_pct),
          avg_visit_minutes: payload.overall?.avg_visit_minutes == null ? null : Number(payload.overall.avg_visit_minutes),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, rangeValid]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    if (!report) return [];
    const rows = [...report.students];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") return sortDir * av.localeCompare(bv);
      const an = av == null ? Number.POSITIVE_INFINITY : (av as number);
      const bn = bv == null ? Number.POSITIVE_INFINITY : (bv as number);
      return sortDir * (an - bn);
    });
    return rows;
  }, [report, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "full_name" ? 1 : -1);
    }
  };

  const departmentRollup = useMemo(() => {
    if (!report) return [];
    const map = new Map<string, { department: string; students: number; present: number; absent: number; minutes: number; eligible: number }>();
    for (const s of report.students) {
      const key = s.department || "Unassigned";
      const row = map.get(key) ?? { department: key, students: 0, present: 0, absent: 0, minutes: 0, eligible: 0 };
      row.students += 1;
      row.present += s.present_days;
      row.absent += s.absent_days;
      row.minutes += s.total_minutes;
      row.eligible += s.eligible_days;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.present - a.present || a.department.localeCompare(b.department));
  }, [report]);

  const periodLabel = `${fmtDate(range.from)} — ${fmtDate(range.to)}`;
  const filenameBase = `healthplex-attendance-frequency_${range.from}_${range.to}`;

  const exportCsv = () => {
    if (!report) return;
    const overall = report.overall;
    downloadCsv(`${filenameBase}.csv`, [
      ["HEALTHPLEX · GSFC University"],
      ["Attendance Frequency & Reports"],
      ["Period", periodLabel],
      ["Eligible operating days", report.days_eligible],
      ["Generated", new Date(report.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST"],
      ["Generated by", profile?.full_name ?? "—"],
      [],
      ["#", "Student full name", "Enrollment ID", "Department", "Eligible days", "Present days", "Absent days", "Incomplete visits", "Attendance %", "Total visit duration (min)", "Average visit duration (min)"],
      ...report.students.map((s, i) => [
        i + 1,
        s.full_name,
        s.enrollment_id,
        s.department,
        s.eligible_days,
        s.present_days,
        s.absent_days,
        s.incomplete_visits,
        s.attendance_pct == null ? "N/A" : s.attendance_pct.toFixed(1),
        s.total_minutes,
        s.avg_visit_minutes == null ? "N/A" : s.avg_visit_minutes.toFixed(1),
      ]),
      [],
      ["OVERALL", "", "", "", overall.eligible_days, overall.present_days, overall.absent_days, overall.incomplete_visits,
        overall.attendance_pct == null ? "N/A" : overall.attendance_pct.toFixed(1), overall.total_minutes,
        overall.avg_visit_minutes == null ? "N/A" : overall.avg_visit_minutes.toFixed(1)],
      ["Summary", `${overall.students} eligible students · ${overall.visits} verified visits · ${overall.present_days} present student-days of ${overall.student_eligible_days} possible`],
    ]);
  };

  const exportPdf = () => {
    if (!report) return;
    const overall = report.overall;
    return exportAttendancePdf({
      title: "Attendance Frequency & Reports",
      subtitle: `${periodLabel} · ${report.days_eligible} eligible operating days · ${overall.students} eligible students · generated by ${profile?.full_name ?? "—"}`,
      columns: ["#", "Student", "Enrollment", "Department", "Eligible", "Present", "Absent", "Incompl.", "%", "Total min", "Avg min"],
      rows: report.students.map((s, i) => [
        i + 1,
        s.full_name,
        s.enrollment_id,
        s.department_code !== "—" ? `${s.department_code}` : s.department,
        s.eligible_days,
        s.present_days,
        s.absent_days,
        s.incomplete_visits,
        s.attendance_pct == null ? "N/A" : s.attendance_pct.toFixed(1),
        s.total_minutes,
        s.avg_visit_minutes == null ? "—" : s.avg_visit_minutes.toFixed(1),
      ]),
      filename: `${filenameBase}.pdf`,
      emptyMessage: "No eligible students or operating days in this period.",
      summaryLines: [
        `Overall: ${overall.present_days} present · ${overall.absent_days} absent · ${overall.incomplete_visits} incomplete · ${pctLabel(overall.attendance_pct)} attendance`,
        `Verified gym time: ${durationLabel(overall.total_minutes)} across ${overall.visits} visits · average visit ${overall.avg_visit_minutes == null ? "—" : `${overall.avg_visit_minutes.toFixed(1)} min`}`,
        `Eligible days: ${report.days_eligible} operating days (holidays, closures and future days excluded) · Asia/Kolkata`,
        `Frequency basis: Present days ÷ Eligible operating days × 100 · N/A when eligible days = 0 · Open visits are INCOMPLETE until corrected by an administrator`,
      ],
    });
  };

  const overall = report?.overall;
  const summaryBar = overall
    ? `Overall: ${overall.present_days} present · ${overall.absent_days} absent · ${overall.incomplete_visits} incomplete · ${pctLabel(overall.attendance_pct)} attendance · ${durationLabel(overall.total_minutes)} verified time · ${overall.visits} visits`
    : "";

  const sortHeader = (key: SortKey, label: string, alignRight = false) => (
    <th className={`px-3 py-2.5 font-semibold ${alignRight ? "text-right" : ""}`}>
      <button onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 uppercase tracking-wider text-[10.5px] hover:text-white">
        {label}
        {sortKey === key ? (sortDir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="opacity-40" />}
      </button>
    </th>
  );

  return (
    <Shell
      title="Attendance Frequency & Reports"
      subtitle="Official operating days only · holidays and closures excluded · percentage = Present ÷ Eligible × 100"
      actions={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportCsv} disabled={!report || loading}><Download size={14} /> CSV</Button>
          <Button variant="ghost" onClick={() => void exportPdf()} disabled={!report || loading}><FileText size={14} /> PDF</Button>
        </div>
      }
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Report error">{error}</Alert></div> : null}

      <Card className="p-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1 rounded-xl border border-white/8 bg-navy-950/50 p-1">
            {([
              ["month", "One month"],
              ["two", "Two consecutive months"],
              ["custom", "Custom range"],
            ] as [Mode, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${mode === key ? "bg-mint-500/15 text-mint-300" : "text-ink-400 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "custom" ? (
            <>
              <div>
                <label className="hp-label">From</label>
                <input type="date" className="hp-input w-40" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <label className="hp-label">To</label>
                <input type="date" className="hp-input w-40" value={customTo} min={customFrom} max={todayInTz()} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="hp-label">{mode === "two" ? "First month" : "Month"}</label>
              <input type="month" className="hp-input w-44" value={month} max={monthKey(new Date())} onChange={(e) => setMonth(e.target.value)} />
            </div>
          )}
          <div className="pb-1 text-[11px] text-ink-400">
            <span className="flex items-center gap-1.5"><CalendarRange size={12} /> {periodLabel} · <b className="text-white">{report?.days_eligible ?? "—"} eligible operating days</b></span>
            <p className="mt-0.5">Excludes Sundays (configured closed), administrator-declared holidays and future days.</p>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Eligible students" value={overall?.students ?? "—"} hint="active, not deleted" icon={<Users size={16} />} loading={loading} />
        <StatCard label="Present student-days" value={overall?.present_days ?? "—"} hint={`of ${overall?.student_eligible_days ?? "—"} possible`} icon={<CheckCircle2 size={16} />} tone="mint" loading={loading} />
        <StatCard label="Absent student-days" value={overall?.absent_days ?? "—"} hint="no qualifying visit" icon={<XCircle size={16} />} loading={loading} />
        <StatCard label="Incomplete visits" value={overall?.incomplete_visits ?? "—"} hint="open · pending admin resolution" icon={<AlertTriangle size={16} />} loading={loading} />
        <StatCard label="Overall attendance" value={overall ? pctLabel(overall.attendance_pct) : "—"} hint="present ÷ eligible days" icon={<Percent size={16} />} tone="mint" loading={loading} />
        <StatCard label="Eligible operating days" value={overall?.eligible_days ?? "—"} hint="official gym calendar" icon={<CalendarRange size={16} />} loading={loading} />
        <StatCard label="Verified gym time" value={overall ? durationLabel(overall.total_minutes) : "—"} hint={`${overall?.visits ?? 0} resolved visits`} icon={<Clock size={16} />} loading={loading} />
        <StatCard label="Average visit" value={overall?.avg_visit_minutes == null ? "—" : `${overall.avg_visit_minutes.toFixed(1)} min`} hint="resolved visits only" icon={<Clock size={16} />} loading={loading} />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 p-4">
          <SectionTitle title="Student-wise frequency" subtitle={`${sorted.length} students · serial order · tap a column to sort`} action={<Chip tone="green">{mode === "month" ? "Monthly" : mode === "two" ? "Two-month" : "Custom"} report</Chip>} />
        </div>
        {loading ? (
          <div className="p-4"><Skeleton className="h-64" /></div>
        ) : !report || report.students.length === 0 ? (
          <EmptyState icon={<FileBarChart2 size={28} />} title="Nothing to report" description="No eligible students or operating days in this period. Choose another month or range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-white/6 text-[10.5px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-2.5 font-semibold">#</th>
                  {sortHeader("full_name", "Student")}
                  <th className="px-3 py-2.5 font-semibold">Enrollment</th>
                  <th className="px-3 py-2.5 font-semibold">Department</th>
                  {sortHeader("eligible_days", "Eligible", true)}
                  {sortHeader("present_days", "Present", true)}
                  {sortHeader("absent_days", "Absent", true)}
                  {sortHeader("incomplete_visits", "Incompl.", true)}
                  {sortHeader("attendance_pct", "%", true)}
                  {sortHeader("total_minutes", "Total time", true)}
                  <th className="px-4 py-2.5 text-right font-semibold">Avg visit</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => (
                  <tr key={s.student_id} className="border-b border-white/4 last:border-0 hover:bg-white/[0.025]">
                    <td className="px-4 py-2.5 text-ink-400">{i + 1}</td>
                    <td className="px-3 py-2.5 font-semibold text-white">{s.full_name}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-ink-200">{s.enrollment_id}</td>
                    <td className="px-3 py-2.5 text-ink-200">{s.department}</td>
                    <td className="px-3 py-2.5 text-right text-ink-100">{s.eligible_days}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-mint-300">{s.present_days}</td>
                    <td className="px-3 py-2.5 text-right text-red-300">{s.absent_days}</td>
                    <td className="px-3 py-2.5 text-right text-amber-300">{s.incomplete_visits}</td>
                    <td className="px-3 py-2.5 text-right"><Chip tone={pctTone(s.attendance_pct)}>{pctLabel(s.attendance_pct)}</Chip></td>
                    <td className="px-3 py-2.5 text-right text-ink-100">{durationLabel(s.total_minutes)}</td>
                    <td className="px-4 py-2.5 text-right text-ink-100">{s.avg_visit_minutes == null ? "—" : `${s.avg_visit_minutes.toFixed(1)} min`}</td>
                  </tr>
                ))}
              </tbody>
              {overall ? (
                <tfoot>
                  <tr className="border-t border-mint-500/20 bg-mint-500/[0.06] text-[11.5px] font-semibold text-mint-200">
                    <td className="px-4 py-2.5" colSpan={4}>OVERALL GYM ({overall.students} students)</td>
                    <td className="px-3 py-2.5 text-right">{overall.eligible_days}</td>
                    <td className="px-3 py-2.5 text-right">{overall.present_days}</td>
                    <td className="px-3 py-2.5 text-right">{overall.absent_days}</td>
                    <td className="px-3 py-2.5 text-right">{overall.incomplete_visits}</td>
                    <td className="px-3 py-2.5 text-right">{pctLabel(overall.attendance_pct)}</td>
                    <td className="px-3 py-2.5 text-right">{durationLabel(overall.total_minutes)}</td>
                    <td className="px-4 py-2.5 text-right">{overall.avg_visit_minutes == null ? "—" : `${overall.avg_visit_minutes.toFixed(1)} min`}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
        {summaryBar && !loading ? <p className="border-t border-white/6 px-4 py-2.5 text-[10.5px] text-ink-400">{summaryBar} · percentage = present ÷ eligible days × 100 · N/A when eligible days = 0 · open visits remain INCOMPLETE until an administrator resolves them (Attendance Records → Correct)</p> : null}
      </Card>

      {departmentRollup.length > 0 && !loading ? (
        <Card className="mt-4 p-4">
          <SectionTitle title="Department-wise frequency" subtitle="Aggregated across the selected period" />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-white/6 text-[10.5px] uppercase tracking-wider text-ink-400">
                  <th className="px-3 py-2.5 font-semibold">Department</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Students</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Present days</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Absent days</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Avg %</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Gym time</th>
                </tr>
              </thead>
              <tbody>
                {departmentRollup.map((d) => (
                  <tr key={d.department} className="border-b border-white/4 last:border-0">
                    <td className="px-3 py-2.5 font-medium text-white">{d.department}</td>
                    <td className="px-3 py-2.5 text-right text-ink-100">{d.students}</td>
                    <td className="px-3 py-2.5 text-right text-mint-300">{d.present}</td>
                    <td className="px-3 py-2.5 text-right text-red-300">{d.absent}</td>
                    <td className="px-3 py-2.5 text-right text-ink-100">{d.eligible > 0 ? `${((d.present / d.eligible) * 100).toFixed(1)}%` : "N/A"}</td>
                    <td className="px-3 py-2.5 text-right text-ink-100">{durationLabel(d.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </Shell>
  );
}

export default function ReportsPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin"]}>
      <ReportsInner />
    </StaffGuard>
  );
}
