"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Activity, Eye, EyeOff, LockKeyhole, Mail, ScanFace, ShieldCheck, Sparkles } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Alert, Button } from "@/components/ui";
import { ROLE_HOME } from "@/lib/roles";
import type { user_role } from "@/lib/types";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.user) return;
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", data.session.user.id).maybeSingle();
      if (prof) router.replace(next || ROLE_HOME[(prof.role as user_role) ?? "student"]);
    });
    if (params.get("reason") === "reset") setNotice("Your password was updated. Sign in with your new password.");
  }, [configured, next, router, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) throw new Error(authError.message);
      const { data: prof } = await supabase.from("profiles").select("role, status").eq("id", data.user.id).maybeSingle();
      if (!prof) throw new Error("This account is not provisioned for HEALTHPLEX. Contact the gym administrator.");
      if (prof.status !== "active") throw new Error("This account is not active. Contact the gym administrator.");
      await supabase.rpc("touch_login");
      router.replace(next || ROLE_HOME[prof.role as user_role]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[420px] w-[420px] rounded-full bg-mint-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-52 -right-32 h-[480px] w-[480px] rounded-full bg-sky-600/10 blur-[130px]" />

      <div className="relative grid w-full max-w-[980px] overflow-hidden rounded-3xl border border-white/8 bg-navy-900/70 shadow-2xl backdrop-blur-xl md:grid-cols-[1.05fr_1fr]">
        <div className="relative hidden flex-col justify-between border-r border-white/6 bg-gradient-to-br from-navy-850 to-navy-950 p-9 md:flex">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-mint-400 to-mint-600 text-navy-950 shadow-lg shadow-mint-600/25">
                <Activity size={21} strokeWidth={2.7} />
              </span>
              <div>
                <p className="text-lg font-bold leading-none tracking-tight text-white">HEALTHPLEX</p>
                <p className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-400">GSFC University</p>
              </div>
            </div>
            <h1 className="mt-10 text-[26px] font-semibold leading-tight tracking-tight text-white">
              Smart University
              <br />
              <span className="bg-gradient-to-r from-mint-300 to-mint-500 bg-clip-text text-transparent">Gym Management</span>
            </h1>
            <p className="mt-3 max-w-[300px] text-[13px] leading-relaxed text-ink-400">
              Face-recognition attendance, live capacity monitoring and campus-wide fitness analytics — built for GSFC
              University.
            </p>
          </div>
          <div className="space-y-2.5">
            {[
              { icon: <ScanFace size={15} />, text: "Touchless attendance at the gym entrance" },
              { icon: <ShieldCheck size={15} />, text: "Consent-based, encrypted biometric templates" },
              { icon: <Sparkles size={15} />, text: "Live occupancy, peak-hour and department analytics" },
            ].map((f) => (
              <div key={f.text} className="flex items-center gap-2.5 text-[12px] text-ink-400">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-mint-500/10 text-mint-300">{f.icon}</span>
                {f.text}
              </div>
            ))}
            <p className="pt-3 text-[10.5px] text-ink-400/60">No memberships. No payments. Only campus fitness.</p>
          </div>
        </div>

        <div className="p-7 md:p-9">
          <div className="mb-6 md:hidden">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-mint-400 to-mint-600 text-navy-950">
                <Activity size={18} strokeWidth={2.7} />
              </span>
              <div>
                <p className="text-base font-bold leading-none text-white">HEALTHPLEX</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-ink-400">GSFC University</p>
              </div>
            </div>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-white">Sign in</h2>
          <p className="mt-1 text-xs text-ink-400">Use the credentials issued by your gym administrator.</p>

          {!configured ? (
            <div className="mt-5">
              <Alert tone="warning" title="Supabase environment is missing">
                Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect this deployment to the HEALTHPLEX
                database.
              </Alert>
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-5 space-y-3.5">
            <div>
              <label className="hp-label" htmlFor="email">
                University email
              </label>
              <div className="relative">
                <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="hp-input pl-9"
                  placeholder="name@gsfcuniversity.ac.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="hp-label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <LockKeyhole size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  className="hp-input pl-9 pr-9"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-white"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error ? <Alert tone="danger" title="Sign in failed">{error}</Alert> : null}
            {notice ? <Alert tone="success" title={notice} /> : null}

            <Button type="submit" loading={loading} className="w-full" disabled={!configured}>
              Sign in to HEALTHPLEX
            </Button>
          </form>

          <div className="mt-5 rounded-xl border border-white/6 bg-white/2 px-3.5 py-3">
            <p className="text-[11px] leading-relaxed text-ink-400">
              <span className="font-semibold text-white">Students:</span> attendance is captured automatically at the gym
              kiosk — no app login required. Accounts are created by the gym office only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-ink-400">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
