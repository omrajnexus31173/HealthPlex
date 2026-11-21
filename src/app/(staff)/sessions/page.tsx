"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarDays, Check, Plus, Users, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { apiFetch, useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, EmptyState, SectionTitle, Tabs } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, fmtTime, todayInTz } from "@/lib/format";

type Session = {
  id: string;
  title: string;
  description: string | null;
  trainer_id: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  location: string | null;
  status: "scheduled" | "cancelled" | "completed";
  booking_enabled: boolean;
  trainers: { profiles: { full_name: string } | { full_name: string }[] | null } | null;
};

type Booking = { id: string; session_id: string; student_id: string; status: string; profiles: { full_name: string } | { full_name: string }[] | null; students: { enrollment_id: string } | { enrollment_id: string }[] | null };

const emptyForm = { title: "", description: "", trainer_id: "", session_date: todayInTz(), start_time: "07:00", end_time: "08:00", capacity: 20, location: "Main Gym Floor" };

function SessionsInner() {
  const { profile, settings } = useAuth();
  const canManage = profile?.role === "super_admin" || profile?.role === "gym_admin" || profile?.role === "trainer";
  const [tab, setTab] = useState<"upcoming" | "past" | "all">("upcoming");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [trainers, setTrainers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [marked, setMarked] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();
      const [s, b, t] = await Promise.all([
        supabase
          .from("training_sessions")
          .select("*, trainers:trainers(profiles:profiles(full_name))")
          .order("session_date", { ascending: false })
          .order("start_time")
          .limit(200),
        supabase.from("session_bookings").select("id, session_id, student_id, status, profiles:profiles(full_name), students:students(enrollment_id)"),
        supabase.from("trainers").select("id, profiles:profiles(full_name)"),
      ]);
      if (s.error) throw s.error;
      setSessions((s.data as unknown as Session[]) ?? []);
      setBookings((b.data as unknown as Booking[]) ?? []);
      setTrainers(
        ((t.data as unknown as { id: string; profiles: { full_name: string } | { full_name: string }[] }[]) ?? []).map((x) => ({
          id: x.id,
          name: (Array.isArray(x.profiles) ? x.profiles[0] : x.profiles)?.full_name ?? "Trainer",
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = todayInTz();
  const filtered = useMemo(() => {
    if (tab === "upcoming") return sessions.filter((s) => s.session_date >= today && s.status === "scheduled");
    if (tab === "past") return sessions.filter((s) => s.session_date < today || s.status !== "scheduled");
    return sessions;
  }, [sessions, tab, today]);

  const trainerName = (s: Session) => {
    const tr = s.trainers;
    const p = tr ? (Array.isArray(tr.profiles) ? tr.profiles[0] : tr.profiles) : null;
    return p?.full_name ?? trainers.find((t) => t.id === s.trainer_id)?.name ?? "Unassigned";
  };

  const bookedCount = (id: string) => bookings.filter((b) => b.session_id === id && b.status === "booked").length;

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/admin/sessions", {
        method: "POST",
        body: JSON.stringify({ ...form, capacity: Number(form.capacity), trainer_id: form.trainer_id || null }),
      });
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the session");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (s: Session) => {
    if (!window.confirm(`Cancel "${s.title}"? Booked students will see the session as cancelled.`)) return;
    try {
      await apiFetch("/api/admin/sessions", { method: "PATCH", body: JSON.stringify({ id: s.id, action: "cancel" }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the session");
    }
  };

  const markAttendance = async (sessionId: string, studentId: string) => {
    try {
      await apiFetch("/api/admin/sessions", { method: "PUT", body: JSON.stringify({ session_id: sessionId, student_id: studentId, status: "present" }) });
      setMarked((m) => ({ ...m, [`${sessionId}:${studentId}`]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark session attendance");
    }
  };

  return (
    <Shell
      title="Sessions & schedule"
      subtitle={`${trainers.length} trainers · booking ${settings?.booking_enabled ? "enabled" : "disabled"} · gym hours ${Object.entries(settings?.opening_hours ?? {}).slice(0, 1).map(([, v]) => v).join("")}`}
      actions={canManage ? <Button onClick={() => setShowForm((v) => !v)}><Plus size={14} /> New session</Button> : null}
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}

      {showForm && canManage ? (
        <Card className="mb-4 p-4">
          <SectionTitle title="Schedule a training session" subtitle="No fees, no memberships — sessions are open university training blocks" action={<button onClick={() => setShowForm(false)} className="text-ink-400 hover:text-white"><X size={15} /></button>} />
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className="hp-label">Title *</label><input className="hp-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Morning strength circuit" /></div>
            <div><label className="hp-label">Date *</label><input type="date" className="hp-input" value={form.session_date} onChange={(e) => setForm({ ...form, session_date: e.target.value })} /></div>
            <div><label className="hp-label">Trainer</label>
              <select className="hp-input" value={form.trainer_id} onChange={(e) => setForm({ ...form, trainer_id: e.target.value })}>
                <option value="">Unassigned</option>
                {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div><label className="hp-label">Start</label><input type="time" className="hp-input" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div><label className="hp-label">End</label><input type="time" className="hp-input" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
            <div><label className="hp-label">Capacity</label><input type="number" min={1} max={200} className="hp-input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></div>
            <div className="sm:col-span-2"><label className="hp-label">Description</label><input className="hp-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div><label className="hp-label">Location</label><input className="hp-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void create()} loading={saving} disabled={!form.title || form.start_time >= form.end_time}>Create session</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <Tabs
        tabs={[
          { id: "upcoming" as const, label: "Upcoming", count: sessions.filter((s) => s.session_date >= today && s.status === "scheduled").length },
          { id: "past" as const, label: "Past & cancelled", count: sessions.filter((s) => s.session_date < today || s.status !== "scheduled").length },
          { id: "all" as const, label: "All", count: sessions.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="hp-skeleton h-24" />)
          ) : filtered.length === 0 ? (
            <Card className="p-4">
              <EmptyState
                title={tab === "upcoming" ? "No upcoming sessions" : "No sessions to show"}
                description={canManage ? "Create a training session to open bookings for students." : "Your trainers haven't scheduled sessions yet."}
                icon={<CalendarClock size={22} />}
                action={canManage ? <Button onClick={() => setShowForm(true)}><Plus size={14} /> New session</Button> : null}
              />
            </Card>
          ) : (
            filtered.map((s) => {
              const booked = bookedCount(s.id);
              const pct = Math.round((booked / Math.max(s.capacity, 1)) * 100);
              const sessionBookings = bookings.filter((b) => b.session_id === s.id && b.status === "booked");
              return (
                <Card key={s.id} className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-mint-500/10 text-mint-300">
                      <span className="text-[9px] uppercase leading-none">{new Date(`${s.session_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { month: "short" })}</span>
                      <span className="text-[15px] font-bold leading-none">{new Date(`${s.session_date}T00:00:00+05:30`).getDate()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13.5px] font-semibold text-white">{s.title}</p>
                        <Chip tone={s.status === "scheduled" ? "green" : s.status === "cancelled" ? "red" : "gray"}>{s.status}</Chip>
                        {s.booking_enabled ? <Chip tone="blue">booking open</Chip> : <Chip tone="gray">walk-in</Chip>}
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-ink-400">
                        {fmtDate(s.session_date)} · {fmtTime(s.start_time)}–{fmtTime(s.end_time)} · {s.location ?? "Main Gym"} · {trainerName(s)}
                      </p>
                      {s.description ? <p className="mt-1 text-[11px] text-ink-400/80">{s.description}</p> : null}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/8">
                          <div className="h-full rounded-full bg-mint-500" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <span className="text-[10.5px] text-ink-400">{booked}/{s.capacity} booked</span>
                      </div>
                      {sessionBookings.length ? (
                        <div className="mt-2 space-y-1">
                          {sessionBookings.slice(0, 6).map((b) => {
                            const nm = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles)?.full_name ?? "Student";
                            const enr = (Array.isArray(b.students) ? b.students[0] : b.students)?.enrollment_id ?? "";
                            const done = marked[`${s.id}:${b.student_id}`];
                            return (
                              <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-navy-950/40 px-2 py-1">
                                <span className="truncate text-[11px] text-white">{nm} <span className="font-mono text-[10px] text-ink-400">{enr}</span></span>
                                {canManage ? (
                                  <button
                                    onClick={() => void markAttendance(s.id, b.student_id)}
                                    className={`rounded px-1.5 py-0.5 text-[10px] ${done ? "text-mint-300" : "text-ink-400 hover:text-mint-300"}`}
                                  >
                                    {done ? <Check size={11} /> : "mark present"}
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    {canManage && s.status === "scheduled" ? (
                      <button onClick={() => void cancel(s)} className="shrink-0 rounded-lg px-2 py-1 text-[10.5px] text-ink-400 hover:bg-[#ff5e47]/10 hover:text-[#ffb2a1]">
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <div className="space-y-3">
          <Card className="p-4">
            <SectionTitle title="Gym operating hours" subtitle="Set in gym settings" />
            <div className="space-y-1.5">
              {Object.entries(settings?.opening_hours ?? {}).map(([day, hours]) => (
                <div key={day} className="flex items-center justify-between rounded-lg border border-white/5 bg-navy-950/40 px-2.5 py-1.5">
                  <span className="text-[11.5px] capitalize text-ink-400">{day}</span>
                  <span className={`text-[11.5px] font-medium ${hours === "closed" ? "text-[#ffb2a1]" : "text-white"}`}>{hours === "closed" ? "Closed" : hours.replace("-", " – ")}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <SectionTitle title="Session calendar" subtitle="Next 7 days" />
            {filtered.filter((s) => s.session_date >= today && s.session_date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).length === 0 ? (
              <p className="text-[11.5px] text-ink-400">No sessions in the next week.</p>
            ) : (
              <div className="space-y-1.5">
                {Array.from({ length: 7 }).map((_, i) => {
                  const day = new Date(Date.now() + i * 864e5).toISOString().slice(0, 10);
                  const list = filtered.filter((s) => s.session_date === day);
                  return (
                    <div key={day} className="flex gap-2">
                      <span className="w-16 shrink-0 text-[10.5px] text-ink-400">{fmtDate(day).slice(0, 6)}</span>
                      <div className="min-w-0 flex-1">
                        {list.length === 0 ? (
                          <span className="text-[10.5px] text-ink-400/50">—</span>
                        ) : (
                          list.map((s) => (
                            <p key={s.id} className="truncate text-[10.5px] text-mint-300">{fmtTime(s.start_time)} {s.title}</p>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-400">
              <CalendarDays size={11} /> {sessions.filter((s) => s.session_date >= today && s.status === "scheduled").length} scheduled ahead
            </p>
          </Card>
          <Card className="p-4">
            <SectionTitle title="Booking rules" subtitle="Student self-service" />
            <ul className="space-y-1 text-[11px] text-ink-400">
              <li className="flex items-start gap-1.5"><Users size={11} className="mt-0.5 shrink-0 text-mint-300" /> Students book from their dashboard up to the session capacity.</li>
              <li className="flex items-start gap-1.5"><Check size={11} className="mt-0.5 shrink-0 text-mint-300" /> Cancelling a booking frees the seat immediately.</li>
              <li className="flex items-start gap-1.5"><X size={11} className="mt-0.5 shrink-0 text-mint-300" /> No membership or subscription is required — sessions are free university activities.</li>
            </ul>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

export default function SessionsPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin", "gym_staff", "trainer"]}>
      <SessionsInner />
    </StaffGuard>
  );
}
