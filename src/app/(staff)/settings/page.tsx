"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Gauge, Save, ScanFace, ShieldCheck, Users } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, SectionTitle, Skeleton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import type { GymSettings } from "@/lib/types";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function SettingsInner() {
  const { profile, refresh } = useAuth();
  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase.from("gym_settings").select("*").eq("id", true).maybeSingle();
    if (err) setError(err.message);
    setSettings(data as GymSettings);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const supabase = createClient();
      const { error: err } = await supabase
        .from("gym_settings")
        .update({
          gym_name: settings.gym_name,
          capacity: Number(settings.capacity),
          cooldown_minutes: Number(settings.cooldown_minutes),
          entry_exit_enabled: settings.entry_exit_enabled,
          recognition_threshold: Number(settings.recognition_threshold),
          recognition_margin: Number(settings.recognition_margin),
          liveness_threshold: Number(settings.liveness_threshold),
          booking_enabled: settings.booking_enabled,
          capacity_alerts: settings.capacity_alerts,
          opening_hours: settings.opening_hours,
        })
        .eq("id", true);
      if (err) throw err;
      setSaved(true);
      await refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const confidence = settings ? Math.round((1 - Number(settings.recognition_threshold)) * 100) : 0;

  return (
    <Shell title="Gym settings" subtitle="Capacity, recognition gates and operating hours" actions={<Button onClick={() => void save()} loading={saving}><Save size={14} /> Save changes</Button>}>
      {error ? <div className="mb-4"><Alert tone="danger" title="Could not save">{error}</Alert></div> : null}
      {saved ? <div className="mb-4"><Alert tone="success" title="Settings saved">Kiosks pick up the new values on their next sync (within 5 minutes).</Alert></div> : null}

      {loading || !settings ? (
        <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="p-4">
            <SectionTitle title="Gym profile" subtitle="Displayed on the kiosk and reports" />
            <div className="space-y-2.5">
              <div><label className="hp-label">Gym name</label><input className="hp-input" value={settings.gym_name} onChange={(e) => setSettings({ ...settings, gym_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="hp-label">Capacity</label><input type="number" min={1} className="hp-input" value={settings.capacity} onChange={(e) => setSettings({ ...settings, capacity: Number(e.target.value) })} /></div>
                <div><label className="hp-label">Scan cooldown (min)</label><input type="number" min={0} max={240} className="hp-input" value={settings.cooldown_minutes} onChange={(e) => setSettings({ ...settings, cooldown_minutes: Number(e.target.value) })} /></div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/6 bg-navy-950/40 px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-medium text-white">Entry & exit tracking</p>
                  <p className="text-[10.5px] text-ink-400">A second scan records the exit and frees capacity</p>
                </div>
                <button onClick={() => setSettings({ ...settings, entry_exit_enabled: !settings.entry_exit_enabled })} className={`relative h-6 w-11 rounded-full transition-colors ${settings.entry_exit_enabled ? "bg-mint-500" : "bg-white/15"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${settings.entry_exit_enabled ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/6 bg-navy-950/40 px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-medium text-white">Capacity alerts</p>
                  <p className="text-[10.5px] text-ink-400">Notify gym staff when the gym is full</p>
                </div>
                <button onClick={() => setSettings({ ...settings, capacity_alerts: !settings.capacity_alerts })} className={`relative h-6 w-11 rounded-full transition-colors ${settings.capacity_alerts ? "bg-mint-500" : "bg-white/15"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${settings.capacity_alerts ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/6 bg-navy-950/40 px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-medium text-white">Student session booking</p>
                  <p className="text-[10.5px] text-ink-400">Allow students to reserve training sessions</p>
                </div>
                <button onClick={() => setSettings({ ...settings, booking_enabled: !settings.booking_enabled })} className={`relative h-6 w-11 rounded-full transition-colors ${settings.booking_enabled ? "bg-mint-500" : "bg-white/15"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${settings.booking_enabled ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle title="Face recognition gates" subtitle="Applied on the kiosk and re-validated on the server" />
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between"><label className="hp-label mb-0">Match confidence required</label><span className="text-[12px] font-semibold text-mint-300">{confidence}%</span></div>
                <input type="range" min={40} max={90} step={1} value={confidence} onChange={(e) => setSettings({ ...settings, recognition_threshold: 1 - Number(e.target.value) / 100 })} className="w-full accent-mint-500" />
                <p className="mt-0.5 text-[10px] text-ink-400">Higher is stricter. Tested separation: genuine ≈ 74%, impostor ≈ 24%.</p>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between"><label className="hp-label mb-0">Second-best margin</label><span className="text-[12px] font-semibold text-mint-300">{Math.round(Number(settings.recognition_margin) * 100)}%</span></div>
                <input type="range" min={2} max={20} step={1} value={Math.round(Number(settings.recognition_margin) * 100)} onChange={(e) => setSettings({ ...settings, recognition_margin: Number(e.target.value) / 100 })} className="w-full accent-mint-500" />
                <p className="mt-0.5 text-[10px] text-ink-400">Prevents guessing when two enrolled faces are close.</p>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between"><label className="hp-label mb-0">Liveness threshold</label><span className="text-[12px] font-semibold text-mint-300">{Math.round(Number(settings.liveness_threshold) * 100)}%</span></div>
                <input type="range" min={40} max={90} step={1} value={Math.round(Number(settings.liveness_threshold) * 100)} onChange={(e) => setSettings({ ...settings, liveness_threshold: Number(e.target.value) / 100 })} className="w-full accent-mint-500" />
                <p className="mt-0.5 text-[10px] text-ink-400">Challenge-response liveness (blink / head turn / smile). Not a certified ISO 30107-3 PAD.</p>
              </div>
              <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3 text-[10.5px] leading-relaxed text-ink-400">
                <p className="flex items-center gap-1.5 font-semibold text-white"><ShieldCheck size={12} className="text-mint-300" /> Enforced server-side</p>
                <p className="mt-0.5">The API rejects any scan below these thresholds even if a client is tampered with, and logs the attempt for review.</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 xl:col-span-2">
            <SectionTitle title="Opening hours" subtitle="Asia/Kolkata · use HH:MM-HH:MM or 'closed'" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {DAYS.map((d) => (
                <div key={d}>
                  <label className="hp-label capitalize">{d}</label>
                  <input
                    className="hp-input"
                    value={settings.opening_hours?.[d] ?? ""}
                    onChange={(e) => setSettings({ ...settings, opening_hours: { ...settings.opening_hours, [d]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[10.5px] text-ink-400">
              <span className="flex items-center gap-1"><Clock size={11} /> Timezone {settings.timezone}</span>
              <span className="flex items-center gap-1"><Users size={11} /> Capacity {settings.capacity}</span>
              <span className="flex items-center gap-1"><Gauge size={11} /> Cooldown {settings.cooldown_minutes} min</span>
              <span className="flex items-center gap-1"><ScanFace size={11} /> Threshold {confidence}%</span>
              <Chip tone="green"><Check size={10} /> saved {fmtDateTime(settings.updated_at)}</Chip>
            </div>
          </Card>
        </div>
      )}
      <p className="mt-4 text-center text-[10.5px] text-ink-400/70">Changes are written to Supabase immediately and audited. Acting as {profile?.full_name}.</p>
    </Shell>
  );
}

export default function SettingsPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin"]}>
      <SettingsInner />
    </StaffGuard>
  );
}
