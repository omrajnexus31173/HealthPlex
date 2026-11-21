"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GymSettings, Profile } from "@/lib/types";

type AuthState = {
  profile: Profile | null;
  settings: GymSettings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  supabase: ReturnType<typeof createClient>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (mounted.current) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const [{ data: prof, error: profErr }, { data: cfg }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("gym_settings").select("*").eq("id", true).maybeSingle(),
      ]);
      if (profErr) throw profErr;
      if (mounted.current) {
        setProfile((prof as Profile) ?? null);
        setSettings((cfg as GymSettings) ?? null);
        if (!prof) setError("Your account is not provisioned for HEALTHPLEX. Contact the gym administrator.");
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Failed to load session");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setSettings(null);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void load();
      }
    });
    return () => {
      mounted.current = false;
      sub.subscription.unsubscribe();
    };
  }, [load, supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ profile, settings, loading, error, refresh: load, signOut, supabase }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Thin wrapper for authenticated server API calls. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
  return payload as T;
}
