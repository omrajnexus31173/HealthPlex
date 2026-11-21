import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { encryptDescriptor, toByteaHex } from "@/lib/server/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONSENT_VERSION = "v1-2026-11";

type Body = {
  student_id: string;
  /** base64 float32 descriptors captured on the device (3–5 samples) */
  samples: string[];
  liveness_score: number;
  quality: number;
  consent_given: boolean;
  consent_reference?: string;
  verified_enrollment_id?: string;
  acting_for_self?: boolean;
};

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;

  const body = (await request.json().catch(() => ({}))) as Body;
  const isSelf = body.acting_for_self === true;

  // a student may only enrol their own face; staff enrol on a student's behalf
  if (!isSelf) {
    const denied = requireRole(ctx, ["super_admin", "gym_admin", "gym_staff"]);
    if (denied) return denied;
  } else if (ctx.profile.role !== "student") {
    return jsonError("Self-enrolment is only available to student accounts", 403);
  }

  if (!body.student_id) return jsonError("student_id is required");
  if (isSelf && body.student_id !== ctx.user.id) return jsonError("You can only enrol your own face", 403);
  if (!body.consent_given) return jsonError("Informed consent must be recorded before capturing biometrics");

  const samples = Array.isArray(body.samples) ? body.samples : [];
  if (samples.length < 3) return jsonError("At least 3 face samples are required for a reliable template");
  const descriptors = samples.map((s) => {
    const buf = Buffer.from(s, "base64");
    if (buf.length !== 128 * 4) throw new Error("Each sample must be a 128-D float32 descriptor");
    return new Float32Array(buf.buffer, buf.byteOffset, 128);
  });

  const service = createServiceSupabase();
  const { data: student } = await service
    .from("students")
    .select("id, enrollment_id, deleted_at, profiles:profiles(full_name,status)")
    .eq("id", body.student_id)
    .maybeSingle();
  if (!student || student.deleted_at) return jsonError("Student not found", 404);

  // university ID verification before biometric enrolment
  if (body.verified_enrollment_id && body.verified_enrollment_id.trim().toUpperCase() !== student.enrollment_id.toUpperCase()) {
    await service.from("face_enrollment_audit").insert({
      student_id: student.id,
      action: "verification_failed",
      actor_id: ctx.user.id,
      actor_role: ctx.profile.role,
      notes: "Enrollment ID check failed during face enrolment",
    });
    return jsonError("The verified university ID does not match this student record", 400);
  }
  if (!isSelf && !body.verified_enrollment_id) {
    return jsonError("Verify the student's university enrollment ID before capturing biometrics");
  }

  // average the samples into a single robust template
  const avg = new Float32Array(128);
  for (const d of descriptors) for (let i = 0; i < 128; i++) avg[i] += d[i] / descriptors.length;

  // cohesion check: samples must agree, otherwise the capture was noisy
  let maxPairDistance = 0;
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      let sum = 0;
      for (let k = 0; k < 128; k++) sum += (descriptors[i][k] - descriptors[j][k]) ** 2;
      maxPairDistance = Math.max(maxPairDistance, Math.sqrt(sum));
    }
  }
  if (maxPairDistance > 0.55) {
    return jsonError("The captured samples are inconsistent — please retry in steadier lighting", 422);
  }

  const enc = encryptDescriptor(avg);
  const now = new Date().toISOString();

  const { error: templateError } = await service.from("face_templates").upsert(
    {
      student_id: student.id,
      ciphertext: toByteaHex(enc.ciphertext),
      iv: toByteaHex(enc.iv),
      auth_tag: toByteaHex(enc.authTag),
      key_version: enc.keyVersion,
      dimension: 128,
      samples_count: descriptors.length,
      quality: Math.min(1, Math.max(0, Number(body.quality) || 0)),
      liveness_score: Math.min(1, Math.max(0, Number(body.liveness_score) || 0)),
      consent_version: CONSENT_VERSION,
      consented_at: now,
      status: "granted",
      revoked_at: null,
      updated_at: now,
    },
    { onConflict: "student_id" },
  );
  if (templateError) return jsonError(templateError.message, 500);

  await service
    .from("students")
    .update({ face_enrolled: true, face_consent: "granted", face_consented_at: now })
    .eq("id", student.id);

  await service.from("face_enrollment_audit").insert({
    student_id: student.id,
    action: "enrolled",
    actor_id: ctx.user.id,
    actor_role: ctx.profile.role,
    samples_count: descriptors.length,
    liveness_score: Number(body.liveness_score) || null,
    quality: Number(body.quality) || null,
    notes: `${isSelf ? "Student self-enrolment" : "Staff-assisted enrolment"}; consent ${CONSENT_VERSION}${
      body.consent_reference ? `; ref ${body.consent_reference}` : ""
    }`,
  });

  await audit(ctx, "biometric.enroll", "face_templates", student.id, null, {
    samples: descriptors.length,
    liveness: body.liveness_score,
    consent_version: CONSENT_VERSION,
  });

  return NextResponse.json({ ok: true, samples: descriptors.length, consent_version: CONSENT_VERSION });
}

/** Withdraw consent and delete the biometric template. */
export async function DELETE(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const body = (await request.json().catch(() => ({}))) as { student_id?: string; reason?: string };
  if (!body.student_id) return jsonError("student_id is required");

  const isSelf = ctx.profile.role === "student";
  if (isSelf && body.student_id !== ctx.user.id) return jsonError("You can only withdraw your own consent", 403);
  if (!isSelf) {
    const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
    if (denied) return denied;
  }

  const service = createServiceSupabase();
  const now = new Date().toISOString();
  await service.from("face_templates").update({ status: "withdrawn", revoked_at: now }).eq("student_id", body.student_id);
  await service.from("face_templates").delete().eq("student_id", body.student_id);
  await service
    .from("students")
    .update({ face_enrolled: false, face_consent: "withdrawn", face_consented_at: null })
    .eq("id", body.student_id);

  await service.from("face_enrollment_audit").insert({
    student_id: body.student_id,
    action: "withdrawn",
    actor_id: ctx.user.id,
    actor_role: ctx.profile.role,
    notes: body.reason ?? "Consent withdrawn — biometric template deleted",
  });
  await audit(ctx, "biometric.withdraw", "face_templates", body.student_id, { status: "granted" }, { status: "withdrawn" });

  return NextResponse.json({ ok: true });
}
