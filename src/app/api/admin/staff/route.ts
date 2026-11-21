import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATABLE = new Set(["gym_staff", "trainer", "gym_admin"]);

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    full_name?: string;
    email?: string;
    role?: string;
    code?: string;
    phone?: string | null;
    designation?: string | null;
    specialization?: string | null;
    experience_years?: number;
    shift_id?: string | null;
  };

  if (!body.full_name || body.full_name.trim().length < 3) return jsonError("Full name is required");
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return jsonError("A valid email is required");
  if (!body.role || !CREATABLE.has(body.role)) return jsonError("Role must be gym_staff, trainer or gym_admin");
  // only a super admin can mint another gym admin
  if (body.role === "gym_admin" && ctx.profile.role !== "super_admin") return jsonError("Only a super admin can create gym admins", 403);

  const email = body.email.trim().toLowerCase();
  const service = createServiceSupabase();
  const { data: dup } = await service.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (dup) return jsonError("A user with this email already exists", 409);

  const password = `Hp!${crypto.randomBytes(6).toString("base64url")}${crypto.randomInt(10, 99)}`;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body.full_name.trim() },
  });
  if (createError || !created.user) return jsonError(createError?.message ?? "Could not create the account", 400);
  const userId = created.user.id;

  const { error: profileError } = await service.from("profiles").insert({
    id: userId,
    role: body.role,
    full_name: body.full_name.trim(),
    email,
    phone: body.phone?.trim() || null,
    status: "active",
    must_change_password: true,
  });
  if (profileError) {
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
    return jsonError(profileError.message, 400);
  }

  if (body.role === "trainer") {
    const code = body.code?.trim() || `TRN-${crypto.randomInt(1000, 9999)}`;
    const { error } = await service.from("trainers").insert({
      id: userId,
      trainer_code: code,
      specialization: body.specialization?.trim() || null,
      experience_years: Number(body.experience_years) || 0,
    });
    if (error) return jsonError(error.message, 400);
  } else {
    const code = body.code?.trim() || `STF-${crypto.randomInt(1000, 9999)}`;
    const { error } = await service.from("staff").insert({
      id: userId,
      staff_code: code,
      designation: body.designation?.trim() || null,
      shift_id: body.shift_id || null,
    });
    if (error) return jsonError(error.message, 400);
  }

  await audit(ctx, "staff.create", "profiles", userId, null, { email, role: body.role });
  return NextResponse.json({ id: userId, email, temporary_password: password, role: body.role });
}

export async function PATCH(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!body.id || !body.status || !["active", "inactive", "suspended"].includes(body.status)) return jsonError("Invalid status update");

  const service = createServiceSupabase();
  const { data: target } = await service.from("profiles").select("id, role, status").eq("id", body.id).maybeSingle();
  if (!target) return jsonError("Account not found", 404);
  if (target.role === "super_admin") return jsonError("Super admin accounts cannot be modified here", 403);
  if (target.role === "gym_admin" && ctx.profile.role !== "super_admin") return jsonError("Only a super admin can modify gym admins", 403);
  if (body.id === ctx.user.id) return jsonError("You cannot change your own status", 400);

  const { error } = await service.from("profiles").update({ status: body.status }).eq("id", body.id);
  if (error) return jsonError(error.message, 400);
  await audit(ctx, "staff.status", "profiles", body.id, { status: target.status }, { status: body.status });
  return NextResponse.json({ ok: true });
}

export async function PUT(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    trainer_id?: string;
    weekday?: number;
    start_time?: string;
    end_time?: string;
    focus?: string | null;
  };
  if (!body.trainer_id || body.weekday == null || !body.start_time || !body.end_time) return jsonError("Complete the availability slot");
  if (body.start_time >= body.end_time) return jsonError("End time must be after the start time");

  const service = createServiceSupabase();
  const { data, error } = await service
    .from("trainer_schedules")
    .insert({
      trainer_id: body.trainer_id,
      weekday: Number(body.weekday),
      start_time: body.start_time,
      end_time: body.end_time,
      focus: body.focus || null,
    })
    .select()
    .single();
  if (error) return jsonError(error.message, 400);
  await audit(ctx, "trainer.schedule_create", "trainer_schedules", data.id, null, data);
  return NextResponse.json({ schedule: data });
}
