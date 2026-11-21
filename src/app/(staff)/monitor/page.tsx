"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRightLeft, Clock, LogIn, LogOut, Radio, Users, Wifi } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Avatar, Card, CapacityBar, Chip, EmptyState, SectionTitle, Skeleton, StatCard } from "@/components/ui";
import { AreaChart } from "@/components/Charts";
import { createClient } from "@/lib/supabase/client";
import { durationLabel, fmtClock, fmtTime, timeAgo } from "@/lib/format";
import { photoUrl } from "@/lib/data";

type FeedRow = {
  id: string;
  student_id: string;
  full_name: string;
  enrollment_id: string;
  photo_path: string | null;
  check_in_at: string;
  check_out_at: string | null;
  department: string | null;
  entry_source: string;
};

type InsideRow = {
  id: string;
  student_id: string;
  check_in_at: string;
  duration_minutes: number | null;
  profiles: { full_name: string } | null;
  students: { enrollment_id: string; photo_path: string | null } | null;
};

function MonitorInner() {
  const { settings, supabase } = useAuth();
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [inside, setInside] = useState<InsideRow[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [hourly, setHourly] = useState<{ label: string; value: number }[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const load = useCallback(async () => {
    try {
      setError(null);
      const client = createClient();
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      const [feedRes, insideRes, todayRes, hourlyRes] = await Promise.all([
        client.rpc("live_feed", { p_limit: 25 }),
        client
          .from("attendance_records")
          .select("id, student_id, check_in_at, duration_minutes, profiles:profiles!attendance_records_student_id_fkey(full_name), students:students!attendance_records_student_id_fkey(enrollment_id, photo_path)")
          .is("check_out_at", null)
          .eq("status", "present")
          .order("check_in_at", { ascending: false }),
        client.from("attendance_records").select("id", { count: "exact", head: true }).eq("attendance_date", today),
        client.rpc("peak_hours", { p_days: 1 }),
      ]);
      if (feedRes.error) throw feedRes.error;
      setFeed((feedRes.data as FeedRow[]) ?? []);
      setInside((insideRes.data as unknown as InsideRow[]) ?? []);
      setTodayCount(todayRes.count ?? 0);
      const peak = ((hourlyRes.data as { hour: number; visits: number }[]) ?? []).map((p) => ({
        label: `${String(p.hour).padStart(2, "0")}:00`,
        value: Number(p.visits),
      }));
      setHourly(peak);
      const urls = await Promise.all(
        ((insideRes.data as unknown as InsideRow[]) ?? []).slice(0, 30).map(async (r) => [r.student_id, await photoUrl(r.students?.photo_path)] as const),
      );
      setPhotos(Object.fromEntries(urls.filter((e): e is readonly [string, string] => Boolean(e[1]))));
      setLastUpdate(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load live monitor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = setInterval(() => setClock(new Date()), 1000);
    const poll = setInterval(() => void load(), 12000);
    const channel = supabase
      .channel("monitor-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, () => void load())
      .subscribe();
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [load, supabase]);

  const capacity = settings?.capacity ?? 80;
  const occupancy = inside.length;
  const pct = Math.round((occupancy / Math.max(capacity, 1)) * 100);
  const recentExits = useMemo(() => feed.filter((f) => f.check_out_at).slice(0, 6), [feed]);

  return (
    <Shell
      title="Live gym monitor"
      subtitle={`Real-time occupancy and entry/exit activity · updated ${timeAgo(lastUpdate.toISOString())}`}
      actions={
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-2.5 py-1.5">
          <span className="hp-live-dot" />
          <span className="text-[11px] font-semibold text-mint-300">LIVE</span>
          <span className="hidden font-mono text-[11px] text-ink-400 sm:inline">{fmtClock(clock)}</span>
        </div>
      }
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Live data unavailable">{error}</Alert></div> : null}
      {pct >= 95 ? (
        <div className="mb-4">
          <Alert tone="warning" title="Gym is at capacity">
            {occupancy} of {capacity} spaces are in use. Pause new entries or direct students to the waiting area.
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Currently inside" value={occupancy} hint={`${Math.max(0, capacity - occupancy)} spaces available`} tone={pct >= 95 ? "danger" : pct >= 75 ? "warn" : "mint"} icon={<Activity size={16} />} loading={loading} />
        <StatCard label="Today's visitors" value={todayCount} hint="Check-ins recorded today (IST)" icon={<Users size={16} />} loading={loading} />
        <StatCard label="Gym capacity" value={capacity} hint="Configured in gym settings" icon={<Wifi size={16} />} loading={loading} />
        <StatCard label="Occupancy" value={`${pct}%`} hint={pct >= 95 ? "At capacity" : "Within safe limits"} tone={pct >= 95 ? "danger" : "mint"} loading={loading} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <Card className="p-4">
          <SectionTitle title="Occupancy" subtitle="Derived from valid entry/exit events only — duplicate scans never counted" />
          <CapacityBar inside={occupancy} capacity={capacity} />
          <div className="mt-4 space-y-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Inside the gym now</p>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11" />)
            ) : inside.length === 0 ? (
              <EmptyState title="Gym is empty" description="Nobody currently checked in." icon={<Users size={18} />} />
            ) : (
              <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
                {inside.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-navy-950/40 px-2.5 py-1.5">
                    <Avatar name={r.profiles?.full_name ?? "?"} url={photos[r.student_id]} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-white">{r.profiles?.full_name}</p>
                      <p className="truncate font-mono text-[10px] text-ink-400">{r.students?.enrollment_id}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10.5px] text-mint-300">in {fmtTime(r.check_in_at)}</p>
                      <p className="text-[10px] text-ink-400">{timeAgo(r.check_in_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle
            title="Live activity feed"
            subtitle="Every entry and exit as it happens"
            action={<Link href="/attendance" className="text-[11px] font-semibold text-mint-300 hover:underline">All records →</Link>}
          />
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="mb-2 h-12" />)
          ) : feed.length === 0 ? (
            <EmptyState title="No activity yet" description="Scans at the kiosk appear here instantly." icon={<Radio size={18} />} />
          ) : (
            <div className="max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
              {feed.map((f) => (
                <div key={f.id} className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-navy-950/40 px-2.5 py-2">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${f.check_out_at ? "bg-sky-400/12 text-sky-300" : "bg-mint-500/12 text-mint-300"}`}>
                    {f.check_out_at ? <LogOut size={13} /> : <LogIn size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-white">{f.full_name}</p>
                    <p className="truncate text-[10px] text-ink-400">
                      {f.enrollment_id} · {f.department ?? "—"} · {f.entry_source === "face" ? "face scan" : f.entry_source}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-[10.5px] ${f.check_out_at ? "text-sky-300" : "text-mint-300"}`}>
                      {f.check_out_at ? `out ${fmtTime(f.check_out_at)}` : `in ${fmtTime(f.check_in_at)}`}
                    </p>
                    <p className="text-[10px] text-ink-400">{timeAgo(f.check_out_at ?? f.check_in_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="p-4">
          <SectionTitle title="Today's traffic by hour" subtitle="Check-in distribution (Asia/Kolkata)" />
          {loading ? <Skeleton className="h-[180px]" /> : hourly.length === 0 ? (
            <EmptyState title="No check-ins yet today" description="Hourly distribution appears as students arrive." icon={<Clock size={18} />} />
          ) : (
            <AreaChart data={hourly} formatX={(v) => v} label="Today's hourly attendance" />
          )}
        </Card>
        <Card className="p-4">
          <SectionTitle title="Recent exits" subtitle="Students who checked out today" />
          {recentExits.length === 0 ? (
            <EmptyState title="No exits recorded yet" description="Exits are captured when a student scans again at the kiosk." icon={<ArrowRightLeft size={18} />} />
          ) : (
            <div className="space-y-1.5">
              {recentExits.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-navy-950/40 px-2.5 py-1.5">
                  <span className="truncate text-[11.5px] text-white">{f.full_name}</span>
                  <span className="shrink-0 text-[10.5px] text-ink-400">
                    {fmtTime(f.check_in_at)} → {fmtTime(f.check_out_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 rounded-xl border border-white/6 bg-navy-950/40 p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Capacity policy</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
              Capacity is computed from attendance records with no exit time. Duplicate scans are blocked by a database
              uniqueness constraint and the {settings?.cooldown_minutes ?? 5}-minute cooldown, so the counter cannot drift.
            </p>
            {settings?.capacity_alerts ? <Chip tone="green">capacity alerts on</Chip> : <Chip tone="gray">alerts off</Chip>}
          </div>
        </Card>
      </div>
      <p className="mt-3 text-center text-[10.5px] text-ink-400/70">
        Average session length today:{" "}
        {durationLabel(
          inside.length
            ? Math.round(
                inside.reduce((s, r) => s + Math.max(0, (Date.now() - new Date(r.check_in_at).getTime()) / 60000), 0) / inside.length,
              )
            : 0,
        )}
      </p>
    </Shell>
  );
}

export default function MonitorPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin", "gym_staff"]}>
      <MonitorInner />
    </StaffGuard>
  );
}
