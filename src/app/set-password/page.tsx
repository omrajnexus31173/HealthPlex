"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card } from "@/components/ui";
import { ROLE_HOME } from "@/lib/roles";

function SetPasswordInner() {
  const { profile, loading, supabase } = useAuth();
  const router = useRouter();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !profile) router.replace("/login");
  }, [loading, profile, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError("Password must be at least 8 characters");
    if (next !== confirm) return setError("Passwords do not match");
    setSaving(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: next });
      if (err) throw err;
      await supabase.rpc("clear_password_change_flag");
      router.replace(profile ? ROLE_HOME[profile.role] : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-500/12 text-mint-300"><KeyRound size={18} /></span>
          <div>
            <h1 className="text-base font-semibold text-white">Set a new password</h1>
            <p className="text-[11.5px] text-ink-400">HEALTHPLEX requires a personal password before first use.</p>
          </div>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-2.5">
          <div><label className="hp-label">New password</label><input type="password" className="hp-input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required /></div>
          <div><label className="hp-label">Confirm password</label><input type="password" className="hp-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></div>
          {error ? <Alert tone="danger" title="Could not update">{error}</Alert> : null}
          <Button type="submit" loading={saving} className="w-full">Save password</Button>
        </form>
        <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-ink-400"><ShieldCheck size={11} /> Minimum 8 characters. Use a password you do not reuse elsewhere.</p>
      </Card>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <AuthProvider>
      <SetPasswordInner />
    </AuthProvider>
  );
}
