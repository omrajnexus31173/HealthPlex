import { NextResponse, type NextRequest } from "next/server";
import { serverEnv, createServiceSupabase } from "@/lib/supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Profile, user_role } from "@/lib/types";

export type ApiContext = {
  user: { id: string; email: string };
  profile: Profile;
  /**
   * Request-scoped client carrying the caller's JWT. RLS, `auth.uid()` and the
   * privilege-guard triggers evaluate against the real user, so every
   * admin mutation or auth-dependent RPC MUST go through this client.
   */
  db: SupabaseClient;
};

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Resolve the caller from the Authorization bearer token (or cookies) and load the profile. */
export async function authenticate(request: NextRequest): Promise<ApiContext | NextResponse> {
  const { url, anon } = serverEnv();
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;

  const client = createClient(url, anon, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return jsonError("Authentication required", 401);

  const service = createServiceSupabase();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) return jsonError(profileError.message, 500);
  if (!profile) return jsonError("Account is not provisioned for HEALTHPLEX", 403);
  if (profile.status !== "active") return jsonError("Account is not active", 403);

  return {
    user: { id: data.user.id, email: data.user.email ?? profile.email },
    profile: profile as Profile,
    db: client,
  };
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export function requireRole(ctx: ApiContext, roles: user_role[]): NextResponse | null {
  if (!roles.includes(ctx.profile.role)) return jsonError("You do not have permission to perform this action", 403);
  return null;
}

export async function audit(
  ctx: ApiContext,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown = null,
  after: unknown = null,
) {
  const service = createServiceSupabase();
  await service.from("audit_logs").insert({
    actor_id: ctx.user.id,
    actor_role: ctx.profile.role,
    action,
    entity,
    entity_id: entityId,
    before,
    after,
  });
}

export async function notify(
  title: string,
  body: string,
  severity: "info" | "success" | "warning" | "critical" = "info",
  opts: { userId?: string; role?: user_role; link?: string } = {},
) {
  const service = createServiceSupabase();
  await service.from("notifications").insert({
    title,
    body,
    severity,
    user_id: opts.userId ?? null,
    role: opts.role ?? null,
    link: opts.link ?? null,
  });
}
