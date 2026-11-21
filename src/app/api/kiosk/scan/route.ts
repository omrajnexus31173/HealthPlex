import { NextResponse, type NextRequest } from "next/server";
import { authenticate, isResponse, notify, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { sha256 } from "@/lib/server/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_RESULTS = new Set([
  "success",
  "already_marked",
  "cooldown",
  "unknown_face",
  "low_confidence",
  "ambiguous_match",
  "liveness_failed",
  "multiple_faces",
  "inactive_student",
  "no_face",
  "no_template",
  "error",
  "invalid_pin",
]);

type Body = {
  code?: string;
  student_id?: string | null;
  confidence?: number;
  liveness_score?: number;
  faces_detected?: number;
  meta?: Record<string, unknown>;
};

/** Mark attendance (entry or exit) for a face that the kiosk actually matched. */
export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "gym_staff", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Body;
  const code = (body.code ?? "").trim();
  if (!code || !body.student_id) return NextResponse.json({ error: "Device key and student are required" }, { status: 400 });

  const service = createServiceSupabase();
  const { data: device } = await service
    .from("kiosk_devices")
    .select("id, status")
    .eq("code_hash", sha256(code))
    .maybeSingle();
  if (!device || device.status !== "active") {
    return NextResponse.json({ error: "This kiosk is not paired or has been revoked" }, { status: 403 });
  }

  const { data: settings } = await service.from("gym_settings").select("*").eq("id", true).single();
  if (!settings) return NextResponse.json({ error: "Gym settings are missing" }, { status: 500 });

  const confidence = Number(body.confidence ?? 0);
  const liveness = Number(body.liveness_score ?? 0);
  const threshold = Number(settings.recognition_threshold);
  const livenessThreshold = Number(settings.liveness_threshold);

  const logAttempt = async (result: string, reason: string) => {
    await service.from("attendance_attempts").insert({
      student_id: body.student_id ?? null,
      device_id: device.id,
      result: ALLOWED_RESULTS.has(result) ? result : "error",
      confidence: Number.isFinite(confidence) ? confidence : null,
      liveness_score: Number.isFinite(liveness) ? liveness : null,
      faces_detected: body.faces_detected ?? null,
      reason,
      meta: body.meta ?? {},
    });
  };

  // Server-side re-validation: a client cannot bypass the configured gates.
  if (!Number.isFinite(confidence) || confidence < 1 - threshold) {
    await logAttempt("low_confidence", `confidence ${confidence} below ${1 - threshold}`);
    return NextResponse.json({ status: "unknown", message: "Match confidence was too low — please scan again." });
  }
  if (!Number.isFinite(liveness) || liveness < livenessThreshold) {
    await logAttempt("liveness_failed", `liveness ${liveness} below ${livenessThreshold}`);
    return NextResponse.json({ status: "error", message: "Liveness verification failed — please look at the camera and retry." });
  }

  const { data, error } = await service.rpc("kiosk_scan", {
    p_code: code,
    p_student: body.student_id,
    p_confidence: Math.min(0.9999, Math.max(0, confidence)),
    p_liveness: Math.min(0.9999, Math.max(0, liveness)),
    p_faces: body.faces_detected ?? 1,
    p_meta: { agent: "healthplex-kiosk", ...(body.meta ?? {}) },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const payload = data as {
    status: string;
    action?: string;
    student?: { name: string };
    inside_count?: number;
  };

  if (payload?.status === "success" && payload.action === "entry") {
    const capacity = Number(settings.capacity);
    if (settings.capacity_alerts && payload.inside_count != null && payload.inside_count >= capacity) {
      await notify(
        "Gym at capacity",
        `HEALTHPLEX is at ${payload.inside_count}/${capacity} occupancy. Pause new entries at the door.`,
        "warning",
        { role: "gym_staff", link: "/monitor" },
      );
    }
  }

  return NextResponse.json(data);
}
