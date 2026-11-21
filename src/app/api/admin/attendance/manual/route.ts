import { NextResponse, type NextRequest } from "next/server";
import { authenticate, isResponse, jsonError, requireRole } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "gym_staff", "trainer"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { student_id?: string; reason?: string };
  if (!body.student_id) return jsonError("student_id is required");

  // the RPC re-checks is_gym_staff() from auth.uid(), so it must run with the caller's JWT
  const { data, error } = await ctx.db.rpc("manual_attendance", {
    p_student: body.student_id,
    p_reason: (body.reason || "ID verified at gym desk").slice(0, 300),
  });
  if (error) return jsonError(error.message, 400);
  return NextResponse.json(data);
}
