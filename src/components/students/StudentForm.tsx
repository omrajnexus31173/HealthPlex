"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { apiFetch } from "@/components/AuthProvider";
import { uploadStudentPhoto } from "@/lib/data";
import type { Department } from "@/lib/types";

export type StudentFormValues = {
  full_name: string;
  email: string;
  enrollment_id: string;
  department_id: string;
  academic_year: number;
  program: string;
  phone: string;
  emergency_contact: string;
  status: "active" | "inactive" | "suspended" | "graduated";
};

const empty: StudentFormValues = {
  full_name: "",
  email: "",
  enrollment_id: "",
  department_id: "",
  academic_year: 1,
  program: "",
  phone: "",
  emergency_contact: "",
  status: "active",
};

export function StudentForm({
  departments,
  studentId,
  initial,
  onSaved,
  onClose,
}: {
  departments: Department[];
  studentId?: string;
  initial?: Partial<StudentFormValues>;
  onSaved: (info: { id: string; temporary_password?: string }) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<StudentFormValues>({ ...empty, ...initial });
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    setValues({ ...empty, ...initial });
  }, [initial]);

  const emailHint = useMemo(() => {
    if (!values.email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return "Enter a valid email address";
    if (!values.email.toLowerCase().endsWith("gsfcuniversity.ac.in")) return "Not a GSFC University address — allowed, but please confirm";
    return null;
  }, [values.email]);

  const set = <K extends keyof StudentFormValues>(key: K, value: StudentFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let id = studentId;
      if (!studentId) {
        setProgress("Creating university account…");
        const res = await apiFetch<{ id: string; temporary_password: string }>("/api/admin/students", {
          method: "POST",
          body: JSON.stringify({ ...values, department_id: values.department_id || null }),
        });
        id = res.id;
        if (photo) {
          setProgress("Uploading photograph…");
          const path = await uploadStudentPhoto(id, photo);
          await apiFetch(`/api/admin/students/${id}/photo`, { method: "POST", body: JSON.stringify({ path }) });
        }
        onSaved({ id, temporary_password: res.temporary_password });
      } else {
        setProgress("Saving changes…");
        await apiFetch(`/api/admin/students/${studentId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...values, department_id: values.department_id || null }),
        });
        if (photo) {
          setProgress("Uploading photograph…");
          const path = await uploadStudentPhoto(studentId, photo);
          await apiFetch(`/api/admin/students/${studentId}/photo`, { method: "POST", body: JSON.stringify({ path }) });
        }
        onSaved({ id: studentId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the student");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">{studentId ? "Edit student" : "Register new student"}</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-400">
            Student identity only — HEALTHPLEX has no memberships, plans or payments.
          </p>
        </div>
        <button onClick={onClose} className="text-ink-400 hover:text-white" aria-label="Close">
          <X size={17} />
        </button>
      </div>

      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="hp-label">Full name *</label>
            <input className="hp-input" required minLength={3} value={values.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Aarav Patel" />
          </div>
          <div>
            <label className="hp-label">University enrollment ID *</label>
            <input
              className="hp-input font-mono uppercase"
              required
              value={values.enrollment_id}
              onChange={(e) => set("enrollment_id", e.target.value.toUpperCase())}
              placeholder="GSFC-2026-CSE-0147"
              disabled={!!studentId}
            />
            {studentId ? <p className="mt-1 text-[10px] text-ink-400">Enrollment IDs are immutable once issued.</p> : null}
          </div>
          <div>
            <label className="hp-label">University email *</label>
            <input
              className="hp-input"
              type="email"
              required
              value={values.email}
              onChange={(e) => set("email", e.target.value.toLowerCase())}
              placeholder="student@gsfcuniversity.ac.in"
              disabled={!!studentId}
            />
            {emailHint ? <p className="mt-1 text-[10px] text-warn-400">{emailHint}</p> : null}
          </div>
          <div>
            <label className="hp-label">Phone</label>
            <input className="hp-input" value={values.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" />
          </div>
          <div>
            <label className="hp-label">Department</label>
            <select className="hp-input" value={values.department_id} onChange={(e) => set("department_id", e.target.value)}>
              <option value="">Not assigned</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="hp-label">Academic year *</label>
              <select className="hp-input" value={values.academic_year} onChange={(e) => set("academic_year", Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((y) => (
                  <option key={y} value={y}>
                    Year {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="hp-label">Account</label>
              <select className="hp-input" value={values.status} onChange={(e) => set("status", e.target.value as StudentFormValues["status"])}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
                <option value="graduated">Graduated</option>
              </select>
            </div>
          </div>
          <div>
            <label className="hp-label">Program</label>
            <input className="hp-input" value={values.program} onChange={(e) => set("program", e.target.value)} placeholder="B.Tech Computer Science" />
          </div>
          <div>
            <label className="hp-label">Emergency contact</label>
            <input
              className="hp-input"
              value={values.emergency_contact}
              onChange={(e) => set("emergency_contact", e.target.value)}
              placeholder="Parent / guardian number"
            />
          </div>
        </div>

        <div>
          <label className="hp-label">Student photograph</label>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/12 px-3 py-2.5">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="text-[11.5px] text-ink-400 file:mr-2 file:rounded-lg file:border-0 file:bg-white/8 file:px-2.5 file:py-1 file:text-[11px] file:text-white"
            />
            {photo ? (
              <span className="flex items-center gap-1 text-[10.5px] text-mint-300">
                <Check size={12} /> {photo.name}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[10px] text-ink-400">
            Stored privately in Supabase Storage. Face recognition uses a separate encrypted template — this photo is for
            identification only.
          </p>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-[#ff5e47]/30 bg-[#ff5e47]/8 px-3 py-2">
            <AlertCircle size={14} className="mt-0.5 text-[#ffb2a1]" />
            <p className="text-[11.5px] text-[#ffb2a1]">{error}</p>
          </div>
        ) : null}
        {progress ? (
          <p className="flex items-center gap-1.5 text-[11px] text-ink-400">
            <Loader2 size={12} className="hp-spin" /> {progress}
          </p>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button type="submit" loading={saving}>
            {studentId ? "Save changes" : "Create student"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
