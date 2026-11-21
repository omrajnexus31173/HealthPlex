import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Student self-service biometric consent withdrawal (DPDP-style erasure).
 *
 * Why a server route is required: `face_enrolled` / `face_consent` are protected by
 * the privilege guard, so a student cannot clear them from the browser client. This
 * route deletes the template first and only then flips the flags, so a failure can
 * never leave a template "granted" while consent reads withdrawn.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  if (ctx.profile.role !== "student") {
    return jsonError("Only a student can withdraw their own biometric consent", 403);
  }
  void request;

  const service = createServiceSupabase();
  const { data: template, error: readError } = await service
    .from("face_templates")
    .select("id, status, samples_count")
    .eq("student_id", ctx.user.id)
    .maybeSingle();
  if (readError) return jsonError(readError.message, 500);

  // 1. destroy the biometric material
  const { error: deleteError } = await service.from("face_templates").delete().eq("student_id", ctx.user.id);
  if (deleteError) return jsonError(deleteError.message, 500);

  // 2. clear the flags on the student record
  const { error: studentError } = await service
    .from("students")
    .update({ face_enrolled: false, face_consent: "withdrawn", face_consented_at: null })
    .eq("id", ctx.user.id);
  if (studentError) return jsonError(studentError.message, 500);

  // 3. audit trail
  await service.from("face_enrollment_audit").insert({
    student_id: ctx.user.id,
    action: "withdrawn",
    actor_id: ctx.user.id,
    actor_role: ctx.profile.role,
    samples_count: template?.samples_count ?? null,
    notes: "Consent withdrawn by the student — biometric template deleted",
  });
  await audit(ctx, "biometric.withdraw", "face_templates", ctx.user.id, { status: template?.status ?? null }, { status: "deleted" });

  return NextResponse.json({ ok: true, template_deleted: Boolean(template?.id) });
}
