import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon);
}

/** Browser client (anon key only — RLS enforced). */
export function createClient() {
  if (!url || !anon) throw new Error("Supabase is not configured");
  return createBrowserClient(url, anon);
}
