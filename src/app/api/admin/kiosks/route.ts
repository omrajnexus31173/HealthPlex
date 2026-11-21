import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { sha256 } from "@/lib/server/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;
  const service = createServiceSupabase();
  const { data, error } = await service
    .from("kiosk_devices")
    .select("id, name, location, status, last_seen_at, created_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ devices: data });
}

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { name?: string; location?: string };
  if (!body.name || body.name.trim().length < 3) return jsonError("Give the kiosk a recognisable name");

  const code = `hpk_${crypto.randomBytes(24).toString("base64url")}`;
  const service = createServiceSupabase();
  const { data, error } = await service
    .from("kiosk_devices")
    .insert({
      name: body.name.trim(),
      location: body.location?.trim() || "Gym entrance",
      code_hash: sha256(code),
      created_by: ctx.user.id,
    })
    .select("id, name, location, created_at")
    .single();
  if (error) return jsonError(error.message, 500);

  await audit(ctx, "kiosk.create", "kiosk_devices", data.id, null, { name: data.name });
  // the plaintext key is returned exactly once and only stored hashed
  return NextResponse.json({ device: data, code });
}

export async function PATCH(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!body.id || body.action !== "revoke") return jsonError("Unsupported kiosk action");
  if (body.id === ctx.user.id) return jsonError("Invalid device", 400);

  const service = createServiceSupabase();
  const { error } = await service
    .from("kiosk_devices")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", body.id);
  if (error) return jsonError(error.message, 500);
  await audit(ctx, "kiosk.revoke", "kiosk_devices", body.id);
  return NextResponse.json({ ok: true });
}
