"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ScrollText, Search, ShieldAlert } from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { Alert, Card, Chip, EmptyState, SectionTitle, Tabs, TableSkeleton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";

type AuditRow = { id: number; actor_id: string | null; actor_role: string | null; action: string; entity: string; entity_id: string | null; created_at: string; after: Record<string, unknown> | null; before: Record<string, unknown> | null };
type AttemptRow = { id: number; attempted_at: string; result: string; confidence: number | null; second_best: number | null; liveness_score: number | null; faces_detected: number | null; reason: string | null; student_id: string | null; profiles: { full_name: string } | { full_name: string }[] | null };

const RESULT_TONE: Record<string, "green" | "amber" | "red" | "gray" | "blue"> = {
  success: "green",
  already_marked: "blue",
  cooldown: "gray",
  unknown_face: "amber",
  low_confidence: "amber",
  ambiguous_match: "amber",
  liveness_failed: "red",
  multiple_faces: "amber",
  inactive_student: "red",
  no_face: "gray",
  error: "red",
};

function AuditInner() {
  const [tab, setTab] = useState<"actions" | "scans">("actions");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();
      const [a, s, p] = await Promise.all([
        supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200),
        supabase
          .from("attendance_attempts")
          .select("*, profiles:profiles(full_name)")
          .order("attempted_at", { ascending: false })
          .limit(200),
        supabase.from("profiles").select("id, full_name"),
      ]);
      if (a.error) throw a.error;
      setRows((a.data as AuditRow[]) ?? []);
      setAttempts((s.data as unknown as AttemptRow[]) ?? []);
      setNames(Object.fromEntries(((p.data as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the audit trail");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredActions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || r.action.toLowerCase().includes(q) || r.entity.toLowerCase().includes(q) || (names[r.actor_id ?? ""] ?? "").toLowerCase().includes(q));
  }, [rows, search, names]);

  const filteredAttempts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return attempts.filter((r) => !q || r.result.includes(q) || (r.reason ?? "").toLowerCase().includes(q));
  }, [attempts, search]);

  const exportLog = () => {
    downloadCsv("healthplex-audit-log.csv", [
      ["Timestamp (IST)", "Actor", "Role", "Action", "Entity", "Entity ID", "Details"],
      ...filteredActions.map((r) => [fmtDateTime(r.created_at), names[r.actor_id ?? ""] ?? r.actor_id ?? "system", r.actor_role ?? "", r.action, r.entity, r.entity_id, JSON.stringify(r.after ?? r.before ?? {})]),
    ]);
  };

  return (
    <Shell
      title="Audit & security log"
      subtitle="Administrative actions and recognition attempts"
      actions={
        <button onClick={exportLog} className="hp-btn hp-btn-ghost">
          <Download size={14} /> Export
        </button>
      }
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { id: "actions" as const, label: "Administrative actions", count: rows.length },
            { id: "scans" as const, label: "Recognition attempts", count: attempts.length },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="hp-input pl-8" placeholder="Search action, entity or staff member" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {tab === "actions" ? (
        <Card className="mt-4 overflow-hidden">
          {loading ? (
            <div className="p-4"><TableSkeleton rows={8} cols={5} /></div>
          ) : filteredActions.length === 0 ? (
            <div className="p-4"><EmptyState title="No audit entries" description="Administrative actions such as corrections, enrollments and policy changes appear here." icon={<ScrollText size={20} />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-ink-400">
                    <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                    <th className="px-3 py-2.5 font-semibold">Actor</th>
                    <th className="px-3 py-2.5 font-semibold">Action</th>
                    <th className="px-3 py-2.5 font-semibold">Entity</th>
                    <th className="px-3 py-2.5 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActions.map((r) => (
                    <tr key={r.id} className="border-b border-white/4 last:border-0">
                      <td className="px-4 py-2 text-ink-400">{fmtDateTime(r.created_at)}</td>
                      <td className="px-3 py-2 text-white">
                        {names[r.actor_id ?? ""] ?? (r.actor_id ? "unknown" : "system")}
                        <span className="ml-1 text-[10px] text-ink-400">{r.actor_role?.replace("_", " ")}</span>
                      </td>
                      <td className="px-3 py-2"><Chip tone={r.action.includes("delete") || r.action.includes("cleanup") ? "red" : r.action.includes("correct") ? "amber" : "blue"}>{r.action}</Chip></td>
                      <td className="px-3 py-2 font-mono text-[10.5px] text-ink-400">
                        {r.entity}
                        {r.entity_id ? <span className="block truncate text-[9.5px] text-ink-400/60">{r.entity_id.slice(0, 18)}</span> : null}
                      </td>
                      <td className="max-w-[260px] px-3 py-2">
                        <p className="truncate font-mono text-[9.5px] text-ink-400" title={JSON.stringify(r.after ?? r.before ?? {})}>
                          {JSON.stringify(r.after ?? r.before ?? {}).slice(0, 110)}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card className="mt-4 overflow-hidden">
          {loading ? (
            <div className="p-4"><TableSkeleton rows={8} cols={5} /></div>
          ) : filteredAttempts.length === 0 ? (
            <div className="p-4"><EmptyState title="No recognition attempts logged" description="Successful and failed scans (including liveness and ambiguity rejections) are recorded here." icon={<ShieldAlert size={20} />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-ink-400">
                    <th className="px-4 py-2.5 font-semibold">Time</th>
                    <th className="px-3 py-2.5 font-semibold">Result</th>
                    <th className="px-3 py-2.5 font-semibold">Student</th>
                    <th className="px-3 py-2.5 font-semibold">Confidence</th>
                    <th className="px-3 py-2.5 font-semibold">Liveness</th>
                    <th className="px-3 py-2.5 font-semibold">Faces</th>
                    <th className="px-3 py-2.5 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAttempts.map((r) => {
                    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
                    return (
                      <tr key={r.id} className="border-b border-white/4 last:border-0">
                        <td className="px-4 py-2 text-ink-400">{fmtDateTime(r.attempted_at)}</td>
                        <td className="px-3 py-2"><Chip tone={RESULT_TONE[r.result] ?? "gray"}>{r.result.replaceAll("_", " ")}</Chip></td>
                        <td className="px-3 py-2 text-white">{p?.full_name ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-400">{r.confidence != null ? `${(Number(r.confidence) * 100).toFixed(1)}%` : "—"}</td>
                        <td className="px-3 py-2 text-ink-400">{r.liveness_score != null ? `${(Number(r.liveness_score) * 100).toFixed(0)}%` : "—"}</td>
                        <td className="px-3 py-2 text-ink-400">{r.faces_detected ?? "—"}</td>
                        <td className="px-3 py-2 text-[10.5px] text-ink-400">{r.reason ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="mt-4">
        <SectionTitle title="Why this matters" />
        <Card className="p-4 text-[11.5px] leading-relaxed text-ink-400">
          Every attendance correction, manual entry, biometric enrollment or withdrawal, retention policy change and cleanup run is
          written to an append-only audit log that only administrators can read. Suspicious recognition attempts — unknown faces,
          liveness failures, ambiguous matches and multiple faces — are stored for review with their confidence and liveness scores,
          but never contain camera images.
        </Card>
      </div>
    </Shell>
  );
}

export default function AuditPage() {
  return (
    <StaffGuard roles={["super_admin", "gym_admin"]}>
      <AuditInner />
    </StaffGuard>
  );
}
