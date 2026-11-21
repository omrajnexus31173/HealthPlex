import { NextResponse } from "next/server";
import { createServiceSupabase, serverEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deployment health: verifies env wiring and real database connectivity. */
export async function GET() {
  const checks: Record<string, unknown> = {
    app: "HEALTHPLEX",
    time: new Date().toISOString(),
    env: {
      supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      anonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      serviceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      templateKey: Boolean(process.env.HEALTHPLEX_TEMPLATE_KEY),
    },
  };
  try {
    serverEnv();
    const service = createServiceSupabase();
    const { count, error } = await service.from("students").select("id", { count: "exact", head: true });
    const { data: settings } = await service.from("gym_settings").select("gym_name, capacity").eq("id", true).maybeSingle();
    checks.database = error ? { ok: false, error: error.message } : { ok: true, students: count, settings };
  } catch (e) {
    checks.database = { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
  const ok = (checks.database as { ok?: boolean })?.ok === true;
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
