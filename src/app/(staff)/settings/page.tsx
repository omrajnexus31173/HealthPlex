"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Gauge, Plus, Save, ScanFace, ShieldCheck, Timer, Trash2, Users } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, SectionTitle, Skeleton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { GymSettings } from "@/lib/types";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type Holiday = { holiday_date: string; name: string };

/** numeric(4,3) keeps at most 3 decimals; more precision is meaningless there. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const TIME_RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

type CleanSettings = {
  gym_name: string;
  capacity: number;
  cooldown_minutes: number;
  entry_exit_enabled: boolean;
  recognition_threshold: number;
  recognition_margin: number;
  liveness_threshold: number;
  booking_enabled: boolean;
  capacity_alerts: boolean;
  opening_hours: Record<string, string>;
};

/**
 * Whitelist + validate exactly the columns the Settings save is allowed to write.
 * Throws an Error with a human-readable message for the first invalid field;
 * the caller aborts before any request is sent, so Postgres can never answer 400.
 */
function validateSettings(s: GymSettings): CleanSettings {
  const gym_name = (s.gym_name ?? "").trim();
  if (gym_name.length < 2) throw new Error("Gym name must be at least 2 characters.");
  if (gym_name.length > 120) throw new Error("Gym name must be 120 characters or fewer.");

  const capacity = Number(s.capacity);
  if (!Number.isFinite(capacity) || !Number.isInteger(capacity)) throw new Error("Capacity must be a whole number.");
  if (capacity < 1) throw new Error("Capacity must be at least 1 (the database rejects 0).");
  if (capacity > 2147483647) throw new Error("Capacity is too large.");

  const cooldown_minutes = Number(s.cooldown_minutes);
  if (!Number.isFinite(cooldown_minutes) || !Number.isInteger(cooldown_minutes)) throw new Error("Scan cooldown must be a whole number of minutes.");
  if (cooldown_minutes < 0 || cooldown_minutes > 240) throw new Error("Scan cooldown must be between 0 and 240 minutes.");

  const threshold = (label: string, v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${label} must be a number between 0 and 1.`);
    return round3(n);
  };
  const recognition_threshold = threshold("Match confidence threshold", s.recognition_threshold);
  const recognition_margin = threshold("Second-best margin", s.recognition_margin);
  const liveness_threshold = threshold("Liveness threshold", s.liveness_threshold);

  // Opening hours drive the attendance operating calendar: the value must be
  // "HH:MM-HH:MM" or "closed"/"off" (normalised to lowercase) or the calendar SQL
  // silently treats the day as open. Reject anything else before saving.
  const DAYS_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const src = s.opening_hours ?? {};
  const opening_hours: Record<string, string> = {};
  for (const d of DAYS_ORDER) {
    const raw = String(src[d] ?? "closed").trim().toLowerCase();
    if (raw === "closed" || raw === "off") {
      opening_hours[d] = raw === "off" ? "closed" : raw;
      continue;
    }
    if (!TIME_RANGE.test(raw)) {
      throw new Error(`Opening hours for ${d.toUpperCase()} must look like "06:00-21:00" or "closed" (got "${String(src[d] ?? "")}").`);
    }
    const [start, end] = raw.split("-");
    if (start >= end) throw new Error(`Opening hours for ${d.toUpperCase()} must end after they start (got "${raw}").`);
    opening_hours[d] = raw;
  }

  return {
    gym_name,
    capacity,
    cooldown_minutes,
    entry_exit_enabled: Boolean(s.entry_exit_enabled),
    recognition_threshold,
    recognition_margin,
    liveness_threshold,
    booking_enabled: Boolean(s.booking_enabled),
    capacity_alerts: Boolean(s.capacity_alerts),
    opening_hours,
  };
}

type SupabaseErrorLike = { message?: string; code?: string; details?: string | null; hint?: string | null } | null;

/** Turn a PostgREST error into one actionable line instead of a bare "Bad Request" (HTTP 400). */
function postgrestError(err: SupabaseErrorLike): Error {
  if (!err) return new Error("Could not save settings (unknown server error).");
  const parts = [err.message ?? "Could not save settings"];
  if (err.code) parts.push(`[${err.code}]`);
  if (err.details) parts.push(`— ${err.details}`);
  if (err.hint) parts.push(`(hint: ${err.hint})`);
  return new Error(parts.join(" "));
}

function SettingsInner() {
  const { profile, refresh } = useAuth();
  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [holidayBusy, setHolidayBusy] = useState(false);
  const [minPresence, setMinPresence] = useState("30");
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [presenceSaved, setPresenceSaved] = useState(false);
  const isSuperAdmin = profile?.role === "super_admin";

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase.from("gym_settings").select("*").eq("id", true).maybeSingle();
    if (err) setError(err.message);
    const loaded = data as GymSettings;
    setSettings(loaded);
    if (loaded?.min_presence_minutes != null) setMinPresence(String(loaded.min_presence_minutes));
    const h = await supabase.from("gym_holidays").select("holiday_date,name").order("holiday_date", { ascending: false }).limit(60);
    setHolidays((h.data as Holiday[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // gym_settings.id is a boolean primary key with CHECK (id) — the singleton row is always id = true.
  // The update must target that same boolean key; never send id/updated_at/retention columns
  // (retention + min-presence go through admin RPCs which enforce is_super_admin()).
  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // ── Validate everything BEFORE touching the network so a bad value can never
      // ── reach PostgREST as a 400 (check-constraint / cast failures).
      const cleaned = validateSettings(settings);
      const supabase = createClient();
      // Only writable columns, correct types, numerics rounded to the live numeric(4,3) scale.
      const { error: err } = await supabase
        .from("gym_settings")
        .update({
          gym_name: cleaned.gym_name,
          capacity: cleaned.capacity,
          cooldown_minutes: cleaned.cooldown_minutes,
          entry_exit_enabled: cleaned.entry_exit_enabled,
          recognition_threshold: cleaned.recognition_threshold,
          recognition_margin: cleaned.recognition_margin,
          liveness_threshold: cleaned.liveness_threshold,
          booking_enabled: cleaned.booking_enabled,
          capacity_alerts: cleaned.capacity_alerts,
          opening_hours: cleaned.opening_hours,
        })
        .eq("id", true);
      if (err) throw postgrestError(err);
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

  const saveMinPresence = async () => {
    if (!isSuperAdmin) return;
    const minutes = Number(minPresence);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
      setError("Minimum presence must be between 1 and 600 minutes.");
      return;
    }
    setPresenceBusy(true);
    setError(null);
    setPresenceSaved(false);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("set_min_presence_minutes", { p_minutes: minutes });
      if (err) throw new Error(err.message);
      setPresenceSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the minimum presence threshold");
    } finally {
      setPresenceBusy(false);
    }
  };

  const addHoliday = async () => {
    if (!holidayDate || holidayName.trim().length < 2) {
      setError("Pick a date and a holiday name (2+ characters).");
      return;
    }
    setHolidayBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("set_gym_holiday", { p_date: holidayDate, p_name: holidayName.trim() });
      if (err) throw new Error(err.message);
      setHolidayDate("");
      setHolidayName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the holiday");
    } finally {
      setHolidayBusy(false);
    }
  };

  const removeHoliday = async (date: string) => {
    setHolidayBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("remove_gym_holiday", { p_date: date });
      if (err) throw new Error(err.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the holiday");
    } finally {
      setHolidayBusy(false);
    }
  };

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
            <p className="mt-2 text-[10.5px] text-ink-400">Operating days drive attendance eligibility: a day set to <b className="text-white">closed</b> is excluded from eligible operating days (and absences) until reopened.</p>
          </Card>

          <Card className="p-4 xl:col-span-2">
            <SectionTitle title="Attendance & eligibility" subtitle="Minimum verified time for PRESENT, and official holidays excluded from the gym calendar" />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3">
                <label className="hp-label flex items-center gap-1.5"><Timer size={11} /> Minimum verified gym time per day</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={600}
                    className="hp-input w-28"
                    value={minPresence}
                    onChange={(e) => setMinPresence(e.target.value)}
                    disabled={!isSuperAdmin || presenceBusy}
                  />
                  <span className="text-[12px] text-ink-400">minutes (default 30)</span>
                  {isSuperAdmin ? (
                    <Button onClick={() => void saveMinPresence()} loading={presenceBusy} variant="ghost"><Save size={13} /> Apply</Button>
                  ) : null}
                </div>
                <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">
                  Verified entry→exit minutes are summed per day. <b className="text-white">≥ this value = present</b> (exactly at the threshold counts); below it = absent; an unresolved open visit = INCOMPLETE, never present/absent. Multiple visits combine; repeated face scans do not.
                </p>
                {isSuperAdmin ? (
                  <p className="mt-1.5 text-[10px] text-ink-400/80">Super Admin only. Changing it re-classifies the current month immediately and is written to the audit log.</p>
                ) : (
                  <p className="mt-1.5 text-[10px] text-warn-400">Only the Super Admin can change this threshold. Current value: {settings.min_presence_minutes} min.</p>
                )}
                {presenceSaved ? <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-mint-300"><Check size={12} /> Threshold updated and audited.</p> : null}
              </div>

              <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3">
                <label className="hp-label">Holidays & closures</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" className="hp-input w-36" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} disabled={holidayBusy} />
                  <input
                    className="hp-input min-w-0 flex-1"
                    placeholder="Holiday name (e.g. Diwali)"
                    value={holidayName}
                    onChange={(e) => setHolidayName(e.target.value)}
                    disabled={holidayBusy}
                  />
                  <Button variant="ghost" onClick={() => void addHoliday()} loading={holidayBusy}><Plus size={13} /> Add</Button>
                </div>
                <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">Holidays are removed from eligible operating days — no student is marked absent on a holiday. Removing a holiday reinstates it (and re-marks that day where detailed records still exist).</p>
                <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
                  {holidays.length === 0 ? (
                    <li className="text-[11px] text-ink-400">No holidays recorded.</li>
                  ) : (
                    holidays.map((h) => (
                      <li key={h.holiday_date} className="flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-navy-950/60 px-2.5 py-1.5 text-[11.5px]">
                        <span className="text-white">{fmtDate(h.holiday_date)} · <span className="text-ink-400">{h.name}</span></span>
                        <button onClick={() => void removeHoliday(h.holiday_date)} disabled={holidayBusy} className="text-ink-400 transition-colors hover:text-[#ff8f6b]" aria-label="Remove holiday">
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
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
