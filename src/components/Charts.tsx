"use client";

/** Dependency-free SVG charts sized for dashboards (crisp, responsive, no layout shift). */

export function AreaChart({
  data,
  height = 190,
  label,
  color = "#4fe0a2",
  formatX = (v: string) => v,
}: {
  data: { label: string; value: number }[];
  height?: number;
  label?: string;
  color?: string;
  formatX?: (v: string) => string;
}) {
  const w = 720;
  const h = height;
  const pad = { l: 34, r: 12, t: 12, b: 24 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? (w - pad.l - pad.r) / (data.length - 1) : 0;
  const y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const pts = data.map((d, i) => [pad.l + i * stepX, y(d.value)] as const);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pad.l + (data.length - 1) * stepX},${h - pad.b} L${pad.l},${h - pad.b} Z`;
  const ticks = [0, Math.round(max / 2), max];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={label ?? "chart"}>
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="#7f8ea8">
            {t}
          </text>
        </g>
      ))}
      <path d={area} fill={`url(#grad-${color.replace("#", "")})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={data.length > 20 ? 1.6 : 2.8} fill="#04091a" stroke={color} strokeWidth="1.6" />
      ))}
      {data.map((d, i) =>
        i % Math.ceil(data.length / 7) === 0 ? (
          <text key={d.label} x={pad.l + i * stepX} y={h - 6} textAnchor="middle" fontSize="9.5" fill="#7f8ea8">
            {formatX(d.label)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function BarsChart({
  data,
  height = 190,
  color = "#21c98a",
  horizontal = false,
  formatLabel,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  horizontal?: boolean;
  formatLabel?: (v: string) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (horizontal) {
    return (
      <div className="space-y-2.5">
        {data.map((d) => (
          <div key={d.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="truncate text-ink-400">{formatLabel ? formatLabel(d.label) : d.label}</span>
              <span className="shrink-0 font-semibold text-white">{d.value}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/6">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(d.value / max) * 100}%`, background: `linear-gradient(90deg, ${color}, ${color}99)` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const w = 720;
  const h = height;
  const pad = { l: 30, r: 8, t: 10, b: 22 };
  const bw = (w - pad.l - pad.r) / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={pad.l} x2={w - pad.r} y1={pad.t + f * (h - pad.t - pad.b)} y2={pad.t + f * (h - pad.t - pad.b)} stroke="rgba(255,255,255,0.06)" />
      ))}
      {data.map((d, i) => {
        const bh = (d.value / max) * (h - pad.t - pad.b);
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={pad.l + i * bw + bw * 0.18}
              y={h - pad.b - bh}
              width={bw * 0.64}
              height={Math.max(1, bh)}
              rx={3}
              fill={color}
              opacity={0.85}
            />
            {i % Math.ceil(data.length / 12) === 0 ? (
              <text x={pad.l + i * bw + bw / 2} y={h - 6} textAnchor="middle" fontSize="8.5" fill="#7f8ea8">
                {d.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({
  slices,
  size = 150,
  centerLabel,
  centerValue,
}: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="11" />
          {slices.map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="11"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
              />
            );
            offset += len;
            return el;
          })}
        </g>
        {centerValue ? (
          <>
            <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="17" fontWeight="600" fill="#fff">
              {centerValue}
            </text>
            <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize="9" fill="#7f8ea8">
              {centerLabel}
            </text>
          </>
        ) : null}
      </svg>
      <div className="min-w-0 space-y-1.5">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[11.5px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="truncate text-ink-400">{s.label}</span>
            <span className="ml-auto font-semibold text-white">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ values, color = "#4fe0a2", height = 34 }: { values: number[]; color?: string; height?: number }) {
  if (!values.length) return null;
  const w = 120;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - (v / max) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height} className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
