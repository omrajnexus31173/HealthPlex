import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Records the storage path of a photo that the admin already uploaded via Supabase Storage. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { path?: string };
  if (!body.path || !body.path.startsWith(`${id}/`)) return jsonError("Invalid photo path");

  const service = createServiceSupabase();
  const { data: before } = await service.from("students").select("photo_path").eq("id", id).maybeSingle();
  const { error } = await service.from("students").update({ photo_path: body.path }).eq("id", id);
  if (error) return jsonError(error.message, 500);

  if (before?.photo_path && before.photo_path !== body.path) {
    await service.storage.from("student-photos").remove([before.photo_path]).catch(() => undefined);
  }
  await audit(ctx, "student.photo_update", "students", id, { photo_path: before?.photo_path }, { photo_path: body.path });
  return NextResponse.json({ ok: true });
}
