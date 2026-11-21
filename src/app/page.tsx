import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ROLE_HOME } from "@/lib/roles";
import type { user_role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/login");
  redirect(ROLE_HOME[profile.role as user_role] ?? "/login");
}
