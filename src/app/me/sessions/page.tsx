"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, Clock, MapPin, Users, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, EmptyState, SectionTitle, Tabs } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, fmtTime, todayInTz } from "@/lib/format";
import type { TrainingSession } from "@/lib/types";

type Booking = { id: string; session_id: string; status: string };

function StudentSessions() {
  const { profile, settings } = useAuth();
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "mine">("upcoming");

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const client = createClient();
    const [{ data: ses }, { data: mine }, { data: all }] = await Promise.all([
      client.from("training_sessions").select("*").gte("session_date", todayInTz()).eq("status", "scheduled").order("session_date").order("start_time"),
      client.from("session_bookings").select("id, session_id, status").eq("student_id", profile.id),
      client.from("session_bookings").select("session_id, status").eq("status", "booked"),
    ]);
    setSessions((ses as TrainingSession[]) ?? []);
    setBookings((mine as Booking[]) ?? []);
    const map: Record<string, number> = {};
    ((all as { session_id: string }[]) ?? []).forEach((b) => (map[b.session_id] = (map[b.session_id] ?? 0) + 1));
    setCounts(map);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeBooking = (id: string) => bookings.find((b) => b.session_id === id && b.status === "booked");

  const book = async (s: TrainingSession) => {
    if (!profile) return;
    setBusy(s.id);
    setError(null);
    setNotice(null);
    try {
      if ((counts[s.id] ?? 0) >= s.capacity) throw new Error("This session is full");
      const client = createClient();
      const existing = bookings.find((b) => b.session_id === s.id);
      if (existing) {
        const { error: err } = await client.from("session_bookings").update({ status: "booked", cancelled_at: null }).eq("id", existing.id);
        if (err) throw err;
      } else {
        const { error: err } = await client.from("session_bookings").insert({ session_id: s.id, student_id: profile.id });
        if (err) throw err;
      }
      setNotice(`You're booked for ${s.title} on ${fmtDate(s.session_date)}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not book this session");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (s: TrainingSession) => {
    const b = activeBooking(s.id);
    if (!b) return;
    setBusy(s.id);
    try {
      const client = createClient();
      const { error: err } = await client.from("session_bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", b.id);
      if (err) throw err;
      setNotice(`Booking cancelled for ${s.title}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the booking");
    } finally {
      setBusy(null);
    }
  };

  const mySessions = useMemo(() => sessions.filter((s) => bookings.some((b) => b.session_id === s.id && b.status === "booked")), [sessions, bookings]);
  const list = tab === "mine" ? mySessions : sessions;

  return (
    <Shell title="Training sessions" subtitle="Free university gym sessions — no membership or payment required">
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}
      {notice ? <div className="mb-4"><Alert tone="success" title="Done">{notice}</Alert></div> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          tabs={[
            { id: "upcoming" as const, label: "Upcoming", count: sessions.length },
            { id: "mine" as const, label: "My bookings", count: mySessions.length },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Chip tone={settings?.booking_enabled ? "green" : "gray"}>{settings?.booking_enabled ? "booking enabled" : "booking disabled"}</Chip>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="hp-skeleton h-32" />)
        ) : list.length === 0 ? (
          <div className="lg:col-span-2">
            <Card className="p-4">
              <EmptyState title={tab === "mine" ? "No bookings yet" : "No upcoming sessions"} description="Your trainers will publish new sessions on this calendar." icon={<CalendarClock size={22} />} />
            </Card>
          </div>
        ) : (
          list.map((s) => {
            const booked = counts[s.id] ?? 0;
            const mine = activeBooking(s.id);
            const full = booked >= s.capacity;
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-mint-500/10 text-mint-300">
                    <span className="text-[9px] uppercase leading-none">{new Date(`${s.session_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { month: "short" })}</span>
                    <span className="text-[15px] font-bold leading-none">{new Date(`${s.session_date}T00:00:00+05:30`).getDate()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-white">{s.title}</p>
                      {mine ? <Chip tone="green"><Check size={10} /> booked</Chip> : full ? <Chip tone="red">full</Chip> : <Chip tone="blue">open</Chip>}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-400">
                      <span className="flex items-center gap-1"><Clock size={10} /> {fmtTime(s.start_time)}–{fmtTime(s.end_time)}</span>
                      <span className="flex items-center gap-1"><MapPin size={10} /> {s.location ?? "Main Gym"}</span>
                      <span className="flex items-center gap-1"><Users size={10} /> {booked}/{s.capacity}</span>
                    </p>
                    {s.description ? <p className="mt-1 text-[11px] text-ink-400/80">{s.description}</p> : null}
                    <div className="mt-2">
                      {mine ? (
                        <Button variant="ghost" loading={busy === s.id} onClick={() => void cancel(s)}>
                          <X size={13} /> Cancel booking
                        </Button>
                      ) : (
                        <Button loading={busy === s.id} disabled={full || !settings?.booking_enabled || !s.booking_enabled} onClick={() => void book(s)}>
                          <Check size={13} /> {full ? "Session full" : "Book seat"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <div className="mt-4">
        <SectionTitle title="How sessions work" />
        <Card className="p-4 text-[11.5px] leading-relaxed text-ink-400">
          Sessions are university training blocks led by HEALTHPLEX trainers. Booking is free — there are no memberships,
          subscriptions or fees. Cancelling a booking immediately frees the seat for another student. Attendance at a session is
          marked by the trainer and does not replace your gym entry attendance.
        </Card>
      </div>
    </Shell>
  );
}

export default function StudentSessionsPage() {
  return (
    <StaffGuard roles={["student"]}>
      <StudentSessions />
    </StaffGuard>
  );
}
