"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Dumbbell, Plus, Search, Settings2, Wrench, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { apiFetch, useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, EmptyState, SectionTitle, StatCard, Tabs } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, timeAgo } from "@/lib/format";

type Equipment = {
  id: string;
  tag_code: string;
  name: string;
  category: string;
  brand: string | null;
  location: string | null;
  condition: "excellent" | "good" | "fair" | "poor";
  status: "operational" | "maintenance" | "out_of_service" | "retired";
  purchased_on: string | null;
  last_serviced_on: string | null;
  next_service_on: string | null;
  notes: string | null;
};

type Maintenance = {
  id: string;
  equipment_id: string;
  type: string;
  status: "open" | "in_progress" | "resolved" | "cancelled";
  title: string;
  description: string | null;
  reported_at: string;
  resolved_at: string | null;
  reporter: { full_name: string } | { full_name: string }[] | null;
  equipment: { name: string; tag_code: string } | { name: string; tag_code: string }[] | null;
};

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  operational: "green",
  maintenance: "amber",
  out_of_service: "red",
  retired: "gray",
};

const emptyForm = { tag_code: "", name: "", category: "strength", brand: "", location: "Main Gym Floor", condition: "good", status: "operational", notes: "" };

function EquipmentInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin" || profile?.role === "gym_admin";
  const [tab, setTab] = useState<"inventory" | "maintenance">("inventory");
  const [items, setItems] = useState<Equipment[]>([]);
  const [maint, setMaint] = useState<Maintenance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [fault, setFault] = useState<{ equipment_id: string; title: string; description: string; type: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();
      const [e, m] = await Promise.all([
        supabase.from("equipment").select("*").order("category").order("name"),
        supabase
          .from("equipment_maintenance")
          .select("*, equipment:equipment(name,tag_code), reporter:profiles(full_name)")
          .order("reported_at", { ascending: false })
          .limit(100),
      ]);
      if (e.error) throw e.error;
      setItems((e.data as Equipment[]) ?? []);
      setMaint((m.data as unknown as Maintenance[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load equipment");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      const matchQ = !q || i.name.toLowerCase().includes(q) || i.tag_code.toLowerCase().includes(q) || i.category.toLowerCase().includes(q);
      const matchS = !statusFilter || i.status === statusFilter;
      return matchQ && matchS;
    });
  }, [items, search, statusFilter]);

  const stats = {
    total: items.filter((i) => i.status !== "retired").length,
    operational: items.filter((i) => i.status === "operational").length,
    down: items.filter((i) => i.status === "maintenance" || i.status === "out_of_service").length,
    open: maint.filter((m) => m.status === "open" || m.status === "in_progress").length,
  };

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/admin/equipment", { method: "POST", body: JSON.stringify(form) });
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add equipment");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await apiFetch("/api/admin/equipment", { method: "PATCH", body: JSON.stringify({ id, status }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const submitFault = async () => {
    if (!fault) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/equipment", {
        method: "PUT",
        body: JSON.stringify({ equipment_id: fault.equipment_id, title: fault.title, description: fault.description, type: fault.type }),
      });
      setFault(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not report the fault");
    } finally {
      setSaving(false);
    }
  };

  const resolve = async (id: string) => {
    const notes = window.prompt("Resolution notes (what was fixed?)");
    if (notes === null) return;
    try {
      await apiFetch("/api/admin/equipment", { method: "PATCH", body: JSON.stringify({ maintenance_id: id, action: "resolve", resolution_notes: notes }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve the record");
    }
  };

  return (
    <Shell
      title="Equipment & maintenance"
      subtitle={`${stats.operational}/${stats.total} operational · ${stats.open} open maintenance records`}
      actions={isAdmin ? <Button onClick={() => setShowForm((v) => !v)}><Plus size={14} /> Add equipment</Button> : null}
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Equipment" value={stats.total} hint="excluding retired units" icon={<Dumbbell size={16} />} loading={loading} />
        <StatCard label="Operational" value={stats.operational} tone="mint" icon={<Check size={16} />} loading={loading} />
        <StatCard label="Down for service" value={stats.down} tone={stats.down ? "warn" : "default"} icon={<Wrench size={16} />} loading={loading} />
        <StatCard label="Open faults" value={stats.open} tone={stats.open ? "danger" : "default"} icon={<AlertTriangle size={16} />} loading={loading} />
      </div>

      {showForm && isAdmin ? (
        <Card className="mt-4 p-4">
          <SectionTitle title="Add equipment" subtitle="Track inventory, condition and service history" action={<button onClick={() => setShowForm(false)} className="text-ink-400 hover:text-white"><X size={15} /></button>} />
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className="hp-label">Asset tag *</label><input className="hp-input font-mono uppercase" value={form.tag_code} onChange={(e) => setForm({ ...form, tag_code: e.target.value.toUpperCase() })} placeholder="HP-EQ-0142" /></div>
            <div><label className="hp-label">Name *</label><input className="hp-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Treadmill" /></div>
            <div><label className="hp-label">Category</label><input className="hp-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="cardio / strength / free weights" /></div>
            <div><label className="hp-label">Brand</label><input className="hp-input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
            <div><label className="hp-label">Location</label><input className="hp-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <div>
              <label className="hp-label">Condition</label>
              <select className="hp-input" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                {["excellent", "good", "fair", "poor"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3"><label className="hp-label">Notes</label><input className="hp-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void create()} loading={saving} disabled={!form.name || !form.tag_code}>Add to inventory</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <div className="mt-4">
        <Tabs
          tabs={[
            { id: "inventory" as const, label: "Inventory", count: items.length },
            { id: "maintenance" as const, label: "Maintenance", count: maint.length },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === "inventory" ? (
        <>
          <Card className="mt-4 p-3">
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="hp-input pl-8" placeholder="Search by name, tag or category" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="hp-input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Any status</option>
                <option value="operational">Operational</option>
                <option value="maintenance">Maintenance</option>
                <option value="out_of_service">Out of service</option>
                <option value="retired">Retired</option>
              </select>
            </div>
          </Card>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="hp-skeleton h-32" />)
            ) : filtered.length === 0 ? (
              <div className="sm:col-span-2 xl:col-span-3">
                <Card className="p-4">
                  <EmptyState
                    title={items.length ? "No equipment matches the filters" : "No equipment recorded yet"}
                    description={isAdmin ? "Add gym equipment to track condition, availability and maintenance history." : "Ask a gym administrator to add equipment to the inventory."}
                    icon={<Dumbbell size={22} />}
                    action={isAdmin ? <Button onClick={() => setShowForm(true)}><Plus size={14} /> Add equipment</Button> : null}
                  />
                </Card>
              </div>
            ) : (
              filtered.map((e) => (
                <Card key={e.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-white">{e.name}</p>
                      <p className="truncate font-mono text-[10.5px] text-ink-400">{e.tag_code} · {e.category}</p>
                    </div>
                    <Chip tone={STATUS_TONE[e.status]}>{e.status.replaceAll("_", " ")}</Chip>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10.5px] text-ink-400">
                    <span>Condition: <span className="text-white">{e.condition}</span></span>
                    <span>Brand: <span className="text-white">{e.brand ?? "—"}</span></span>
                    <span>Location: <span className="text-white">{e.location ?? "—"}</span></span>
                    <span>Serviced: <span className="text-white">{e.last_serviced_on ? fmtDate(e.last_serviced_on) : "—"}</span></span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <button onClick={() => setFault({ equipment_id: e.id, title: `Fault reported: ${e.name}`, description: "", type: "fault" })} className="hp-btn hp-btn-ghost px-2 py-1 text-[10.5px]">
                      <AlertTriangle size={11} /> Report fault
                    </button>
                    {isAdmin ? (
                      <>
                        <button
                          onClick={() => void setStatus(e.id, e.status === "operational" ? "maintenance" : "operational")}
                          className="hp-btn hp-btn-ghost px-2 py-1 text-[10.5px]"
                        >
                          <Settings2 size={11} /> {e.status === "operational" ? "Send to service" : "Mark operational"}
                        </button>
                        {e.status !== "retired" ? (
                          <button onClick={() => void setStatus(e.id, "retired")} className="rounded-lg px-2 py-1 text-[10.5px] text-ink-400 hover:text-[#ffb2a1]">Retire</button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </Card>
              ))
            )}
          </div>
        </>
      ) : (
        <Card className="mt-4 overflow-hidden">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="hp-skeleton h-12" />)}</div>
          ) : maint.length === 0 ? (
            <div className="p-4"><EmptyState title="No maintenance records" description="Report a fault from the inventory tab to start a maintenance record." icon={<Wrench size={20} />} /></div>
          ) : (
            <div className="divide-y divide-white/5">
              {maint.map((m) => {
                const eq = Array.isArray(m.equipment) ? m.equipment[0] : m.equipment;
                const rep = Array.isArray(m.reporter) ? m.reporter[0] : m.reporter;
                return (
                  <div key={m.id} className="flex flex-wrap items-start gap-3 p-3.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.status === "resolved" ? "bg-mint-500/12 text-mint-300" : m.status === "open" ? "bg-[#ff5e47]/12 text-[#ffb2a1]" : "bg-warn-400/12 text-warn-400"}`}>
                      {m.status === "resolved" ? <Check size={14} /> : <Wrench size={14} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12.5px] font-medium text-white">{m.title}</p>
                        <Chip tone={m.status === "resolved" ? "green" : m.status === "open" ? "red" : "amber"}>{m.status.replace("_", " ")}</Chip>
                        <Chip tone="gray">{m.type}</Chip>
                      </div>
                      <p className="text-[10.5px] text-ink-400">
                        {eq ? `${eq.name} (${eq.tag_code}) · ` : ""}reported {timeAgo(m.reported_at)} by {rep?.full_name ?? "—"}
                      </p>
                      {m.description ? <p className="mt-0.5 text-[11px] text-ink-400/80">{m.description}</p> : null}
                    </div>
                    {m.status !== "resolved" && (isAdmin || profile?.role === "trainer") ? (
                      <button onClick={() => void resolve(m.id)} className="hp-btn hp-btn-ghost px-2 py-1 text-[10.5px]">Resolve</button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {fault ? (
        <Card className="mt-4 p-4">
          <SectionTitle title="Report equipment fault" subtitle="Creates a maintenance record and notifies gym admins" action={<button onClick={() => setFault(null)} className="text-ink-400 hover:text-white"><X size={15} /></button>} />
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
            <input className="hp-input" placeholder="What is wrong?" value={fault.title} onChange={(e) => setFault({ ...fault, title: e.target.value })} />
            <select className="hp-input" value={fault.type} onChange={(e) => setFault({ ...fault, type: e.target.value })}>
              <option value="fault">Fault</option>
              <option value="preventive">Preventive</option>
              <option value="inspection">Inspection</option>
            </select>
            <Button onClick={() => void submitFault()} loading={saving}>Submit</Button>
          </div>
          <input className="hp-input mt-2" placeholder="Details (optional)" value={fault.description} onChange={(e) => setFault({ ...fault, description: e.target.value })} />
        </Card>
      ) : null}
    </Shell>
  );
}

export default function EquipmentPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin", "gym_staff", "trainer"]}>
      <EquipmentInner />
    </StaffGuard>
  );
}
