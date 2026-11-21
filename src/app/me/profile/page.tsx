"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, SectionTitle, Skeleton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";

type Me = {
  enrollment_id: string;
  academic_year: number;
  program: string | null;
  emergency_contact: string | null;
  face_enrolled: boolean;
  face_consent: string;
  departments: { name: string; code: string } | { name: string; code: string }[] | null;
  created_at: string;
};

function MyProfile() {
  const { profile, refresh } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ phone: "", program: "", emergency_contact: "" });
  const [password, setPassword] = useState({ next: "", confirm: "" });
  const [pwdState, setPwdState] = useState<{ error?: string; ok?: boolean }>({});

  const load = useCallback(async () => {
    if (!profile) return;
    const client = createClient();
    const { data } = await client.from("students").select("*, departments(name,code)").eq("id", profile.id).maybeSingle();
    setMe(data as Me);
    setForm({ phone: profile.phone ?? "", program: data?.program ?? "", emergency_contact: data?.emergency_contact ?? "" });
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const client = createClient();
      const { error: pErr } = await client.from("profiles").update({ phone: form.phone || null }).eq("id", profile.id);
      if (pErr) throw pErr;
      const { error: sErr } = await client.from("students").update({ program: form.program || null, emergency_contact: form.emergency_contact || null }).eq("id", profile.id);
      if (sErr) throw sErr;
      setSaved(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update your profile");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setPwdState({});
    if (password.next.length < 8) return setPwdState({ error: "Password must be at least 8 characters" });
    if (password.next !== password.confirm) return setPwdState({ error: "Passwords do not match" });
    const client = createClient();
    const { error } = await client.auth.updateUser({ password: password.next });
    if (error) return setPwdState({ error: error.message });
    await client.rpc("clear_password_change_flag");
    setPassword({ next: "", confirm: "" });
    setPwdState({ ok: true });
  };

  const dept = Array.isArray(me?.departments) ? me?.departments[0] : me?.departments;

  return (
    <Shell title="My profile" subtitle="Manage your contact details and account security">
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}
      {saved ? <div className="mb-4"><Alert tone="success" title="Profile updated">Your changes have been saved.</Alert></div> : null}

      {loading || !me || !profile ? (
        <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <SectionTitle title="University details" subtitle="Managed by the gym office — contact them to change these" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div><label className="hp-label">Full name</label><input className="hp-input" value={profile.full_name} readOnly /></div>
              <div><label className="hp-label">Enrollment ID</label><input className="hp-input font-mono" value={me.enrollment_id} readOnly /></div>
              <div><label className="hp-label">University email</label><input className="hp-input" value={profile.email} readOnly /></div>
              <div><label className="hp-label">Department</label><input className="hp-input" value={dept ? `${dept.name} (${dept.code})` : "Not assigned"} readOnly /></div>
              <div><label className="hp-label">Academic year</label><input className="hp-input" value={`Year ${me.academic_year}`} readOnly /></div>
              <div><label className="hp-label">Enrolled since</label><input className="hp-input" value={fmtDate(me.created_at)} readOnly /></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone={me.face_enrolled ? "green" : "gray"}>{me.face_enrolled ? "face enrolled" : "no biometrics"}</Chip>
              <Chip tone={profile.status === "active" ? "green" : "red"}>{profile.status}</Chip>
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle title="Editable details" subtitle="Only these fields can be changed by students" />
            <div className="space-y-2.5">
              <div><label className="hp-label">Phone</label><input className="hp-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" /></div>
              <div><label className="hp-label">Program</label><input className="hp-input" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} placeholder="B.Tech Computer Science" /></div>
              <div><label className="hp-label">Emergency contact</label><input className="hp-input" value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} placeholder="Parent / guardian number" /></div>
              <Button onClick={() => void save()} loading={saving}><Save size={14} /> Save changes</Button>
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle title="Account security" subtitle="Change your password" />
            <div className="space-y-2.5">
              <div><label className="hp-label">New password</label><input type="password" className="hp-input" value={password.next} onChange={(e) => setPassword({ ...password, next: e.target.value })} autoComplete="new-password" /></div>
              <div><label className="hp-label">Confirm password</label><input type="password" className="hp-input" value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} autoComplete="new-password" /></div>
              {pwdState.error ? <p className="text-[11px] text-[#ffb2a1]">{pwdState.error}</p> : null}
              {pwdState.ok ? <p className="text-[11px] text-mint-300">Password updated successfully.</p> : null}
              <Button variant="ghost" onClick={() => void changePassword()}>Update password</Button>
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle title="Privacy" subtitle="Your data in HEALTHPLEX" />
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-400">
              <li className="flex gap-1.5"><ShieldCheck size={12} className="mt-0.5 shrink-0 text-mint-300" /> Attendance records are read-only for students and visible only to you and gym staff.</li>
              <li className="flex gap-1.5"><ShieldCheck size={12} className="mt-0.5 shrink-0 text-mint-300" /> Your photo is stored privately and served with short-lived signed links.</li>
              <li className="flex gap-1.5"><ShieldCheck size={12} className="mt-0.5 shrink-0 text-mint-300" /> You can withdraw biometric consent any time from the Face Enrollment page.</li>
              <li className="flex gap-1.5"><ShieldCheck size={12} className="mt-0.5 shrink-0 text-mint-300" /> Individual attendance records are retained for six months; older data is kept only as monthly summaries.</li>
            </ul>
          </Card>
        </div>
      )}
    </Shell>
  );
}

export default function StudentProfilePage() {
  return (
    <StaffGuard roles={["student"]}>
      <MyProfile />
    </StaffGuard>
  );
}
