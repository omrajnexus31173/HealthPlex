import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, notify, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    description?: string | null;
    trainer_id?: string | null;
    session_date?: string;
    start_time?: string;
    end_time?: string;
    capacity?: number;
    location?: string | null;
  };
  if (!body.title || body.title.trim().length < 3) return jsonError("Session title is required");
  if (!body.session_date || !body.start_time || !body.end_time) return jsonError("Date, start and end time are required");
  if (body.start_time >= body.end_time) return jsonError("End time must be after the start time");
  const capacity = Number(body.capacity ?? 20);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) return jsonError("Capacity must be between 1 and 200");

  // trainers may only schedule their own sessions
  let trainerId = body.trainer_id || null;
  if (ctx.profile.role === "trainer") trainerId = ctx.user.id;

  const service = createServiceSupabase();
  const { data, error } = await service
    .from("training_sessions")
    .insert({
      title: body.title.trim(),
      description: body.description || null,
      trainer_id: trainerId,
      session_date: body.session_date,
      start_time: body.start_time,
      end_time: body.end_time,
      capacity,
      location: body.location || "Main Gym Floor",
      created_by: ctx.user.id,
    })
    .select()
    .single();
  if (error) return jsonError(error.message, 400);

  await notify("New training session", `${data.title} on ${data.session_date} at ${data.start_time.slice(0, 5)}`, "info", {
    role: "student",
    link: "/me/sessions",
  });
  await audit(ctx, "session.create", "training_sessions", data.id, null, data);
  return NextResponse.json({ session: data });
}

export async function PATCH(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!body.id || !["cancel", "complete"].includes(body.action ?? "")) return jsonError("Unsupported session action");

  const service = createServiceSupabase();
  const { data: before } = await service.from("training_sessions").select("*").eq("id", body.id).maybeSingle();
  if (!before) return jsonError("Session not found", 404);
  if (ctx.profile.role === "trainer" && before.trainer_id !== ctx.user.id) return jsonError("You can only manage your own sessions", 403);

  const { data, error } = await service
    .from("training_sessions")
    .update({ status: body.action === "cancel" ? "cancelled" : "completed", booking_enabled: false })
    .eq("id", body.id)
    .select()
    .single();
  if (error) return jsonError(error.message, 400);

  if (body.action === "cancel") {
    await service.from("session_bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("session_id", body.id).eq("status", "booked");
    await notify("Session cancelled", `${before.title} on ${before.session_date} has been cancelled.`, "warning", { role: "student", link: "/me/sessions" });
  }
  await audit(ctx, `session.${body.action}`, "training_sessions", body.id, before, data);
  return NextResponse.json({ session: data });
}

export async function PUT(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { session_id?: string; student_id?: string; status?: string };
  if (!body.session_id || !body.student_id) return jsonError("Session and student are required");
  const service = createServiceSupabase();
  const { error } = await service
    .from("session_attendance")
    .upsert({ session_id: body.session_id, student_id: body.student_id, status: body.status === "absent" ? "absent" : "present", marked_by: ctx.user.id }, { onConflict: "session_id,student_id" });
  if (error) return jsonError(error.message, 400);
  await audit(ctx, "session.attendance", "session_attendance", `${body.session_id}:${body.student_id}`, null, { status: body.status });
  return NextResponse.json({ ok: true });
}
