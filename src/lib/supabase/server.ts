import { createServerClient } from "@supabase/ssr";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function serverEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) throw new Error("Supabase environment is not configured");
  return { url, anon, service };
}

/** Request-scoped client that reads/writes the auth cookies (RLS enforced). */
export async function createServerSupabase() {
  const { url, anon } = serverEnv();
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component render — middleware refreshes cookies
        }
      },
    },
  });
}

/**
 * Service-role client. ONLY for server-side routes that must touch biometric
 * material (face templates) after authenticating the caller. Never import this
 * from a client component.
 */
export function createServiceSupabase() {
  const { url, service } = serverEnv();
  if (!service) throw new Error("Service role key is not configured on the server");
  return createBareClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
