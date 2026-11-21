"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { STAFF_ROLES } from "@/lib/roles";
import { Card } from "./ui";
import { ShieldAlert } from "lucide-react";

/** Client-side guard for staff-only surfaces (RBAC is enforced again in the database). */
export function StaffGuard({ children, roles }: { children: React.ReactNode; roles?: typeof STAFF_ROLES }) {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const allowed = roles ?? STAFF_ROLES;

  useEffect(() => {
    if (loading || !profile) return;
    if (!allowed.includes(profile.role)) {
      router.replace(profile.role === "student" ? "/me" : "/dashboard");
    }
  }, [loading, profile, router, allowed]);

  if (loading || !profile) return null;
  if (!allowed.includes(profile.role)) {
    return (
      <Card className="mx-auto mt-16 max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto text-warn-400" size={28} />
        <p className="mt-3 text-sm font-semibold text-white">Restricted area</p>
        <p className="mt-1 text-xs text-ink-400">Your role does not have access to this page.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
