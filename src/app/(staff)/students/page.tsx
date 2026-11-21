"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Filter,
  Plus,
  Search,
  ScanFace,
  ShieldOff,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { apiFetch, useAuth } from "@/components/AuthProvider";
import { Alert, Avatar, Button, Card, Chip, EmptyState, SectionTitle, TableSkeleton } from "@/components/ui";
import { StudentForm, type StudentFormValues } from "@/components/students/StudentForm";
import { downloadCsv, listDepartments, listStudents, parseCsv, photoUrl, uploadStudentPhoto, type StudentRow } from "@/lib/data";
import type { Department } from "@/lib/types";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  active: "green",
  inactive: "gray",
  suspended: "red",
  graduated: "amber",
};

function StudentsInner() {
  const { profile } = useAuth();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("");
  const [year, setYear] = useState("");
  const [faceFilter, setFaceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [created, setCreated] = useState<{ enrollment: string; password: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<{ ok: number; failed: { row: number; reason: string }[] } | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const isAdmin = profile?.role === "super_admin" || profile?.role === "gym_admin";

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, deps] = await Promise.all([listStudents(), listDepartments()]);
      setStudents(list);
      setDepartments(deps as Department[]);
      const entries = await Promise.all(list.slice(0, 60).map(async (s) => [s.id, await photoUrl(s.photo_path)] as const));
      setPhotos(Object.fromEntries(entries.filter((e): e is readonly [string, string] => Boolean(e[1]))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load students");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      const p = s.profiles;
      const matchQ =
        !q ||
        p?.full_name.toLowerCase().includes(q) ||
        s.enrollment_id.toLowerCase().includes(q) ||
        p?.email.toLowerCase().includes(q) ||
        (s.departments?.code ?? "").toLowerCase().includes(q);
      const matchDept = !dept || s.department_id === dept;
      const matchYear = !year || String(s.academic_year) === year;
      const matchFace = !faceFilter || (faceFilter === "yes" ? s.face_enrolled : !s.face_enrolled);
      const matchStatus = !statusFilter || p?.status === statusFilter;
      return matchQ && matchDept && matchYear && matchFace && matchStatus;
    });
  }, [students, search, dept, year, faceFilter, statusFilter]);

  const exportCsv = () => {
    downloadCsv(
      `healthplex-students-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ["Enrollment ID", "Full name", "Email", "Phone", "Department", "Year", "Program", "Account status", "Face enrolled", "Face consent"],
        ...filtered.map((s) => [
          s.enrollment_id,
          s.profiles?.full_name,
          s.profiles?.email,
          s.profiles?.phone,
          s.departments?.name,
          s.academic_year,
          s.program,
          s.profiles?.status,
          s.face_enrolled ? "yes" : "no",
          s.face_consent,
        ]),
      ],
    );
  };

  const downloadTemplate = () => {
    downloadCsv("healthplex-student-import-template.csv", [
      ["full_name", "enrollment_id", "email", "phone", "department_code", "academic_year", "program"],
      ["Aarav Patel", "GSFC-2026-CSE-0201", "aarav.patel@gsfcuniversity.ac.in", "+91 98765 43210", "CSE", "2", "B.Tech Computer Science"],
      ["Diya Shah", "GSFC-2026-IT-0202", "diya.shah@gsfcuniversity.ac.in", "", "IT", "3", "B.Tech Information Technology"],
    ]);
  };

  const bulkImport = async (file: File) => {
    setImporting(true);
    setImportReport(null);
    try {
      const rows = parseCsv(await file.text());
      const failed: { row: number; reason: string }[] = [];
      let ok = 0;
      const deptByCode = new Map(departments.map((d) => [d.code.toLowerCase(), d.id]));
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          if (!r.full_name || !r.enrollment_id || !r.email) throw new Error("full_name, enrollment_id and email are required");
          await apiFetch("/api/admin/students", {
            method: "POST",
            body: JSON.stringify({
              full_name: r.full_name,
              email: r.email,
              enrollment_id: r.enrollment_id,
              academic_year: Number(r.academic_year || 1),
              program: r.program || null,
              phone: r.phone || null,
              department_id: deptByCode.get((r.department_code || "").toLowerCase()) ?? null,
            }),
          });
          ok++;
        } catch (err) {
          failed.push({ row: i + 2, reason: err instanceof Error ? err.message : "failed" });
        }
      }
      setImportReport({ ok, failed });
      await load();
    } finally {
      setImporting(false);
    }
  };

  const archive = async (s: StudentRow) => {
    if (!window.confirm(`Archive ${s.profiles?.full_name}? The account is disabled and the biometric template is deleted. Attendance history is retained.`)) return;
    try {
      await apiFetch(`/api/admin/students/${s.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive failed");
    }
  };

  const withdrawConsent = async (s: StudentRow) => {
    if (!window.confirm(`Delete the biometric template for ${s.profiles?.full_name}? They can still mark attendance by ID at the desk.`)) return;
    try {
      await apiFetch("/api/admin/face/enroll", {
        method: "DELETE",
        body: JSON.stringify({ student_id: s.id, reason: "Admin withdrew consent on student request" }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw consent");
    }
  };

  const initialFor = (s: StudentRow): Partial<StudentFormValues> => ({
    full_name: s.profiles?.full_name ?? "",
    email: s.profiles?.email ?? "",
    enrollment_id: s.enrollment_id,
    department_id: s.department_id ?? "",
    academic_year: s.academic_year,
    program: s.program ?? "",
    phone: s.profiles?.phone ?? "",
    status: (s.profiles?.status as StudentFormValues["status"]) ?? "active",
  });

  return (
    <Shell
      title="Student directory"
      subtitle={`${students.length} registered students · ${students.filter((s) => s.face_enrolled).length} with face enrollment`}
      actions={
        isAdmin ? (
          <Button onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus size={15} /> Add student
          </Button>
        ) : null
      }
    >
      {error ? (
        <div className="mb-4">
          <Alert tone="danger" title="Something went wrong">{error}</Alert>
        </div>
      ) : null}

      {created ? (
        <div className="mb-4">
          <Alert
            tone="success"
            title="Student account created"
            action={
              <button onClick={() => setCreated(null)} className="text-ink-400 hover:text-white" aria-label="Dismiss">
                <X size={14} />
              </button>
            }
          >
            <p>
              Share these credentials with the student — the password is shown only once. They must change it after first sign-in.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-navy-950/60 px-2 py-1 text-[11.5px] text-mint-300">{created.enrollment}</code>
              <code className="rounded bg-navy-950/60 px-2 py-1 text-[11.5px] text-mint-300">{created.password}</code>
              <button
                className="inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-white"
                onClick={() => void navigator.clipboard.writeText(`Enrollment: ${created.enrollment}\nPassword: ${created.password}`)}
              >
                <Copy size={12} /> copy
              </button>
            </div>
          </Alert>
        </div>
      ) : null}

      {importReport ? (
        <div className="mb-4">
          <Alert
            tone={importReport.failed.length ? "warning" : "success"}
            title={`Bulk import finished — ${importReport.ok} created, ${importReport.failed.length} failed`}
            action={
              <button onClick={() => setImportReport(null)} className="text-ink-400 hover:text-white" aria-label="Dismiss">
                <X size={14} />
              </button>
            }
          >
            {importReport.failed.length ? (
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
                {importReport.failed.map((f) => (
                  <li key={f.row}>
                    Row {f.row}: {f.reason}
                  </li>
                ))}
              </ul>
            ) : (
              "All rows were created successfully."
            )}
          </Alert>
        </div>
      ) : null}

      {showForm && isAdmin ? (
        <div className="mb-4">
          <StudentForm
            departments={departments}
            studentId={editing?.id}
            initial={editing ? initialFor(editing) : undefined}
            onClose={() => {
              setShowForm(false);
              setEditing(null);
            }}
            onSaved={async (info) => {
              setShowForm(false);
              setEditing(null);
              if (info.temporary_password) {
                setCreated({
                  enrollment: (editing?.enrollment_id ?? students.find((s) => s.id === info.id)?.enrollment_id) ?? "—",
                  password: info.temporary_password,
                });
              }
              await load();
            }}
          />
        </div>
      ) : null}

      <Card className="p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[210px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="hp-input pl-8"
              placeholder="Search by name, enrollment ID, email or department"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="hp-input w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>
          <select className="hp-input w-auto" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {[1, 2, 3, 4, 5, 6].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </select>
          <select className="hp-input w-auto" value={faceFilter} onChange={(e) => setFaceFilter(e.target.value)}>
            <option value="">Any face status</option>
            <option value="yes">Face enrolled</option>
            <option value="no">Not enrolled</option>
          </select>
          <select className="hp-input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Any account</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="graduated">Graduated</option>
          </select>
          <Button variant="ghost" onClick={exportCsv}>
            <Download size={14} /> CSV
          </Button>
          {isAdmin ? (
            <>
              <label className="hp-btn hp-btn-ghost cursor-pointer">
                <Upload size={14} />
                {importing ? "Importing…" : "Bulk import"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void bulkImport(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <Button variant="ghost" onClick={downloadTemplate}>
                <FileSpreadsheet size={14} /> Template
              </Button>
            </>
          ) : null}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink-400">
          <Filter size={11} /> {filtered.length} of {students.length} students match the current filters
        </p>
      </Card>

      <Card className="mt-4 overflow-hidden">
        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={7} cols={6} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={students.length ? "No students match these filters" : "No students registered yet"}
              description={
                students.length
                  ? "Adjust or clear the filters to see more students."
                  : "Add students individually or import your university roster as CSV to get started."
              }
              icon={<Users size={22} />}
              action={
                isAdmin ? (
                  <Button onClick={() => { setEditing(null); setShowForm(true); }}>
                    <Plus size={14} /> Add the first student
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-white/6 text-[10.5px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-2.5 font-semibold">Student</th>
                  <th className="px-3 py-2.5 font-semibold">Enrollment</th>
                  <th className="px-3 py-2.5 font-semibold">Department</th>
                  <th className="px-3 py-2.5 font-semibold">Year</th>
                  <th className="px-3 py-2.5 font-semibold">Account</th>
                  <th className="px-3 py-2.5 font-semibold">Biometrics</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-white/4 last:border-0 hover:bg-white/2">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={s.profiles?.full_name ?? "?"} url={photos[s.id]} size={30} />
                        <div className="min-w-0">
                          <Link href={`/students/${s.id}`} className="block truncate font-medium text-white hover:text-mint-300">
                            {s.profiles?.full_name ?? "—"}
                          </Link>
                          <p className="truncate text-[10.5px] text-ink-400">{s.profiles?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px] text-ink-400">{s.enrollment_id}</td>
                    <td className="px-3 py-2.5 text-ink-400">{s.departments?.code ?? "—"}</td>
                    <td className="px-3 py-2.5 text-ink-400">{s.academic_year}</td>
                    <td className="px-3 py-2.5">
                      <Chip tone={STATUS_TONE[s.profiles?.status ?? "inactive"] ?? "gray"}>{s.profiles?.status ?? "—"}</Chip>
                    </td>
                    <td className="px-3 py-2.5">
                      {s.face_enrolled ? (
                        <Chip tone="green">
                          <CheckCircle2 size={10} /> enrolled
                        </Chip>
                      ) : (
                        <Chip tone="gray">not enrolled</Chip>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/students/${s.id}`} className="rounded-lg px-2 py-1 text-[11px] text-ink-400 hover:bg-white/5 hover:text-white">
                          <UserRound size={13} />
                        </Link>
                        {isAdmin ? (
                          <>
                            <Link
                              href={`/students/${s.id}/face`}
                              className="rounded-lg px-2 py-1 text-[11px] text-ink-400 hover:bg-white/5 hover:text-mint-300"
                              title="Manage face enrollment"
                            >
                              <ScanFace size={13} />
                            </Link>
                            {s.face_enrolled ? (
                              <button
                                onClick={() => void withdrawConsent(s)}
                                className="rounded-lg px-2 py-1 text-ink-400 hover:bg-white/5 hover:text-warn-400"
                                title="Withdraw biometric consent"
                              >
                                <ShieldOff size={13} />
                              </button>
                            ) : null}
                            <button
                              onClick={() => void archive(s)}
                              className="rounded-lg px-2 py-1 text-ink-400 hover:bg-[#ff5e47]/10 hover:text-[#ffb2a1]"
                              title="Archive student"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {[
          { label: "Face enrolled", value: students.filter((s) => s.face_enrolled).length, tone: "text-mint-300" },
          { label: "Awaiting face enrollment", value: students.filter((s) => !s.face_enrolled).length, tone: "text-warn-400" },
          { label: "Inactive / suspended", value: students.filter((s) => s.profiles?.status !== "active").length, tone: "text-ink-400" },
        ].map((k) => (
          <Card key={k.label} className="flex items-center justify-between px-4 py-3">
            <span className="text-[11.5px] text-ink-400">{k.label}</span>
            <span className={`text-lg font-semibold ${k.tone}`}>{k.value}</span>
          </Card>
        ))}
      </div>

      <div className="mt-4">
        <SectionTitle title="Data protection" subtitle="How HEALTHPLEX handles student identity" />
        <Card className="p-4 text-[11.5px] leading-relaxed text-ink-400">
          Student accounts are created by gym administrators only — there is no public sign-up. Photographs are stored in a
          private bucket and served through short-lived signed URLs. Face recognition uses an encrypted 128-dimensional
          template (AES-256-GCM) stored separately from the photo; raw camera frames are never uploaded. Students may withdraw
          biometric consent at any time and continue marking attendance with university ID verification at the desk.
        </Card>
      </div>
    </Shell>
  );
}

export default function StudentsPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin", "gym_staff"]}>
      <StudentsInner />
    </StaffGuard>
  );
}
