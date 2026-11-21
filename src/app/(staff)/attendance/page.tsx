"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ClipboardList,
  Download,
  FileText,
  Pencil,
  ScanFace,
  Search,
  UserCheck,
  X,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { apiFetch, useAuth } from "@/components/AuthProvider";
import { Alert, Avatar, Button, Card, Chip, EmptyState, SectionTitle, TableSkeleton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv, exportAttendancePdf, photoUrl } from "@/lib/data";
import { durationLabel, fmtDate, fmtDateTime, fmtTime, todayInTz } from "@/lib/format";
import type { AttendanceRecord } from "@/lib/types";

type Row = {
  id: string;
  student_id: string;
  attendance_date: string;
  check_in_at: string;
  check_out_at: string | null;
  duration_minutes: number | null;
  entry_source: string;
  exit_source: string | null;
  status: string;
  recognition_confidence: number | null;
  correction_reason: string | null;
  marked_by: string | null;
  profiles: { full_name: string; email: string } | null;
  students: { enrollment_id: string; photo_path: string | null; departments: { code: string; name: string } | null } | null;
};

const RANGES = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
] as const;

function AttendanceInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin" || profile?.role === "gym_admin";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("today");
  const [from, setFrom] = useState(todayInTz());
  const [to, setTo] = useState(todayInTz());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const [correction, setCorrection] = useState({ in: "", out: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ enrollment: "", reason: "ID verified at gym desk" });
  const [students, setStudents] = useState<{ id: string; enrollment_id: string; name: string }[]>([]);

  const { startDate, endDate } = useMemo(() => {
    const today = todayInTz();
    if (range === "today") return { startDate: today, endDate: today };
    if (range === "week") {
      const d = new Date(`${today}T00:00:00+05:30`);
      d.setDate(d.getDate() - 6);
      return { startDate: d.toISOString().slice(0, 10), endDate: today };
    }
    if (range === "month") return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
    return { startDate: from, endDate: to };
  }, [range, from, to]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("attendance_records")
        .select(
          "id, student_id, attendance_date, check_in_at, check_out_at, duration_minutes, entry_source, exit_source, status, recognition_confidence, correction_reason, marked_by, profiles:profiles!attendance_records_student_id_fkey(full_name,email), students:students!attendance_records_student_id_fkey(enrollment_id, photo_path, departments(code,name))",
        )
        .gte("attendance_date", startDate)
        .lte("attendance_date", endDate)
        .order("check_in_at", { ascending: false })
        .limit(500);
      if (err) throw err;
      const list = (data as unknown as Row[]) ?? [];
      setRows(list);
      const urls = await Promise.all(list.slice(0, 80).map(async (r) => [r.student_id, await photoUrl(r.students?.photo_path)] as const));
      setPhotos(Object.fromEntries(urls.filter((e): e is readonly [string, string] => Boolean(e[1]))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load attendance");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("attendance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("students")
      .select("id, enrollment_id, profiles:profiles(full_name)")
      .is("deleted_at", null)
      .order("enrollment_id")
      .then(({ data }) => {
        setStudents(
          ((data as unknown as { id: string; enrollment_id: string; profiles: { full_name: string } | { full_name: string }[] }[]) ?? []).map((s) => ({
            id: s.id,
            enrollment_id: s.enrollment_id,
            name: (Array.isArray(s.profiles) ? s.profiles[0] : s.profiles)?.full_name ?? "Student",
          })),
        );
      });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchQ =
        !q ||
        r.profiles?.full_name.toLowerCase().includes(q) ||
        r.students?.enrollment_id.toLowerCase().includes(q) ||
        r.students?.departments?.code.toLowerCase().includes(q);
      const matchStatus = !statusFilter || r.status === statusFilter;
      const matchSource = !sourceFilter || r.entry_source === sourceFilter;
      return matchQ && matchStatus && matchSource;
    });
  }, [rows, search, statusFilter, sourceFilter]);

  const saveCorrection = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/admin/attendance/correct", {
        method: "POST",
        body: JSON.stringify({
          record_id: editing.id,
          check_in_at: correction.in ? new Date(correction.in).toISOString() : null,
          check_out_at: correction.out ? new Date(correction.out).toISOString() : null,
          reason: correction.reason,
        }),
      });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction failed");
    } finally {
      setSaving(false);
    }
  };

  const markManual = async () => {
    const student = students.find((s) => s.enrollment_id.toLowerCase() === manual.enrollment.trim().toLowerCase());
    if (!student) {
      setError("No student found with that enrollment ID");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/admin/attendance/manual", {
        method: "POST",
        body: JSON.stringify({ student_id: student.id, reason: manual.reason }),
      });
      setManualOpen(false);
      setManual({ enrollment: "", reason: "ID verified at gym desk" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Manual attendance failed");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    downloadCsv(`healthplex-attendance-${startDate}_${endDate}.csv`, [
      ["Date", "Enrollment ID", "Student", "Department", "Check in", "Check out", "Duration (min)", "Entry source", "Exit source", "Status", "Confidence"],
      ...filtered.map((r) => [
        r.attendance_date,
        r.students?.enrollment_id,
        r.profiles?.full_name,
        r.students?.departments?.name,
        fmtDateTime(r.check_in_at),
        r.check_out_at ? fmtDateTime(r.check_out_at) : "",
        r.duration_minutes ?? "",
        r.entry_source,
        r.exit_source ?? "",
        r.status,
        r.recognition_confidence ?? "",
      ]),
    ]);
  };

  const exportPdf = () =>
    exportAttendancePdf({
      title: "Attendance register",
      subtitle: `${fmtDate(startDate)} — ${fmtDate(endDate)} · ${filtered.length} records · generated by ${profile?.full_name}`,
      columns: ["Date", "Enrollment", "Student", "Dept", "In", "Out", "Duration", "Source"],
      rows: filtered.map((r) => [
        fmtDate(r.attendance_date),
        r.students?.enrollment_id ?? "",
        r.profiles?.full_name ?? "",
        r.students?.departments?.code ?? "",
        fmtTime(r.check_in_at),
        r.check_out_at ? fmtTime(r.check_out_at) : "inside",
        durationLabel(r.duration_minutes),
        r.entry_source,
      ]),
      filename: `healthplex-attendance-${startDate}.pdf`,
    });

  const inside = rows.filter((r) => !r.check_out_at).length;

  return (
    <Shell
      title="Attendance records"
      subtitle={`${filtered.length} records · ${fmtDate(startDate)} to ${fmtDate(endDate)}`}
      actions={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportCsv}><Download size={14} /> CSV</Button>
          <Button variant="ghost" onClick={() => void exportPdf()}><FileText size={14} /> PDF</Button>
          <Button onClick={() => setManualOpen(true)}><UserCheck size={14} /> Manual entry</Button>
        </div>
      }
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}

      <Card className="p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl border border-white/8 bg-navy-950/50 p-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                  range === r.id ? "bg-mint-500/15 text-mint-300" : "text-ink-400 hover:text-white"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {range === "custom" ? (
            <>
              <input type="date" className="hp-input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-[11px] text-ink-400">to</span>
              <input type="date" className="hp-input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          ) : null}
          <div className="relative min-w-[190px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="hp-input pl-8" placeholder="Search student, enrollment or department" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="hp-input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Any status</option>
            <option value="present">Present</option>
            <option value="checked_out">Checked out</option>
            <option value="corrected">Corrected</option>
          </select>
          <select className="hp-input w-auto" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">Any source</option>
            <option value="face">Face scan</option>
            <option value="id_fallback">ID fallback</option>
            <option value="manual">Manual</option>
            <option value="correction">Correction</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10.5px] text-ink-400">
          <span className="flex items-center gap-1"><CalendarDays size={11} /> {fmtDate(startDate)} – {fmtDate(endDate)}</span>
          <span className="flex items-center gap-1"><UserCheck size={11} /> {inside} currently inside</span>
          <span className="flex items-center gap-1"><ScanFace size={11} /> {rows.filter((r) => r.entry_source === "face").length} face scans</span>
        </div>
      </Card>

      {manualOpen ? (
        <Card className="mt-4 p-4">
          <SectionTitle
            title="Manual attendance (ID verification)"
            subtitle="Use when a student has no biometric enrolment or the camera is unavailable"
            action={<button onClick={() => setManualOpen(false)} className="text-ink-400 hover:text-white"><X size={15} /></button>}
          />
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className="hp-input font-mono uppercase"
              placeholder="GSFC-2026-CSE-0147"
              value={manual.enrollment}
              onChange={(e) => setManual({ ...manual, enrollment: e.target.value.toUpperCase() })}
              list="student-enrollments"
            />
            <datalist id="student-enrollments">
              {students.map((s) => (
                <option key={s.id} value={s.enrollment_id}>{s.name}</option>
              ))}
            </datalist>
            <input className="hp-input" placeholder="Reason (recorded in the audit log)" value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} />
            <Button onClick={() => void markManual()} loading={saving}>Record</Button>
          </div>
          <p className="mt-1.5 text-[10.5px] text-ink-400">
            If the student is already inside, this records their exit. Every manual action is written to the audit log with your identity.
          </p>
        </Card>
      ) : null}

      {editing ? (
        <Card className="mt-4 p-4">
          <SectionTitle
            title={`Correct record — ${editing.profiles?.full_name}`}
            subtitle={`${fmtDate(editing.attendance_date)} · original in ${fmtTime(editing.check_in_at)}`}
            action={<button onClick={() => setEditing(null)} className="text-ink-400 hover:text-white"><X size={15} /></button>}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="hp-label">Check-in (IST)</label>
              <input type="datetime-local" className="hp-input" value={correction.in} onChange={(e) => setCorrection({ ...correction, in: e.target.value })} />
            </div>
            <div>
              <label className="hp-label">Check-out (IST)</label>
              <input type="datetime-local" className="hp-input" value={correction.out} onChange={(e) => setCorrection({ ...correction, out: e.target.value })} />
            </div>
            <div>
              <label className="hp-label">Reason (required, audited)</label>
              <input className="hp-input" value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} placeholder="e.g. kiosk offline at 06:40" />
            </div>
          </div>
          <div className="mt-2.5">
            <Button onClick={() => void saveCorrection()} loading={saving} disabled={correction.reason.trim().length < 5}>
              <Pencil size={14} /> Save correction
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="mt-4 overflow-hidden">
        {loading ? (
          <div className="p-4"><TableSkeleton rows={8} cols={6} /></div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No attendance records in this range"
              description={rows.length ? "Try a different date range or clear the filters." : "Records are created automatically when students scan at the kiosk."}
              icon={<ClipboardList size={22} />}
              action={<Link href="/kiosk" className="hp-btn hp-btn-primary">Open kiosk</Link>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-white/6 text-[10.5px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-2.5 font-semibold">Student</th>
                  <th className="px-3 py-2.5 font-semibold">Date</th>
                  <th className="px-3 py-2.5 font-semibold">In</th>
                  <th className="px-3 py-2.5 font-semibold">Out</th>
                  <th className="px-3 py-2.5 font-semibold">Duration</th>
                  <th className="px-3 py-2.5 font-semibold">Source</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  {isAdmin ? <th className="px-3 py-2.5 text-right font-semibold">Correct</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-white/4 last:border-0 hover:bg-white/2">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.profiles?.full_name ?? "?"} url={photos[r.student_id]} size={28} />
                        <div className="min-w-0">
                          <Link href={`/students/${r.student_id}`} className="block truncate font-medium text-white hover:text-mint-300">
                            {r.profiles?.full_name ?? "—"}
                          </Link>
                          <p className="truncate font-mono text-[10.5px] text-ink-400">
                            {r.students?.enrollment_id} {r.students?.departments ? `· ${r.students.departments.code}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-400">{fmtDate(r.attendance_date)}</td>
                    <td className="px-3 py-2.5 text-white">{fmtTime(r.check_in_at)}</td>
                    <td className="px-3 py-2.5 text-ink-400">{r.check_out_at ? fmtTime(r.check_out_at) : <Chip tone="green">inside</Chip>}</td>
                    <td className="px-3 py-2.5 text-ink-400">{durationLabel(r.duration_minutes)}</td>
                    <td className="px-3 py-2.5">
                      <Chip tone={r.entry_source === "face" ? "green" : r.entry_source === "id_fallback" ? "amber" : "blue"}>
                        {r.entry_source === "id_fallback" ? "ID fallback" : r.entry_source}
                      </Chip>
                      {r.recognition_confidence ? (
                        <span className="ml-1 text-[10px] text-ink-400">{(Number(r.recognition_confidence) * 100).toFixed(0)}%</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Chip tone={r.status === "present" ? "green" : r.status === "corrected" ? "amber" : "blue"}>{r.status}</Chip>
                      {r.correction_reason ? (
                        <p className="mt-0.5 max-w-[170px] truncate text-[10px] text-ink-400" title={r.correction_reason}>
                          {r.correction_reason}
                        </p>
                      ) : null}
                    </td>
                    {isAdmin ? (
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => {
                            setEditing(r);
                            const inLocal = new Date(new Date(r.check_in_at).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);
                            const outLocal = r.check_out_at ? new Date(new Date(r.check_out_at).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16) : "";
                            setCorrection({ in: inLocal, out: outLocal, reason: "" });
                          }}
                          className="rounded-lg px-2 py-1 text-ink-400 hover:bg-white/5 hover:text-white"
                          title="Correct this record"
                        >
                          <Pencil size={13} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-center text-[10.5px] text-ink-400/70">
        Corrections and manual entries require an administrator reason and are written to the audit log. Students cannot modify attendance.
      </p>
    </Shell>
  );
}

export default function AttendancePage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin", "gym_staff", "trainer"]}>
      <AttendanceInner />
    </StaffGuard>
  );
}
