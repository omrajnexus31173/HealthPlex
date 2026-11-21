import { NextResponse, type NextRequest } from "next/server";
import { authenticate, isResponse, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { sha256 } from "@/lib/server/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS = new Set([
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

/** Record a failed or suspicious recognition attempt for administrator review. */
export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "gym_staff", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    student_id?: string | null;
    result?: string;
    confidence?: number;
    second_best?: number;
    liveness_score?: number;
    faces_detected?: number;
    reason?: string;
    meta?: Record<string, unknown>;
  };
  const code = (body.code ?? "").trim();
  const result = body.result ?? "error";
  if (!code || !RESULTS.has(result)) return NextResponse.json({ error: "Invalid attempt payload" }, { status: 400 });

  const service = createServiceSupabase();
  const { data: device } = await service
    .from("kiosk_devices")
    .select("id, status")
    .eq("code_hash", sha256(code))
    .maybeSingle();
  if (!device || device.status !== "active") {
    return NextResponse.json({ error: "This kiosk is not paired or has been revoked" }, { status: 403 });
  }

  const clamp = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
  const { error } = await service.from("attendance_attempts").insert({
    student_id: body.student_id ?? null,
    device_id: device.id,
    result,
    confidence: clamp(body.confidence),
    second_best: clamp(body.second_best),
    liveness_score: clamp(body.liveness_score),
    faces_detected: typeof body.faces_detected === "number" ? body.faces_detected : null,
    reason: body.reason?.slice(0, 400) ?? null,
    meta: body.meta ?? {},
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
