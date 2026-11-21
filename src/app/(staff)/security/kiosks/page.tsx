"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, MonitorSmartphone, Plus, ShieldOff, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { apiFetch } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, EmptyState, SectionTitle, TableSkeleton } from "@/components/ui";
import { fmtDateTime, timeAgo } from "@/lib/format";

type Device = { id: string; name: string; location: string | null; status: string; last_seen_at: string | null; created_at: string; revoked_at: string | null };

function KiosksInner() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", location: "Main gym entrance" });
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch<{ devices: Device[] }>("/api/admin/kiosks");
      setDevices(res.devices);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load kiosk devices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch<{ device: { name: string }; code: string }>("/api/admin/kiosks", { method: "POST", body: JSON.stringify(form) });
      setIssued({ name: res.device.name, code: res.code });
      setForm({ name: "", location: "Main gym entrance" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the device");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (d: Device) => {
    if (!window.confirm(`Revoke "${d.name}"? That key will stop working immediately on the kiosk.`)) return;
    try {
      await apiFetch("/api/admin/kiosks", { method: "PATCH", body: JSON.stringify({ id: d.id, action: "revoke" }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the device");
    }
  };

  return (
    <Shell title="Kiosk devices" subtitle="Pair physical attendance stations with hashed device keys">
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}

      {issued ? (
        <div className="mb-4">
          <Alert tone="success" title={`Device key for ${issued.name}`} action={<button onClick={() => setIssued(null)} className="text-ink-400 hover:text-white"><X size={14} /></button>}>
            <p>This key is shown once and stored only as a SHA-256 hash. Enter it on the kiosk device to pair it.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-navy-950/60 px-2 py-1 font-mono text-[11px] text-mint-300">{issued.code}</code>
              <button className="inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-white" onClick={() => void navigator.clipboard.writeText(issued.code)}>
                <Copy size={12} /> copy
              </button>
            </div>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-4"><TableSkeleton rows={4} cols={4} /></div>
          ) : devices.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No kiosk devices yet" description="Create a device key, then enter it on the gym entrance tablet to enable attendance scanning." icon={<MonitorSmartphone size={22} />} />
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {devices.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 p-3.5">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${d.status === "active" ? "bg-mint-500/12 text-mint-300" : "bg-white/5 text-ink-400"}`}>
                    <MonitorSmartphone size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-semibold text-white">{d.name}</p>
                      <Chip tone={d.status === "active" ? "green" : "red"}>{d.status}</Chip>
                    </div>
                    <p className="text-[10.5px] text-ink-400">
                      {d.location ?? "—"} · created {fmtDateTime(d.created_at)} · last seen {d.last_seen_at ? timeAgo(d.last_seen_at) : "never"}
                    </p>
                  </div>
                  {d.status === "active" ? (
                    <button onClick={() => void revoke(d)} className="hp-btn hp-btn-danger px-2 py-1 text-[10.5px]">
                      <ShieldOff size={11} /> Revoke
                    </button>
                  ) : (
                    <span className="text-[10.5px] text-ink-400">revoked {d.revoked_at ? timeAgo(d.revoked_at) : ""}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Add a kiosk" subtitle="Issue a device key for a new attendance station" />
          <div className="space-y-2">
            <div><label className="hp-label">Device name</label><input className="hp-input" placeholder="Entrance tablet A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="hp-label">Location</label><input className="hp-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <Button onClick={() => void create()} loading={creating} disabled={form.name.trim().length < 3} className="w-full">
              <Plus size={14} /> Generate device key
            </Button>
          </div>
          <div className="mt-3 rounded-xl border border-white/6 bg-navy-950/40 p-3 text-[10.5px] leading-relaxed text-ink-400">
            <p className="flex items-center gap-1.5 font-semibold text-white"><KeyRound size={11} className="text-mint-300" /> How pairing works</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Generate a key and copy it to the kiosk tablet.</li>
              <li>Sign in as gym staff and open the Attendance Kiosk.</li>
              <li>Paste the key to pair the device (remembered locally).</li>
              <li>Revoke at any time — the key immediately stops working.</li>
            </ol>
          </div>
        </Card>
      </div>
    </Shell>
  );
}

export default function KiosksPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin"]}>
      <KiosksInner />
    </StaffGuard>
  );
}
