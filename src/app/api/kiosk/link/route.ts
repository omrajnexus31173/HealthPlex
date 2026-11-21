import { NextResponse, type NextRequest } from "next/server";
import { authenticate, isResponse, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { sha256 } from "@/lib/server/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A staff member pairs a physical kiosk with a device key issued by an admin. */
export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "gym_staff", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = (body.code ?? "").trim();
  if (code.length < 12) return NextResponse.json({ error: "Device key looks incomplete" }, { status: 400 });

  const service = createServiceSupabase();
  const { data: device, error } = await service
    .from("kiosk_devices")
    .select("id, name, location, status")
    .eq("code_hash", sha256(code))
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!device || device.status !== "active") {
    return NextResponse.json({ error: "This device key is not recognised or has been revoked" }, { status: 403 });
  }

  await service.from("kiosk_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
  await service.from("audit_logs").insert({
    actor_id: ctx.user.id,
    actor_role: ctx.profile.role,
    action: "kiosk.pair",
    entity: "kiosk_devices",
    entity_id: device.id,
    after: { name: device.name },
  });

  return NextResponse.json({ ok: true, name: device.name, location: device.location });
}
