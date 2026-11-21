import { NextResponse, type NextRequest } from "next/server";
import { authenticate, isResponse, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { decryptDescriptor, sha256 } from "@/lib/server/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hands the enrolled (decrypted) descriptors to a *paired and authenticated*
 * kiosk session so the browser can run matching locally at low latency.
 * Frames never leave the device; only descriptors travel, and only to staff
 * sessions that present a valid device key.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "gym_staff", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = (body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "Device key required" }, { status: 400 });

  const service = createServiceSupabase();
  const { data: device } = await service
    .from("kiosk_devices")
    .select("id, name, status")
    .eq("code_hash", sha256(code))
    .maybeSingle();
  if (!device || device.status !== "active") {
    return NextResponse.json({ error: "This kiosk is not paired or has been revoked" }, { status: 403 });
  }
  await service.from("kiosk_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  const [{ data: settings }, { data: students, error: studentsError }, { data: rows, error: templateError }] = await Promise.all([
    service.from("gym_settings").select("*").eq("id", true).single(),
    service
      .from("students")
      .select("id, enrollment_id, photo_path, face_enrolled, face_consent, deleted_at, profiles:profiles(full_name, status)")
      .eq("face_enrolled", true)
      .eq("face_consent", "granted")
      .is("deleted_at", null),
    service
      .from("face_templates")
      .select("student_id, ciphertext, iv, auth_tag, descriptor_version, status, dimension")
      .eq("status", "granted"),
  ]);
  if (studentsError) return NextResponse.json({ error: studentsError.message }, { status: 500 });
  if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });

  type StudentRow = {
    id: string;
    enrollment_id: string;
    photo_path: string | null;
    face_enrolled: boolean;
    profiles: { full_name: string; status: string } | { full_name: string; status: string }[] | null;
  };

  const eligible = new Map<string, StudentRow>();
  for (const s of (students ?? []) as StudentRow[]) {
    const profile = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
    if (profile?.status === "active") eligible.set(s.id, { ...s, profiles: profile });
  }

  const templates: { student_id: string; descriptor: string; version: string }[] = [];
  const failures: string[] = [];
  for (const row of rows ?? []) {
    if (!eligible.has(row.student_id)) continue;
    try {
      const descriptor = decryptDescriptor(row as { ciphertext: string; iv: string; auth_tag: string });
      templates.push({
        student_id: row.student_id,
        descriptor: Buffer.from(new Float32Array(descriptor).buffer).toString("base64"),
        version: row.descriptor_version,
      });
    } catch {
      failures.push(row.student_id);
    }
  }

  // short-lived signed URLs so the kiosk can display the student photograph
  const signed: Record<string, string> = {};
  await Promise.all(
    Array.from(eligible.values())
      .filter((s) => s.photo_path)
      .map(async (s) => {
        const { data } = await service.storage.from("student-photos").createSignedUrl(s.photo_path!, 3600);
        if (data?.signedUrl) signed[s.id] = data.signedUrl;
      }),
  );

  if (failures.length) {
    await service.from("audit_logs").insert({
      actor_id: ctx.user.id,
      actor_role: ctx.profile.role,
      action: "kiosk.template_decrypt_failed",
      entity: "face_templates",
      after: { students: failures },
    });
  }

  return NextResponse.json({
    students: Array.from(eligible.values()).map((s) => {
      const profile = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
      return {
        student_id: s.id,
        full_name: profile?.full_name ?? "Student",
        enrollment_id: s.enrollment_id,
        photo_path: s.photo_path,
        account_status: profile?.status ?? "unknown",
        has_template: templates.some((t) => t.student_id === s.id),
      };
    }),
    templates,
    signed_photo_urls: signed,
    config: {
      recognition_threshold: Number(settings?.recognition_threshold ?? 0.48),
      recognition_margin: Number(settings?.recognition_margin ?? 0.06),
      liveness_threshold: Number(settings?.liveness_threshold ?? 0.6),
      cooldown_minutes: Number(settings?.cooldown_minutes ?? 5),
      entry_exit_enabled: Boolean(settings?.entry_exit_enabled ?? true),
      capacity: Number(settings?.capacity ?? 0),
      timezone: settings?.timezone ?? "Asia/Kolkata",
      gym_name: settings?.gym_name ?? "HEALTHPLEX",
    },
    server_time: new Date().toISOString(),
  });
}
