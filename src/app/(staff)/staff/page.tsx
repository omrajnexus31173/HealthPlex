"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, Clock, Plus, ShieldCheck, UserCog, UserPlus, Users, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { apiFetch, useAuth } from "@/components/AuthProvider";
import { Alert, Avatar, Button, Card, Chip, EmptyState, SectionTitle, Tabs } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, fmtTime } from "@/lib/format";

type StaffRow = {
  id: string;
  staff_code: string;
  designation: string | null;
  joined_on: string | null;
  shift_id: string | null;
  profiles: { full_name: string; email: string; phone: string | null; status: string; role: string; last_login_at: string | null } | null;
};

type TrainerRow = {
  id: string;
  trainer_code: string;
  specialization: string | null;
  experience_years: number | null;
  bio: string | null;
  profiles: { full_name: string; email: string; status: string; role: string } | null;
};

type Shift = { id: string; name: string; start_time: string; end_time: string; description: string | null };
type Schedule = { id: string; trainer_id: string; weekday: number; start_time: string; end_time: string; focus: string | null };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ROLE_OPTIONS = [
  { value: "gym_staff", label: "Gym Staff" },
  { value: "trainer", label: "Trainer" },
  { value: "gym_admin", label: "Gym Admin" },
] as const;

function StaffInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin" || profile?.role === "gym_admin";
  const [tab, setTab] = useState<"staff" | "trainers" | "shifts">("staff");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [trainers, setTrainers] = useState<TrainerRow[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string; role: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "trainer" as (typeof ROLE_OPTIONS)[number]["value"],
    code: "",
    phone: "",
    detail: "",
    experience: 0,
    shift_id: "",
  });
  const [scheduleForm, setScheduleForm] = useState({ trainer_id: "", weekday: 1, start: "07:00", end: "09:00", focus: "" });

  const load = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();
      const [s, t, sh, sc] = await Promise.all([
        supabase
          .from("staff")
          .select("id, staff_code, designation, joined_on, shift_id, profiles:profiles(full_name,email,phone,status,role,last_login_at)")
          .order("created_at", { ascending: false }),
        supabase
          .from("trainers")
          .select("id, trainer_code, specialization, experience_years, bio, profiles:profiles(full_name,email,status,role)")
          .order("created_at", { ascending: false }),
        supabase.from("gym_shifts").select("*").order("start_time"),
        supabase.from("trainer_schedules").select("*").order("weekday").order("start_time"),
      ]);
      if (s.error) throw s.error;
      setStaff((s.data as unknown as StaffRow[]) ?? []);
      setTrainers((t.data as unknown as TrainerRow[]) ?? []);
      setShifts((sh.data as Shift[]) ?? []);
      setSchedules((sc.data as Schedule[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load staff directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createStaff = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ temporary_password: string; email: string }>("/api/admin/staff", {
        method: "POST",
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          role: form.role,
          code: form.code || undefined,
          phone: form.phone || null,
          designation: form.detail || null,
          specialization: form.detail || null,
          experience_years: Number(form.experience) || 0,
          shift_id: form.shift_id || null,
        }),
      });
      setCreated({ email: res.email, password: res.temporary_password, role: form.role });
      setShowForm(false);
      setForm({ full_name: "", email: "", role: "trainer", code: "", phone: "", detail: "", experience: 0, shift_id: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the account");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await apiFetch("/api/admin/staff", { method: "PATCH", body: JSON.stringify({ id, status }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update status");
    }
  };

  const addSchedule = async () => {
    if (!scheduleForm.trainer_id) return setError("Select a trainer first");
    setSaving(true);
    try {
      await apiFetch("/api/admin/staff", {
        method: "PUT",
        body: JSON.stringify({
          trainer_id: scheduleForm.trainer_id,
          weekday: Number(scheduleForm.weekday),
          start_time: scheduleForm.start,
          end_time: scheduleForm.end,
          focus: scheduleForm.focus || null,
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the schedule slot");
    } finally {
      setSaving(false);
    }
  };

  const trainerSchedules = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    schedules.forEach((s) => map.set(s.trainer_id, [...(map.get(s.trainer_id) ?? []), s]));
    return map;
  }, [schedules]);

  return (
    <Shell
      title="Staff & trainers"
      subtitle="University gym team, shift allocation and trainer availability"
      actions={isAdmin ? <Button onClick={() => setShowForm((v) => !v)}><UserPlus size={14} /> Add staff</Button> : null}
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}

      {created ? (
        <div className="mb-4">
          <Alert
            tone="success"
            title="Account created"
            action={<button onClick={() => setCreated(null)} className="text-ink-400 hover:text-white"><X size={14} /></button>}
          >
            <p>Share these credentials securely — the password is displayed only once and must be changed at first sign-in.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-navy-950/60 px-2 py-1 text-[11.5px] text-mint-300">{created.email}</code>
              <code className="rounded bg-navy-950/60 px-2 py-1 text-[11.5px] text-mint-300">{created.password}</code>
              <Chip tone="green">{created.role.replace("_", " ")}</Chip>
            </div>
          </Alert>
        </div>
      ) : null}

      {showForm && isAdmin ? (
        <Card className="mb-4 p-4">
          <SectionTitle title="Create a gym team account" subtitle="Roles: gym staff, trainer or gym admin" action={<button onClick={() => setShowForm(false)} className="text-ink-400 hover:text-white"><X size={15} /></button>} />
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className="hp-label">Full name *</label><input className="hp-input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Rohan Mehta" /></div>
            <div><label className="hp-label">Email *</label><input className="hp-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.toLowerCase() })} placeholder="rohan@gsfcuniversity.ac.in" /></div>
            <div>
              <label className="hp-label">Role *</label>
              <select className="hp-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}>
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div><label className="hp-label">{form.role === "trainer" ? "Trainer code" : "Staff code"}</label><input className="hp-input font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="auto-generated if blank" /></div>
            <div><label className="hp-label">Phone</label><input className="hp-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div>
              <label className="hp-label">{form.role === "trainer" ? "Specialisation" : "Designation"}</label>
              <input className="hp-input" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} placeholder={form.role === "trainer" ? "Strength & conditioning" : "Gym supervisor"} />
            </div>
            {form.role === "trainer" ? (
              <div><label className="hp-label">Experience (years)</label><input type="number" min={0} max={50} className="hp-input" value={form.experience} onChange={(e) => setForm({ ...form, experience: Number(e.target.value) })} /></div>
            ) : (
              <div>
                <label className="hp-label">Assigned shift</label>
                <select className="hp-input" value={form.shift_id} onChange={(e) => setForm({ ...form, shift_id: e.target.value })}>
                  <option value="">Unassigned</option>
                  {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void createStaff()} loading={saving} disabled={!form.full_name || !form.email}>Create account</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <Tabs
        tabs={[
          { id: "staff" as const, label: "Gym staff", count: staff.length },
          { id: "trainers" as const, label: "Trainers", count: trainers.length },
          { id: "shifts" as const, label: "Shifts", count: shifts.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === "staff" ? (
          <Card className="overflow-hidden">
            {loading ? (
              <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="hp-skeleton h-12" />)}</div>
            ) : staff.length === 0 ? (
              <div className="p-4"><EmptyState title="No gym staff yet" description="Add gym supervisors and front-desk staff to manage the kiosk and attendance." icon={<UserCog size={20} />} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-white/6 text-[10.5px] uppercase tracking-wider text-ink-400">
                      <th className="px-4 py-2.5 font-semibold">Staff</th>
                      <th className="px-3 py-2.5 font-semibold">Code</th>
                      <th className="px-3 py-2.5 font-semibold">Designation</th>
                      <th className="px-3 py-2.5 font-semibold">Shift</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      {isAdmin ? <th className="px-3 py-2.5 text-right font-semibold">Manage</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => (
                      <tr key={s.id} className="border-b border-white/4 last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={s.profiles?.full_name ?? "?"} size={30} />
                            <div>
                              <p className="font-medium text-white">{s.profiles?.full_name}</p>
                              <p className="text-[10.5px] text-ink-400">{s.profiles?.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11.5px] text-ink-400">{s.staff_code}</td>
                        <td className="px-3 py-2.5 text-ink-400">{s.designation ?? "—"}</td>
                        <td className="px-3 py-2.5 text-ink-400">{shifts.find((x) => x.id === s.shift_id)?.name ?? "Unassigned"}</td>
                        <td className="px-3 py-2.5">
                          <Chip tone={s.profiles?.status === "active" ? "green" : "gray"}>{s.profiles?.status}</Chip>
                          <p className="mt-0.5 text-[10px] text-ink-400">{s.profiles?.role.replace("_", " ")}</p>
                        </td>
                        {isAdmin ? (
                          <td className="px-3 py-2.5 text-right">
                            {s.profiles?.status === "active" ? (
                              <button onClick={() => void setStatus(s.id, "inactive")} className="rounded-lg px-2 py-1 text-[11px] text-ink-400 hover:bg-white/5 hover:text-warn-400">Deactivate</button>
                            ) : (
                              <button onClick={() => void setStatus(s.id, "active")} className="rounded-lg px-2 py-1 text-[11px] text-ink-400 hover:bg-white/5 hover:text-mint-300">Reactivate</button>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}

        {tab === "trainers" ? (
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Card className="overflow-hidden">
              {loading ? (
                <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="hp-skeleton h-16" />)}</div>
              ) : trainers.length === 0 ? (
                <div className="p-4"><EmptyState title="No trainers yet" description="Trainers can run sessions and log equipment faults." icon={<Users size={20} />} /></div>
              ) : (
                <div className="divide-y divide-white/5">
                  {trainers.map((t) => (
                    <div key={t.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar name={t.profiles?.full_name ?? "?"} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[13px] font-semibold text-white">{t.profiles?.full_name}</p>
                            <Chip tone={t.profiles?.status === "active" ? "green" : "gray"}>{t.profiles?.status}</Chip>
                          </div>
                          <p className="text-[10.5px] text-ink-400">{t.profiles?.email} · {t.trainer_code}</p>
                          <p className="mt-1 text-[11.5px] text-ink-400">
                            {t.specialization ?? "General training"} · {t.experience_years ?? 0} years experience
                          </p>
                          {(trainerSchedules.get(t.id) ?? []).length ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {(trainerSchedules.get(t.id) ?? []).map((s) => (
                                <Chip key={s.id} tone="blue">
                                  {WEEKDAYS[s.weekday].slice(0, 3)} {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                                </Chip>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-[10.5px] text-ink-400/70">No availability slots yet</p>
                          )}
                        </div>
                        {isAdmin ? (
                          <button
                            onClick={() => void setStatus(t.id, t.profiles?.status === "active" ? "inactive" : "active")}
                            className="shrink-0 rounded-lg px-2 py-1 text-[10.5px] text-ink-400 hover:bg-white/5 hover:text-white"
                          >
                            {t.profiles?.status === "active" ? "Deactivate" : "Activate"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <SectionTitle title="Trainer availability" subtitle="Weekly recurring slots" />
              {trainers.length === 0 ? (
                <p className="text-[11.5px] text-ink-400">Add a trainer to manage availability.</p>
              ) : (
                <div className="space-y-2">
                  <select className="hp-input" value={scheduleForm.trainer_id} onChange={(e) => setScheduleForm({ ...scheduleForm, trainer_id: e.target.value })}>
                    <option value="">Select trainer</option>
                    {trainers.map((t) => <option key={t.id} value={t.id}>{t.profiles?.full_name}</option>)}
                  </select>
                  <div className="grid grid-cols-3 gap-2">
                    <select className="hp-input" value={scheduleForm.weekday} onChange={(e) => setScheduleForm({ ...scheduleForm, weekday: Number(e.target.value) })}>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d.slice(0, 3)}</option>)}
                    </select>
                    <input type="time" className="hp-input" value={scheduleForm.start} onChange={(e) => setScheduleForm({ ...scheduleForm, start: e.target.value })} />
                    <input type="time" className="hp-input" value={scheduleForm.end} onChange={(e) => setScheduleForm({ ...scheduleForm, end: e.target.value })} />
                  </div>
                  <input className="hp-input" placeholder="Focus (e.g. strength, cardio)" value={scheduleForm.focus} onChange={(e) => setScheduleForm({ ...scheduleForm, focus: e.target.value })} />
                  <Button onClick={() => void addSchedule()} loading={saving} disabled={!scheduleForm.trainer_id} className="w-full">
                    <Plus size={14} /> Add slot
                  </Button>
                </div>
              )}
              <div className="mt-3 rounded-xl border border-white/6 bg-navy-950/40 p-3">
                <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">
                  <ShieldCheck size={11} /> Permissions
                </p>
                <ul className="mt-1.5 space-y-1 text-[10.5px] text-ink-400">
                  <li className="flex items-center gap-1.5"><Check size={10} className="text-mint-400" /> Staff & trainers: kiosk, attendance, equipment faults</li>
                  <li className="flex items-center gap-1.5"><Check size={10} className="text-mint-400" /> Gym admins: students, staff, settings, corrections</li>
                  <li className="flex items-center gap-1.5"><Check size={10} className="text-mint-400" /> Super admin: everything + retention & cleanup</li>
                </ul>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "shifts" ? (
          <Card className="p-4">
            <SectionTitle title="Gym shifts" subtitle="Operational windows used when assigning staff" />
            <div className="grid gap-3 sm:grid-cols-3">
              {shifts.map((s) => (
                <div key={s.id} className="rounded-xl border border-white/6 bg-navy-950/40 p-3.5">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-mint-300" />
                    <p className="text-[12.5px] font-semibold text-white">{s.name}</p>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-400">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</p>
                  {s.description ? <p className="mt-1 text-[10.5px] text-ink-400/80">{s.description}</p> : null}
                  <p className="mt-1.5 text-[10.5px] text-ink-400">
                    {staff.filter((x) => x.shift_id === s.id).length} staff assigned
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-white/6 bg-navy-950/40 p-3 text-[11px] text-ink-400">
              <CalendarClock size={13} className="mr-1.5 inline text-mint-300" />
              Trainer schedules are managed in the Trainers tab. Sessions reference trainers and appear on the Sessions calendar.
            </div>
            {staff.length ? (
              <p className="mt-2 text-[10.5px] text-ink-400">Last staff account update: {fmtDate(staff[0] ? new Date().toISOString() : null)}</p>
            ) : null}
          </Card>
        ) : null}
      </div>
    </Shell>
  );
}

export default function StaffPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin"]}>
      <StaffInner />
    </StaffGuard>
  );
}
