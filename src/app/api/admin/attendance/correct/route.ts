import { NextResponse, type NextRequest } from "next/server";
import { authenticate, isResponse, jsonError, requireRole } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    record_id?: string;
    check_in_at?: string | null;
    check_out_at?: string | null;
    reason?: string;
  };
  if (!body.record_id) return jsonError("record_id is required");
  if (!body.reason || body.reason.trim().length < 5) return jsonError("A correction reason of at least 5 characters is required");

  // the RPC re-checks is_admin() from auth.uid(), so it must run with the caller's JWT
  const { data, error } = await ctx.db.rpc("correct_attendance", {
    p_record: body.record_id,
    p_check_in: body.check_in_at ?? null,
    p_check_out: body.check_out_at ?? null,
    p_reason: body.reason.trim(),
  });
  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ record: data });
}
