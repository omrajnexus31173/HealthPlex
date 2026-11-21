"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { initials, percent } from "@/lib/format";

export function Card({ children, className = "", hover = false }: { children: React.ReactNode; className?: string; hover?: boolean }) {
  return <div className={`hp-card ${hover ? "transition-transform duration-200 hover:-translate-y-0.5" : ""} ${className}`}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-white">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "mint" | "warn" | "danger";
  loading?: boolean;
}) {
  const tones: Record<string, string> = {
    default: "text-white",
    mint: "text-mint-400",
    warn: "text-warn-400",
    danger: "text-alert-400",
  };
  return (
    <Card className="p-4" hover>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-400">{label}</p>
        {icon ? <span className="text-ink-400">{icon}</span> : null}
      </div>
      {loading ? (
        <div className="hp-skeleton mt-3 h-8 w-20" />
      ) : (
        <p className={`mt-2 text-[26px] font-semibold leading-none tracking-tight ${tones[tone]}`}>{value}</p>
      )}
      {hint ? <p className="mt-2 text-[11px] text-ink-400">{hint}</p> : null}
    </Card>
  );
}

const CHIP_STYLES: Record<string, string> = {
  green: "bg-mint-500/12 text-mint-300 border-mint-500/30",
  red: "bg-[#ff5e47]/12 text-[#ffb2a1] border-[#ff5e47]/30",
  amber: "bg-warn-400/12 text-warn-400 border-warn-400/30",
  blue: "bg-sky-400/12 text-sky-300 border-sky-400/30",
  gray: "bg-white/5 text-ink-400 border-white/10",
  violet: "bg-violet-400/12 text-violet-300 border-violet-400/30",
};

export function Chip({ tone = "gray", children }: { tone?: keyof typeof CHIP_STYLES; children: React.ReactNode }) {
  return <span className={`hp-chip ${CHIP_STYLES[tone] ?? CHIP_STYLES.gray}`}>{children}</span>;
}

export function Avatar({
  name,
  url,
  size = 36,
  tone = "mint",
}: {
  name: string;
  url?: string | null;
  size?: number;
  tone?: "mint" | "slate";
}) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.36) };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} style={style} className="shrink-0 rounded-full object-cover ring-1 ring-white/15" />;
  }
  return (
    <span
      style={style}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset ${
        tone === "mint" ? "bg-mint-500/15 text-mint-300 ring-mint-500/30" : "bg-white/6 text-ink-400 ring-white/10"
      }`}
    >
      {initials(name) || "?"}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-ink-400">{icon}</div> : null}
      <p className="text-sm font-semibold text-white">{title}</p>
      {description ? <p className="max-w-sm text-xs text-ink-400">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`hp-skeleton ${className}`} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-9" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const map = {
    info: { cls: "border-sky-400/25 bg-sky-400/8", icon: <Info size={16} className="text-sky-300" /> },
    success: { cls: "border-mint-500/30 bg-mint-500/8", icon: <CheckCircle2 size={16} className="text-mint-400" /> },
    warning: { cls: "border-warn-400/30 bg-warn-400/8", icon: <AlertTriangle size={16} className="text-warn-400" /> },
    danger: { cls: "border-[#ff5e47]/30 bg-[#ff5e47]/8", icon: <XCircle size={16} className="text-[#ffb2a1]" /> },
  } as const;
  const conf = map[tone];
  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3 ${conf.cls}`}>
      <span className="mt-0.5">{conf.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-white">{title}</p>
        {children ? <div className="mt-1 text-xs leading-relaxed text-ink-400">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  loading,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`hp-btn ${
        variant === "primary" ? "hp-btn-primary" : variant === "danger" ? "hp-btn-danger" : "hp-btn-ghost"
      } ${className}`}
    >
      {loading ? <Loader2 size={15} className="hp-spin" /> : null}
      {children}
    </button>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-white/8 bg-navy-950/50 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === t.id ? "bg-mint-500/15 text-mint-300" : "text-ink-400 hover:text-white"
          }`}
        >
          {t.label}
          {t.count != null ? <span className="ml-1.5 opacity-70">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, tone = "mint" }: { value: number; tone?: "mint" | "warn" | "danger" }) {
  const color = tone === "mint" ? "bg-mint-500" : tone === "warn" ? "bg-warn-400" : "bg-[#ff5e47]";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function CapacityBar({ inside, capacity }: { inside: number; capacity: number }) {
  const pct = percent(inside, capacity);
  const tone = pct >= 95 ? "danger" : pct >= 75 ? "warn" : "mint";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Occupancy</span>
        <span className="font-semibold text-white">
          {inside} / {capacity} · {pct}%
        </span>
      </div>
      <Progress value={pct} tone={tone} />
    </div>
  );
}

export function LinkButton({ href, children, variant = "ghost" }: { href: string; children: React.ReactNode; variant?: "primary" | "ghost" }) {
  return (
    <Link href={href} className={`hp-btn ${variant === "primary" ? "hp-btn-primary" : "hp-btn-ghost"}`}>
      {children}
    </Link>
  );
}
