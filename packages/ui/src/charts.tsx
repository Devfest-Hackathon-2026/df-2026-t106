import { useState, type ReactNode } from "react";

/**
 * Categorical slots, validated with the dataviz validator (light mode, all checks PASS;
 * contrast WARN is relieved by ink outlines + always-visible labels). Order matters.
 */
export const CHART_SLOTS = ["#4285f4", "#ea4335", "#129eaf", "#e8a000", "#a142f4", "#34a853"] as const;
export const CHART_OTHER = "#9aa0a6";
const INK = "#1e1e1e";

export type PieDatum = { key: string; label: string; value: number; color: string };

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1} Z`;
}

/** Donut with ink outlines; legend with % is always visible (identity never color-alone). */
export function PieChart({ data, size = 180, center, label = "Share" }: { data: PieDatum[]; size?: number; center?: ReactNode; label?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = size / 2 - 4, cx = size / 2, cy = size / 2;
  let a = 0;
  const slices = data.map((d) => {
    const a0 = a; a += total ? (d.value / total) * Math.PI * 2 : 0;
    return { ...d, a0, a1: a };
  });
  const pct = (v: number) => (total ? Math.round((v / total) * 1000) / 10 : 0);
  const hv = slices.find((s) => s.key === hover);

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={label}>
          {total === 0 && <circle cx={cx} cy={cy} r={r} fill="#fff" stroke={INK} strokeWidth={2} strokeDasharray="6 6" />}
          {slices.length === 1 && <circle cx={cx} cy={cy} r={r} fill={slices[0].color} stroke={INK} strokeWidth={2} />}
          {slices.length > 1 && slices.map((s) => (
            <path
              key={s.key} d={arcPath(cx, cy, r, s.a0, s.a1)} fill={s.color} stroke={INK} strokeWidth={2} strokeLinejoin="round"
              opacity={hover && hover !== s.key ? 0.45 : 1}
              onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.label}: ${s.value} (${pct(s.value)}%)`}</title>
            </path>
          ))}
          <circle cx={cx} cy={cy} r={r * 0.52} fill="#fff" stroke={INK} strokeWidth={2} />
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {hv ? (
            <div><div className="text-[22px] font-bold leading-none">{pct(hv.value)}%</div><div className="mt-1 font-mono text-[10px] font-bold">{hv.label}</div></div>
          ) : center}
        </div>
      </div>
      <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1.5 p-0">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[13px] font-bold" onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
            <span className="h-3 w-3 flex-none rounded-full border-[1.5px] border-ink" style={{ background: s.color }} />
            <span className="truncate">{s.label}</span>
            <span className="ml-auto font-mono text-[12px] text-body">{pct(s.value)}%</span>
            <span className="w-8 text-right font-mono text-[11px] text-muted">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `tick` = the x-axis label under this point (e.g. "25Q2", "Q3"); `label` is what the tooltip shows. */
export type TrendPoint = { key: string; label: string; avg: number | null; count: number; estimated: boolean; tick?: string };

const MONO = "Google Sans Code, monospace";
/** Text that stays readable over lines: a white halo painted under the glyphs. */
const HALO = { paintOrder: "stroke" as const, stroke: "#fff", strokeWidth: 3, strokeLinejoin: "round" as const };

/**
 * Average stars per period (single series → no legend; title names it). Count is a second,
 * separate mini bar chart sharing the x-axis — never a dual y-axis.
 * Estimated / partial periods use hollow markers + dashed line.
 * Options: `yMin` (axis floor, default 1), `band` (a yellow-soft span from index `from` — fractional,
 * in point units — to the right edge, labelled on top), `refLine` (dashed level, e.g. the earlier
 * average), `mark` (point index drawn red and larger with its value), `hot` (count bar drawn red with a note).
 * Copy comes from the app (UI language): `label` (aria), `estimated` suffix, `count(n)` per period.
 */
export function TrendChart({ points, width = 360, height = 150, label = "Monthly average stars", estimated = " · est.", count = (n: number) => String(n), yMin = 1, band, refLine, mark, hot }: {
  points: TrendPoint[]; width?: number; height?: number; label?: string; estimated?: string; count?: (n: number) => string;
  yMin?: number; band?: { from: number; label: string } | null; refLine?: { value: number; label: string } | null;
  mark?: number | null; hot?: { index: number; label: string } | null;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const padL = 26, padR = 10, padT = band ? 22 : 10, barH = 30, gap = 10;
  const plotH = height - padT - barH - gap - 16;
  const n = points.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i * (width - padL - padR)) / (n - 1));
  const y = (v: number) => padT + ((5 - Math.max(yMin, v)) / (5 - yMin)) * plotH;
  const maxC = Math.max(1, ...points.map((p) => p.count));
  const barTop = padT + plotH + gap;
  const bw = Math.max(2, Math.min(16, (width - padL - padR) / Math.max(1, n) - 2));
  const levels = Array.from({ length: 5 - Math.ceil(yMin) + 1 }, (_, i) => Math.ceil(yMin) + i);
  const ticks = points.some((p) => p.tick);
  const bandX = band ? Math.max(4, Math.min(width - 24, x(band.from))) : 0;

  // line segments between consecutive months that both have data
  const segs: { d: string; dashed: boolean }[] = [];
  for (let i = 1; i < n; i++) {
    const a = points[i - 1], b = points[i];
    if (a.avg == null || b.avg == null) continue;
    segs.push({ d: `M${x(i - 1)},${y(a.avg)} L${x(i)},${y(b.avg)}`, dashed: a.estimated || b.estimated });
  }
  const yearTicks = points.map((p, i) => ({ p, i })).filter(({ p }) => p.label.endsWith("-01") || p.label.endsWith("/01"));
  const h = hi != null ? points[hi] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={label}
        onMouseLeave={() => setHi(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * width;
          const i = Math.round(((px - padL) / (width - padL - padR)) * (n - 1));
          setHi(i >= 0 && i < n ? i : null);
        }}>
        {band && (
          <g>
            <rect x={bandX} y={2} width={width - 2 - bandX} height={barTop + barH + 2 - 2} rx={12} fill="#ffe7a5" />
            <text x={(bandX + width - 2) / 2} y={14} textAnchor="middle" fontSize={9.5} fontWeight={700} fontFamily={MONO} fill={INK}>{band.label}</text>
          </g>
        )}
        {levels.map((v) => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke="#1e1e1e" strokeOpacity={v === 1 ? 0.5 : 0.1} strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fontFamily={MONO} fill="#5f6368">{v}</text>
          </g>
        ))}
        {!ticks && yearTicks.map(({ p, i }) => (
          <g key={p.key}>
            <line x1={x(i)} x2={x(i)} y1={padT} y2={barTop + barH} stroke="#1e1e1e" strokeOpacity={0.18} strokeDasharray="2 3" />
            <text x={x(i) + 3} y={height - 3} fontSize={10} fontFamily={MONO} fontWeight={700} fill="#5f6368">{p.label.slice(0, 4)}</text>
          </g>
        ))}
        {ticks && points.map((p, i) => p.tick && (
          <text key={p.key} x={x(i)} y={height - 3} textAnchor="middle" fontSize={9} fontWeight={p.tick.length > 2 ? 700 : 400} fontFamily={MONO} fill="#5f6368">{p.tick}</text>
        ))}
        {refLine && (
          <g>
            <line x1={padL} x2={width - padR} y1={y(refLine.value)} y2={y(refLine.value)} stroke={INK} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="4 4" />
            <text x={padL + 4} y={y(refLine.value) > padT + 14 ? y(refLine.value) - 5 : y(refLine.value) + 13} fontSize={9.5} fontWeight={700} fontFamily={MONO} fill="#3c4043" {...HALO}>{refLine.label}</text>
          </g>
        )}
        {/* count bars */}
        {points.map((p, i) => p.count > 0 && (
          <rect key={p.key} x={x(i) - bw / 2} y={barTop + barH - Math.max(2, (p.count / maxC) * barH)} width={bw} height={Math.max(2, (p.count / maxC) * barH)}
            rx={Math.min(2, bw / 2)} fill={hot?.index === i ? "#ea4335" : p.estimated ? "#c3ecf6" : "#4285f4"}
            stroke={hot?.index === i ? INK : undefined} strokeWidth={hot?.index === i ? 1.5 : undefined} opacity={hi != null && hi !== i ? 0.5 : 1} />
        ))}
        {hot && hot.index >= 0 && hot.index < n && (
          <text x={x(hot.index) > width / 2 ? x(hot.index) - bw / 2 - 5 : x(hot.index) + bw / 2 + 5} y={barTop + barH - 8}
            textAnchor={x(hot.index) > width / 2 ? "end" : "start"} fontSize={9.5} fontWeight={700} fontFamily={MONO} fill={INK} {...HALO}>{hot.label}</text>
        )}
        <line x1={padL} x2={width - padR} y1={barTop + barH} y2={barTop + barH} stroke="#1e1e1e" strokeOpacity={0.5} />
        {/* avg line */}
        {segs.map((s, i) => <path key={i} d={s.d} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeDasharray={s.dashed ? "4 4" : undefined} />)}
        {points.map((p, i) => p.avg != null && (
          <circle key={p.key} cx={x(i)} cy={y(p.avg)} r={hi === i || mark === i ? 5 : 3.5} fill={mark === i ? "#ea4335" : p.estimated ? "#fff" : "#ffd427"} stroke={INK} strokeWidth={1.5} />
        ))}
        {mark != null && points[mark]?.avg != null && (
          <text x={x(mark)} y={y(points[mark].avg!) + 17} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily={MONO} fill={INK} {...HALO}>{points[mark].avg!.toFixed(2)}</text>
        )}
        {hi != null && <line x1={x(hi)} x2={x(hi)} y1={padT} y2={barTop + barH} stroke={INK} strokeWidth={1} />}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-[12px] border-2 border-ink bg-white px-2.5 py-1.5 text-[12px] font-bold"
          style={{ left: `${Math.min(70, Math.max(0, (x(hi!) / width) * 100 - 15))}%` }}>
          <div className="font-mono text-[11px]">{h.label}{h.estimated ? estimated : ""}</div>
          <div>{h.avg != null ? `★ ${h.avg.toFixed(2)}` : "—"} <span className="text-muted">· {count(h.count)}</span></div>
        </div>
      )}
    </div>
  );
}
