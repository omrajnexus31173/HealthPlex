import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retention status, execution history, summaries and backups — Super Admin only. */
export async function GET(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin"]);
  if (denied) return denied;

  const service = createServiceSupabase();
  const backupId = request.nextUrl.searchParams.get("backup");
  if (backupId) {
    const { data, error } = await service.from("cleanup_backups").select("payload, checksum, record_count").eq("id", backupId).maybeSingle();
    if (error || !data) return jsonError("Backup not found", 404);
    await audit(ctx, "retention.backup_export", "cleanup_backups", backupId);
    return NextResponse.json({ payload: data.payload, checksum: data.checksum, records: data.record_count });
  }

  const [status, runs, summaries, backups, cron] = await Promise.all([
    service.rpc("retention_status", {}),
    service.from("cleanup_runs").select("*").order("started_at", { ascending: false }).limit(40),
    service.from("attendance_monthly_summary").select("*").order("year", { ascending: false }).order("month", { ascending: false }).limit(24),
    service.from("cleanup_backups").select("id, created_at, cutoff_date, record_count, checksum, verified, storage_bytes").order("created_at", { ascending: false }).limit(20),
    service.schema("cron").from("job").select("jobid, jobname, schedule, active").eq("jobname", "healthplex-monthly-attendance-retention"),
  ]);

  if (status.error) return jsonError(status.error.message, 500);

  // the RPC returns a to_jsonb() of the row even when no execution exists yet
  const statusPayload = { ...(status.data as Record<string, unknown>) };
  const last = statusPayload.last_execute as { id?: string | null } | null;
  if (!last || !last.id) statusPayload.last_execute = null;

  return NextResponse.json({
    status: statusPayload,
    runs: runs.data ?? [],
    summaries: summaries.data ?? [],
    backups: backups.data ?? [],
    cron: cron.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { action?: string; confirm?: string };
  const service = createServiceSupabase();
  // run_attendance_cleanup() re-checks is_super_admin() via auth.uid(), so the
  // execution itself is issued with the caller's JWT, not the service role.

  if (body.action === "dry_run") {
    const { data, error } = await ctx.db.rpc("run_attendance_cleanup", { p_mode: "dry_run", p_trigger: "manual", p_actor: ctx.user.id });
    if (error) return jsonError(error.message, 400);
    await audit(ctx, "retention.dry_run", "attendance_records", null, null, data as object);
    return NextResponse.json(data);
  }

  if (body.action === "execute") {
    if (body.confirm !== "DELETE") return jsonError("Type DELETE to confirm a destructive cleanup", 400);
    const { data: settings } = await service.from("gym_settings").select("retention_enabled, retention_armed").eq("id", true).single();
    if (!settings?.retention_armed || !settings?.retention_enabled) {
      return jsonError("The retention policy must be approved and armed before a manual cleanup can run", 403);
    }
    const { data, error } = await ctx.db.rpc("run_attendance_cleanup", { p_mode: "execute", p_trigger: "manual", p_actor: ctx.user.id });
    if (error) return jsonError(error.message, 400);
    return NextResponse.json(data);
  }

  return jsonError("Unsupported action");
}

export async function PATCH(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    retention_months?: number;
    retention_enabled?: boolean;
    retention_armed?: boolean;
    approved_by?: string;
  };
  const service = createServiceSupabase();
  const { data: current } = await service
    .from("gym_settings")
    .select("retention_months, retention_enabled, retention_armed, retention_approved_by")
    .eq("id", true)
    .single();
  if (!current) return jsonError("Gym settings missing", 500);

  const months = body.retention_months ?? current.retention_months;
  const enabled = body.retention_enabled ?? current.retention_enabled;
  const armed = body.retention_armed ?? current.retention_armed;
  const approvedBy = body.approved_by !== undefined ? body.approved_by : current.retention_approved_by;

  // set_retention_policy() also enforces is_super_admin() from the JWT
  const { data, error } = await ctx.db.rpc("set_retention_policy", {
    p_months: months,
    p_enabled: enabled,
    p_armed: armed,
    p_approved_by: approvedBy ?? null,
  });
  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ policy: data });
}
