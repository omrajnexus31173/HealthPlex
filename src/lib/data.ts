"use client";

import { createClient } from "@/lib/supabase/client";

export type StudentRow = {
  id: string;
  enrollment_id: string;
  academic_year: number;
  program: string | null;
  photo_path: string | null;
  face_enrolled: boolean;
  face_consent: "granted" | "withdrawn";
  department_id: string | null;
  profiles: { full_name: string; email: string; phone: string | null; status: string } | null;
  departments: { name: string; code: string } | null;
};

export async function listStudents(): Promise<StudentRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("students")
    .select(
      "id, enrollment_id, academic_year, program, photo_path, face_enrolled, face_consent, department_id, profiles:profiles(full_name,email,phone,status), departments(name,code)",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as StudentRow[]) ?? [];
}

export async function listDepartments() {
  const supabase = createClient();
  const { data, error } = await supabase.from("departments").select("id,name,code").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Signed URL for a private student photograph (1 hour). */
export async function photoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const supabase = createClient();
  const { data } = await supabase.storage.from("student-photos").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function uploadStudentPhoto(studentId: string, file: File): Promise<string> {
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${studentId}/photo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("student-photos").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type,
  });
  if (error) throw new Error(error.message);
  return path;
}

export function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

export async function exportAttendancePdf(opts: {
  title: string;
  subtitle: string;
  columns: string[];
  rows: (string | number | null)[][];
  filename: string;
}) {
  const { default: JsPDF } = await import("jspdf");
  await import("jspdf-autotable");
  const doc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFillColor(5, 11, 28);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 68, "F");
  doc.setTextColor(79, 224, 162);
  doc.setFontSize(17);
  doc.text("HEALTHPLEX", 40, 30);
  doc.setTextColor(232, 238, 249);
  doc.setFontSize(9.5);
  doc.text("GSFC University · Smart University Gym Management System", 40, 46);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text(opts.title, 40, 62);
  doc.setTextColor(90, 105, 130);
  doc.setFontSize(8.5);
  doc.text(opts.subtitle, 40, 84);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    head: [opts.columns],
    body: opts.rows.map((r) => r.map((c) => (c == null ? "—" : String(c)))),
    startY: 96,
    styles: { fontSize: 7.6, cellPadding: 4, textColor: [30, 40, 55] },
    headStyles: { fillColor: [12, 34, 28], textColor: [142, 240, 196], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [244, 248, 246] },
    margin: { left: 40, right: 40 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = ((doc as any).lastAutoTable?.finalY as number) ?? 120;
  doc.setTextColor(120, 130, 145);
  doc.setFontSize(7.5);
  doc.text(
    `Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · HEALTHPLEX · GSFC University`,
    40,
    Math.min(finalY + 20, doc.internal.pageSize.getHeight() - 20),
  );
  doc.save(opts.filename);
}
