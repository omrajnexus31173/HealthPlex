"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertOctagon,
  CalendarClock,
  CheckCircle2,
  DatabaseZap,
  Download,
  FileWarning,
  HardDrive,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { StaffGuard } from "@/components/StaffGuard";
import { apiFetch, useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, Chip, EmptyState, SectionTitle, Skeleton, StatCard, Tabs } from "@/components/ui";
import { bytesLabel, fmtDate, fmtDateTime, timeAgo } from "@/lib/format";
import type { CleanupRun, RetentionStatus } from "@/lib/types";

type Summary = { year: number; month: number; total_visits: number; unique_students: number; avg_duration_minutes: number | null; peak_hour: number | null };
type Backup = { id: string; created_at: string; cutoff_date: string; record_count: number; checksum: string; verified: boolean; storage_bytes: number };

function RetentionInner() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<RetentionStatus | null>(null);
  const [runs, setRuns] = useState<CleanupRun[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [approval, setApproval] = useState("");
  const [tab, setTab] = useState<"policy" | "history" | "summaries" | "backups">("policy");
  const [preview, setPreview] = useState<{ candidates: number; cutoff: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch<{ status: RetentionStatus; runs: CleanupRun[]; summaries: Summary[]; backups: Backup[] }>("/api/admin/retention");
      setStatus(res.status);
      setRuns(res.runs);
      setSummaries(res.summaries);
      setBackups(res.backups);
      setApproval(res.status.approved_by ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load retention status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dryRun = async () => {
    setBusy("dry");
    setError(null);
    try {
      const res = await apiFetch<{ candidate_records: number; cutoff_date: string }>("/api/admin/retention", {
        method: "POST",
        body: JSON.stringify({ action: "dry_run" }),
      });
      setPreview({ candidates: res.candidate_records, cutoff: res.cutoff_date });
      setNotice(`Dry run complete — ${res.candidate_records} records older than ${fmtDate(res.cutoff_date)} would be archived and deleted. Nothing was deleted.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dry run failed");
    } finally {
      setBusy(null);
    }
  };

  const updatePolicy = async (patch: Record<string, unknown>) => {
    setBusy("policy");
    setError(null);
    try {
      await apiFetch("/api/admin/retention", { method: "PATCH", body: JSON.stringify(patch) });
      setNotice("Retention policy updated and written to the audit log.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the policy");
    } finally {
      setBusy(null);
    }
  };

  const execute = async () => {
    setBusy("run");
    setError(null);
    try {
      const res = await apiFetch<{ deleted?: number; aborted?: boolean; message?: string; candidate_records?: number }>("/api/admin/retention", {
        method: "POST",
        body: JSON.stringify({ action: "execute", confirm: confirmText }),
      });
      setConfirmText("");
      setNotice(
        res.aborted
          ? res.message ?? "Cleanup skipped."
          : `Cleanup finished — ${res.deleted ?? 0} records archived and deleted after a verified backup.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setBusy(null);
    }
  };

  const downloadBackup = async (backup: Backup) => {
    try {
      const res = await apiFetch<{ payload: unknown; checksum: string }>(`/api/admin/retention?backup=${backup.id}`);
      const blob = new Blob([JSON.stringify({ checksum: res.checksum, records: res.payload }, null, 0)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `healthplex-attendance-backup-${backup.cutoff_date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export the backup");
    }
  };

  const policyState = status ? (!status.enabled ? "disabled" : !status.armed ? "enabled (not armed)" : "armed") : "—";

  return (
    <Shell
      title="Data management & retention"
      subtitle="6-month attendance retention · Super Admin only · all destructive actions are guarded"
      actions={
        <Button variant="ghost" onClick={() => void load()} loading={loading}>
          <RefreshCw size={14} /> Refresh
        </Button>
      }
    >
      {error ? <div className="mb-4"><Alert tone="danger" title="Attention">{error}</Alert></div> : null}
      {notice ? (
        <div className="mb-4">
          <Alert tone="success" title="Done">{notice}</Alert>
        </div>
      ) : null}

      {loading || !status ? (
        <div className="grid gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Retention policy" value={`${status.retention_months} months`} hint={`policy ${policyState}`} icon={<CalendarClock size={16} />} />
            <StatCard label="Eligible for deletion" value={status.candidate_records} hint={`older than ${fmtDate(status.cutoff_date)}`} tone={status.candidate_records ? "warn" : "mint"} icon={<Trash2 size={16} />} />
            <StatCard label="Attendance records" value={status.total_attendance_records} hint={`oldest ${fmtDate(status.oldest_record)}`} icon={<DatabaseZap size={16} />} />
            <StatCard label="Database size" value={bytesLabel(status.db_size_bytes)} hint={`attendance table ${bytesLabel(status.attendance_table_bytes)}`} icon={<HardDrive size={16} />} />
          </div>

          <div className="mt-4 rounded-2xl border border-warn-400/25 bg-warn-400/6 p-3.5">
            <div className="flex items-start gap-2.5">
              <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn-400" />
              <div className="text-[11.5px] leading-relaxed text-ink-400">
                <p className="font-semibold text-white">Destructive cleanup is disabled until GSFC University approves the policy.</p>
                <p className="mt-0.5">
                  The monthly scheduled job (pg_cron, 1st of every month, 02:30 IST) checks <span className="text-white">retention_enabled + retention_armed</span> before
                  doing anything. Even when armed, every execution writes a verified JSON backup and generates the monthly summaries
                  in the same transaction <em>before</em> deleting a single row. Student profiles, active accounts, enrollment IDs,
                  roles, biometric templates, gym configuration, staff, equipment and audit records are never touched.
                </p>
              </div>
            </div>
          </div>

          {busy === "run" ? (
            <div className="mt-4"><Alert tone="warning" title="Cleanup running">Archiving summaries, writing and verifying the backup, then deleting eligible records…</Alert></div>
          ) : null}

          <div className="mt-4">
            <Tabs
              tabs={[
                { id: "policy" as const, label: "Policy & controls" },
                { id: "history" as const, label: "Execution history", count: runs.length },
                { id: "summaries" as const, label: "Monthly summaries", count: summaries.length },
                { id: "backups" as const, label: "Backups", count: backups.length },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>

          {tab === "policy" ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <Card className="p-4">
                <SectionTitle title="Policy controls" subtitle="Only a Super Admin can change these settings" />
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between rounded-xl border border-white/6 bg-navy-950/40 px-3 py-2.5">
                    <div>
                      <p className="text-[12px] font-medium text-white">Retention window</p>
                      <p className="text-[10.5px] text-ink-400">Attendance older than this is eligible</p>
                    </div>
                    <select
                      className="hp-input w-auto"
                      value={status.retention_months}
                      disabled={busy === "policy"}
                      onChange={(e) => void updatePolicy({ retention_months: Number(e.target.value) })}
                    >
                      {[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m} months</option>)}
                    </select>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-white/6 bg-navy-950/40 px-3 py-2.5">
                    <div>
                      <p className="text-[12px] font-medium text-white">Scheduled cleanup</p>
                      <p className="text-[10.5px] text-ink-400">Monthly job may run when enabled</p>
                    </div>
                    <button
                      onClick={() => void updatePolicy({ retention_enabled: !status.enabled })}
                      disabled={busy === "policy"}
                      className={`relative h-6 w-11 rounded-full transition-colors ${status.enabled ? "bg-mint-500" : "bg-white/15"}`}
                      aria-label="Toggle cleanup schedule"
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${status.enabled ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>

                  <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3">
                    <p className="text-[12px] font-medium text-white">University approval reference</p>
                    <p className="mb-2 text-[10.5px] text-ink-400">Required before the policy can be armed for automatic deletion.</p>
                    <div className="flex gap-2">
                      <input className="hp-input" placeholder="e.g. GSFC/DSA/2026/GYM-14" value={approval} onChange={(e) => setApproval(e.target.value)} />
                      <Button
                        variant="ghost"
                        loading={busy === "policy"}
                        disabled={approval.trim().length < 3}
                        onClick={() => void updatePolicy({ retention_armed: true, approved_by: approval, retention_enabled: true })}
                      >
                        <ShieldCheck size={14} /> Arm
                      </Button>
                    </div>
                    {status.armed ? (
                      <div className="mt-2 flex items-center justify-between">
                        <Chip tone="green">armed · {status.approved_by}</Chip>
                        <button className="text-[10.5px] text-[#ffb2a1] hover:underline" onClick={() => void updatePolicy({ retention_armed: false })}>
                          disarm
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-[10.5px] text-warn-400">Not armed — the scheduled job will only log a skip.</p>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <SectionTitle title="Manual controls" subtitle="Dry run is always safe — it never deletes" />
                <div className="space-y-2.5">
                  <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3">
                    <p className="text-[12px] font-medium text-white">1 · Dry run</p>
                    <p className="mb-2 text-[10.5px] text-ink-400">Preview exactly how many records would be archived and deleted.</p>
                    <Button variant="ghost" loading={busy === "dry"} onClick={() => void dryRun()}>
                      <PlayCircle size={14} /> Preview eligible records
                    </Button>
                    {preview ? (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mint-300">
                        <CheckCircle2 size={12} /> {preview.candidates} records older than {fmtDate(preview.cutoff)} (nothing deleted)
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-[#ff5e47]/25 bg-[#ff5e47]/5 p-3">
                    <p className="flex items-center gap-1.5 text-[12px] font-medium text-white"><AlertOctagon size={13} className="text-[#ff8f6b]" /> 2 · Execute cleanup</p>
                    <p className="mb-2 text-[10.5px] text-ink-400">
                      Runs the same code path as the cron job: summaries → verified backup → delete. Type <span className="font-mono text-white">DELETE</span> to confirm.
                    </p>
                    <div className="flex gap-2">
                      <input className="hp-input font-mono" placeholder="DELETE" value={confirmText} onChange={(e) => setConfirmText(e.target.value.toUpperCase())} />
                      <Button
                        variant="danger"
                        disabled={confirmText !== "DELETE" || !status.armed}
                        loading={busy === "run"}
                        onClick={() => void execute()}
                      >
                        <Trash2 size={14} /> Run now
                      </Button>
                    </div>
                    {!status.armed ? <p className="mt-1.5 text-[10px] text-warn-400">Arm the policy first — manual execution requires the same approval gate.</p> : null}
                  </div>

                  <div className="rounded-xl border border-white/6 bg-navy-950/40 p-3 text-[10.5px] leading-relaxed text-ink-400">
                    <p className="mb-1 font-semibold text-white">Schedule</p>
                    <p>pg_cron job <span className="font-mono">healthplex-monthly-attendance-retention</span> · next run {fmtDateTime(status.next_scheduled)}</p>
                    <p className="mt-1">Last successful execution: {status.last_execute ? `${fmtDateTime(status.last_execute.finished_at ?? status.last_execute.started_at)} (${status.last_execute.deleted_records ?? 0} deleted)` : "never"}</p>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}

          {tab === "history" ? (
            <Card className="mt-4 overflow-hidden">
              {runs.length === 0 ? (
                <div className="p-4"><EmptyState title="No cleanup runs yet" description="Dry runs and scheduled executions are recorded here with timestamps, counts and errors." icon={<DatabaseZap size={20} />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-ink-400">
                        <th className="px-4 py-2.5 font-semibold">Started</th>
                        <th className="px-3 py-2.5 font-semibold">Mode</th>
                        <th className="px-3 py-2.5 font-semibold">Trigger</th>
                        <th className="px-3 py-2.5 font-semibold">Cutoff</th>
                        <th className="px-3 py-2.5 font-semibold">Candidates</th>
                        <th className="px-3 py-2.5 font-semibold">Deleted</th>
                        <th className="px-3 py-2.5 font-semibold">Status</th>
                        <th className="px-3 py-2.5 font-semibold">Backup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id} className="border-b border-white/4 last:border-0">
                          <td className="px-4 py-2 text-white">{fmtDateTime(r.started_at)}</td>
                          <td className="px-3 py-2"><Chip tone={r.mode === "execute" ? "amber" : "blue"}>{r.mode}</Chip></td>
                          <td className="px-3 py-2 text-ink-400">{r.triggered_by}</td>
                          <td className="px-3 py-2 text-ink-400">{r.cutoff_date ? fmtDate(r.cutoff_date) : "—"}</td>
                          <td className="px-3 py-2 text-ink-400">{r.candidate_records ?? 0}</td>
                          <td className="px-3 py-2 text-ink-400">{r.deleted_records ?? 0}</td>
                          <td className="px-3 py-2">
                            <Chip tone={r.status === "success" ? "green" : r.status === "failed" ? "red" : r.status === "aborted" ? "gray" : "blue"}>{r.status}</Chip>
                            {r.error ? <p className="mt-0.5 max-w-[180px] truncate text-[10px] text-[#ffb2a1]" title={r.error}>{r.error}</p> : null}
                          </td>
                          <td className="px-3 py-2 text-ink-400">{r.backup_id ? "verified" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : null}

          {tab === "summaries" ? (
            <Card className="mt-4 p-4">
              <SectionTitle title="Historical monthly summaries" subtitle="Compact aggregates preserved after attendance records are purged" />
              {summaries.length === 0 ? (
                <EmptyState
                  title="No summaries generated yet"
                  description="Summaries are created automatically before the first cleanup, or by a dry run that includes the archive step."
                  icon={<FileWarning size={20} />}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-ink-400">
                        <th className="px-3 py-2 font-semibold">Month</th>
                        <th className="px-3 py-2 font-semibold">Visits</th>
                        <th className="px-3 py-2 font-semibold">Unique students</th>
                        <th className="px-3 py-2 font-semibold">Avg session</th>
                        <th className="px-3 py-2 font-semibold">Peak hour</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaries.map((s) => (
                        <tr key={`${s.year}-${s.month}`} className="border-b border-white/4 last:border-0">
                          <td className="px-3 py-2 text-white">{new Date(s.year, s.month - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</td>
                          <td className="px-3 py-2 text-ink-400">{s.total_visits}</td>
                          <td className="px-3 py-2 text-ink-400">{s.unique_students}</td>
                          <td className="px-3 py-2 text-ink-400">{s.avg_duration_minutes ? `${Math.round(Number(s.avg_duration_minutes))} min` : "—"}</td>
                          <td className="px-3 py-2 text-ink-400">{s.peak_hour != null ? `${String(s.peak_hour).padStart(2, "0")}:00` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : null}

          {tab === "backups" ? (
            <Card className="mt-4 p-4">
              <SectionTitle title="Verified backups" subtitle="Created before every destructive run and checksum-verified in the transaction" />
              {backups.length === 0 ? (
                <EmptyState title="No backups yet" description="A checksum-verified JSON snapshot is stored before any record is deleted." />
              ) : (
                <div className="space-y-2">
                  {backups.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/6 bg-navy-950/40 px-3 py-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-mint-500/12 text-mint-300"><ShieldCheck size={14} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-white">{b.record_count} attendance records · cutoff {fmtDate(b.cutoff_date)}</p>
                        <p className="truncate font-mono text-[10px] text-ink-400">sha256 {b.checksum.slice(0, 32)}… · {bytesLabel(b.storage_bytes)} · {timeAgo(b.created_at)}</p>
                      </div>
                      <Chip tone={b.verified ? "green" : "red"}>{b.verified ? "verified" : "unverified"}</Chip>
                      <button onClick={() => void downloadBackup(b)} className="hp-btn hp-btn-ghost px-2 py-1 text-[10.5px]">
                        <Download size={11} /> Export
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 rounded-xl border border-white/6 bg-navy-950/40 p-3 text-[10.5px] leading-relaxed text-ink-400">
                <p className="mb-1 font-semibold text-white">What is never deleted automatically</p>
                <p>Student master profiles · active student accounts · university enrollment IDs · user roles and permissions ·
                  current face enrollment templates for active students · gym configuration · trainer and staff profiles ·
                  equipment inventory · security and administrative audit records · monthly summaries and backups.
                  Biometric templates are only removed on consent withdrawal or legitimate enrollment removal — never by the six-month job.</p>
              </div>
            </Card>
          ) : null}

          <p className="mt-4 text-center text-[10.5px] text-ink-400/70">
            Acting as {profile?.full_name} · Super Admin · every policy change and execution is written to the audit log.
          </p>
        </>
      )}
    </Shell>
  );
}

export default function RetentionPage() {
  return (
    <StaffGuard roles={["super_admin"]}>
      <RetentionInner />
    </StaffGuard>
  );
}
