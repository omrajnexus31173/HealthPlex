"use client";

import { createClient } from "@/lib/supabase/client";

export { csvEscape, downloadCsv, parseCsv, toCsv } from "@/lib/csv";
export { exportAttendancePdf, buildAttendancePdf } from "@/lib/pdf";
export type { PdfTableOptions } from "@/lib/pdf";

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
