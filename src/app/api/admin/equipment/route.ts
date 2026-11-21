import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, notify, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["operational", "maintenance", "out_of_service", "retired"];

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, string>;
  if (!body.name || !body.tag_code) return jsonError("Asset tag and name are required");
  const service = createServiceSupabase();
  const { data, error } = await service
    .from("equipment")
    .insert({
      tag_code: body.tag_code.trim().toUpperCase(),
      name: body.name.trim(),
      category: body.category?.trim() || "general",
      brand: body.brand?.trim() || null,
      location: body.location?.trim() || null,
      condition: ["excellent", "good", "fair", "poor"].includes(body.condition) ? body.condition : "good",
      status: "operational",
      notes: body.notes?.trim() || null,
    })
    .select()
    .single();
  if (error) return jsonError(error.message, 400);
  await audit(ctx, "equipment.create", "equipment", data.id, null, data);
  return NextResponse.json({ equipment: data });
}

export async function PATCH(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    maintenance_id?: string;
    action?: string;
    resolution_notes?: string;
  };

  const service = createServiceSupabase();

  if (body.maintenance_id && body.action === "resolve") {
    const denied = requireRole(ctx, ["super_admin", "gym_admin", "trainer"]);
    if (denied) return denied;
    const { data, error } = await service
      .from("equipment_maintenance")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: ctx.user.id, resolution_notes: body.resolution_notes || null })
      .eq("id", body.maintenance_id)
      .select()
      .single();
    if (error) return jsonError(error.message, 400);
    // bring equipment back into service if no other open faults remain
    const { count } = await service
      .from("equipment_maintenance")
      .select("id", { count: "exact", head: true })
      .eq("equipment_id", data.equipment_id)
      .in("status", ["open", "in_progress"]);
    if (!count) {
      await service.from("equipment").update({ status: "operational", last_serviced_on: new Date().toISOString().slice(0, 10) }).eq("id", data.equipment_id).eq("status", "maintenance");
    }
    await audit(ctx, "equipment.maintenance_resolved", "equipment_maintenance", body.maintenance_id, null, data);
    return NextResponse.json({ record: data });
  }

  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;
  if (!body.id || !body.status || !STATUSES.includes(body.status)) return jsonError("Invalid equipment status update");

  const { data: before } = await service.from("equipment").select("*").eq("id", body.id).maybeSingle();
  if (!before) return jsonError("Equipment not found", 404);
  const { data, error } = await service.from("equipment").update({ status: body.status }).eq("id", body.id).select().single();
  if (error) return jsonError(error.message, 400);
  await audit(ctx, "equipment.status", "equipment", body.id, { status: before.status }, { status: body.status });
  return NextResponse.json({ equipment: data });
}

export async function PUT(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "gym_staff", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { equipment_id?: string; title?: string; description?: string; type?: string };
  if (!body.equipment_id || !body.title) return jsonError("Equipment and fault title are required");

  const service = createServiceSupabase();
  const { data, error } = await service
    .from("equipment_maintenance")
    .insert({
      equipment_id: body.equipment_id,
      type: ["fault", "preventive", "inspection"].includes(body.type ?? "") ? body.type : "fault",
      title: body.title.slice(0, 160),
      description: body.description?.slice(0, 800) || null,
      reported_by: ctx.user.id,
    })
    .select()
    .single();
  if (error) return jsonError(error.message, 400);

  await service.from("equipment").update({ status: "maintenance" }).eq("id", body.equipment_id).eq("status", "operational");
  await notify("Equipment fault reported", `${body.title} — reported by ${ctx.profile.full_name}`, "warning", { role: "gym_admin", link: "/equipment" });
  await audit(ctx, "equipment.fault_reported", "equipment_maintenance", data.id, null, data);
  return NextResponse.json({ record: data });
}
