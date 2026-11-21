"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Download, Timer } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Card, Chip, EmptyState, SectionTitle, Skeleton, StatCard } from "@/components/ui";
import { BarsChart } from "@/components/Charts";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv } from "@/lib/data";
import { durationLabel, fmtDate, fmtTime } from "@/lib/format";
import type { AttendanceRecord } from "@/lib/types";

function MyAttendance() {
  const { profile } = useAuth();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"month" | "3m" | "all">("month");

  const load = useCallback(async () => {
    if (!profile) return;
    const client = createClient();
    const { data } = await client.from("attendance_records").select("*").eq("student_id", profile.id).order("check_in_at", { ascending: false }).limit(500);
    setRecords((data as AttendanceRecord[]) ?? []);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const cutoff = range === "month" ? Date.now() - 30 * 864e5 : range === "3m" ? Date.now() - 90 * 864e5 : 0;
    return records.filter((r) => new Date(r.check_in_at).getTime() >= cutoff);
  }, [records, range]);

  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => map.set(r.attendance_date.slice(0, 7), (map.get(r.attendance_date.slice(0, 7)) ?? 0) + 1));
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([k, v]) => ({ label: new Date(`${k}-01T00:00:00+05:30`).toLocaleDateString("en-IN", { month: "short" }), value: v }));
  }, [records]);

  const totalMinutes = filtered.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
  const avg = filtered.filter((r) => r.duration_minutes).length
    ? Math.round(totalMinutes / filtered.filter((r) => r.duration_minutes).length)
    : 0;

  return (
    <Shell
      title="My attendance"
      subtitle="Your complete HEALTHPLEX gym record"
      actions={
        <button
          onClick={() =>
            downloadCsv(`healthplex-my-attendance-${profile?.full_name.replace(/\s+/g, "-")}.csv`, [
              ["Date", "Check in", "Check out", "Duration (min)", "Status"],
              ...filtered.map((r) => [r.attendance_date, fmtTime(r.check_in_at), r.check_out_at ? fmtTime(r.check_out_at) : "", r.duration_minutes ?? "", r.status]),
            ])
          }
          className="hp-btn hp-btn-ghost"
        >
          <Download size={14} /> Export
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Visits" value={filtered.length} hint={range === "all" ? "all time" : `last ${range === "month" ? 30 : 90} days`} icon={<CalendarCheck size={16} />} loading={loading} />
        <StatCard label="Total gym time" value={durationLabel(totalMinutes)} icon={<Timer size={16} />} loading={loading} />
        <StatCard label="Average session" value={durationLabel(avg)} tone="mint" loading={loading} />
        <StatCard label="Active days" value={new Set(filtered.map((r) => r.attendance_date)).size} loading={loading} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="p-4">
          <SectionTitle
            title="Visit history"
            subtitle="Records are read-only — only gym administrators can correct attendance"
            action={
              <div className="flex gap-1 rounded-lg border border-white/8 bg-navy-950/50 p-0.5">
                {(["month", "3m", "all"] as const).map((r) => (
                  <button key={r} onClick={() => setRange(r)} className={`rounded px-2 py-1 text-[10.5px] font-semibold ${range === r ? "bg-mint-500/15 text-mint-300" : "text-ink-400"}`}>
                    {r === "month" ? "30d" : r === "3m" ? "90d" : "All"}
                  </button>
                ))}
              </div>
            }
          />
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : filtered.length === 0 ? (
            <EmptyState title="No visits in this period" description="Scan at the gym kiosk to record attendance." icon={<CalendarCheck size={20} />} />
          ) : (
            <div className="max-h-[460px] overflow-auto">
              <table className="w-full min-w-[480px] text-left text-[12px]">
                <thead className="sticky top-0 bg-navy-900/95 backdrop-blur">
                  <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-ink-400">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">In</th>
                    <th className="px-3 py-2 font-semibold">Out</th>
                    <th className="px-3 py-2 font-semibold">Duration</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-white/4 last:border-0">
                      <td className="px-3 py-2 text-white">{fmtDate(r.attendance_date)}</td>
                      <td className="px-3 py-2 text-ink-400">{fmtTime(r.check_in_at)}</td>
                      <td className="px-3 py-2 text-ink-400">{r.check_out_at ? fmtTime(r.check_out_at) : "—"}</td>
                      <td className="px-3 py-2 text-ink-400">{durationLabel(r.duration_minutes)}</td>
                      <td className="px-3 py-2"><Chip tone={r.check_out_at ? "blue" : "green"}>{r.check_out_at ? r.status : "inside"}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-3">
          <Card className="p-4">
            <SectionTitle title="Monthly visits" subtitle="Last 6 months of gym activity" />
            {loading ? <Skeleton className="h-32" /> : monthly.length === 0 ? (
              <p className="text-[11.5px] text-ink-400">No monthly data yet.</p>
            ) : (
              <BarsChart data={monthly} height={160} />
            )}
          </Card>
          <Card className="p-4">
            <SectionTitle title="Attendance policy" />
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-400">
              <li>• Attendance is marked automatically by the kiosk face scanner or by staff with your university ID.</li>
              <li>• Only one entry per scan is recorded, with a short cooldown to prevent duplicates.</li>
              <li>• A second scan records your exit and frees gym capacity.</li>
              <li>• Your attendance can never be edited from your account — only gym administrators can correct a record, and every correction is audited.</li>
            </ul>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

export default function StudentAttendancePage() {
  return (
    <StaffGuard roles={["student"]}>
      <MyAttendance />
    </StaffGuard>
  );
}
