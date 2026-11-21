import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const service = createServiceSupabase();

  const { data: before } = await service
    .from("students")
    .select("*, profiles:profiles(full_name,email,phone,status)")
    .eq("id", id)
    .maybeSingle();
  if (!before) return jsonError("Student not found", 404);

  const profilePatch: Record<string, unknown> = {};
  if (typeof body.full_name === "string" && body.full_name.trim().length >= 3) profilePatch.full_name = body.full_name.trim();
  if (body.phone !== undefined) profilePatch.phone = body.phone ? String(body.phone).trim() : null;
  if (typeof body.status === "string" && ["active", "inactive", "suspended", "graduated"].includes(body.status)) {
    profilePatch.status = body.status;
  }
  if (Object.keys(profilePatch).length) {
    const { error } = await service.from("profiles").update(profilePatch).eq("id", id);
    if (error) return jsonError(error.message, 400);
  }

  const studentPatch: Record<string, unknown> = {};
  if (typeof body.enrollment_id === "string" && body.enrollment_id.trim()) {
    const enrollment = body.enrollment_id.trim().toUpperCase();
    if (enrollment !== before.enrollment_id) {
      const { data: dup } = await service
        .from("students")
        .select("id")
        .ilike("enrollment_id", enrollment)
        .neq("id", id)
        .maybeSingle();
      if (dup) return jsonError(`Enrollment ID ${enrollment} is already used by another student`, 409);
      studentPatch.enrollment_id = enrollment;
    }
  }
  if (body.department_id !== undefined) studentPatch.department_id = body.department_id || null;
  if (body.academic_year !== undefined) {
    const y = Number(body.academic_year);
    if (!Number.isInteger(y) || y < 1 || y > 6) return jsonError("Academic year must be between 1 and 6");
    studentPatch.academic_year = y;
  }
  if (body.program !== undefined) studentPatch.program = body.program ? String(body.program).trim() : null;
  if (body.emergency_contact !== undefined) studentPatch.emergency_contact = body.emergency_contact ? String(body.emergency_contact).trim() : null;
  if (body.notes !== undefined) studentPatch.notes = body.notes ? String(body.notes) : null;

  if (Object.keys(studentPatch).length) {
    const { error } = await service.from("students").update(studentPatch).eq("id", id);
    if (error) return jsonError(error.message, 400);
  }

  await audit(ctx, "student.update", "students", id, before, { ...profilePatch, ...studentPatch });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;
  const { id } = await params;
  if (id === ctx.user.id) return jsonError("You cannot archive your own account", 400);

  const service = createServiceSupabase();
  // soft-delete the student record and revoke biometrics; history is preserved
  const { data: before } = await service.from("students").select("*").eq("id", id).maybeSingle();
  if (!before) return jsonError("Student not found", 404);

  await service.from("face_templates").update({ status: "withdrawn", revoked_at: new Date().toISOString() }).eq("student_id", id);
  await service.from("students").update({ face_enrolled: false, face_consent: "withdrawn", deleted_at: new Date().toISOString() }).eq("id", id);
  await service.from("profiles").update({ status: "inactive" }).eq("id", id);
  await service.from("face_enrollment_audit").insert({
    student_id: id,
    action: "withdrawn",
    actor_id: ctx.user.id,
    actor_role: ctx.profile.role,
    notes: "Student archived — biometric template revoked",
  });

  await audit(ctx, "student.archive", "students", id, before, { deleted_at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
