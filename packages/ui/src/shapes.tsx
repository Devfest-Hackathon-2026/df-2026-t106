import type { ReactNode, SVGProps } from "react";

/** Geometric brand shapes: flat Google colors, 2.5px ink outline. */
type P = SVGProps<SVGSVGElement>;
const INK = "#1e1e1e";
const S = { stroke: INK, strokeWidth: 2.5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

export function Logo(p: P) {
  return (
    <svg viewBox="0 0 48 48" width={40} height={40} {...p}>
      <path d="M24 4c-8.3 0-15 6.5-15 14.6C9 30 24 44 24 44s15-14 15-25.4C39 10.5 32.3 4 24 4Z" fill="#4285f4" {...S} />
      <circle cx="24" cy="18.5" r="6" fill="#ffd427" {...S} />
      <circle cx="40.5" cy="38" r="4" fill="#ea4335" {...S} />
      <circle cx="7.5" cy="38" r="4" fill="#34a853" {...S} />
    </svg>
  );
}

export function Dots({ colors = ["#4285f4", "#ea4335", "#f9ab00"], ...p }: P & { colors?: string[] }) {
  return (
    <svg viewBox={`0 0 ${colors.length * 36} 36`} height={36} {...p}>
      {colors.map((c, i) => <circle key={i} cx={18 + i * 36} cy={18} r={15} fill={c} {...S} />)}
    </svg>
  );
}

export function Brace({ children, className = "" }: { children?: ReactNode; className?: string }) {
  const b = (flip: boolean) => (
    <svg viewBox="0 0 16 56" className="h-[1.6em] w-auto" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M14 2c-6 0-7 3-7 8v10c0 4-2 7-5 8 3 1 5 4 5 8v10c0 5 1 8 7 8" fill="none" {...S} />
    </svg>
  );
  return <span className={`inline-flex items-center gap-2 leading-tight ${className}`}>{b(false)}<span>{children}</span>{b(true)}</span>;
}

export function Globe(p: P) {
  return (
    <svg viewBox="0 0 100 100" {...p}>
      <circle cx="50" cy="50" r="44" fill="#ccf6c5" {...S} />
      <ellipse cx="50" cy="50" rx="20" ry="44" fill="none" {...S} />
      <path d="M6 50h88M14 28h72M14 72h72M50 6v88" fill="none" {...S} />
    </svg>
  );
}

export function Asterisk(p: P) {
  return (
    <svg viewBox="0 0 60 60" {...p}>
      <path d="M30 4v52M4 30h52M11.6 11.6l36.8 36.8M48.4 11.6 11.6 48.4" fill="none" {...S} strokeWidth={3} />
    </svg>
  );
}

export function HalfMoon(p: P) {
  return (
    <svg viewBox="0 0 60 100" {...p}>
      <path d="M8 4a46 46 0 0 1 0 92V72a22 22 0 0 0 0-44Z" fill="#f9ab00" {...S} />
    </svg>
  );
}

export function Slashes(p: P) {
  return (
    <svg viewBox="0 0 100 100" {...p}>
      <path d="M30 6h18L26 94H8Z" fill="#c3ecf6" {...S} />
      <path d="M72 6h18L68 94H50Z" fill="#4285f4" {...S} />
    </svg>
  );
}

export function Lines(p: P) {
  return (
    <svg viewBox="0 0 100 60" {...p}>
      {[8, 30, 52].map((y) => <rect key={y} x="3" y={y - 6} width="94" height="12" rx="6" fill="#fff" {...S} />)}
    </svg>
  );
}

export function Pin({ color = "#ea4335", ...p }: P & { color?: string }) {
  return (
    <svg viewBox="0 0 60 80" {...p}>
      <path d="M30 4C16 4 5 14.5 5 28c0 18 25 48 25 48s25-30 25-48C55 14.5 44 4 30 4Z" fill={color} {...S} />
      <circle cx="30" cy="28" r="9" fill="#fff" {...S} />
    </svg>
  );
}

export function People({ count = 3, fill = "#fff", ...p }: P & { count?: number; fill?: string }) {
  return (
    <svg viewBox={`0 0 ${count * 44} 70`} {...p}>
      {Array.from({ length: count }, (_, i) => (
        <g key={i} transform={`translate(${i * 44} 0)`}>
          <circle cx="22" cy="16" r="12" fill={fill} {...S} />
          <path d="M3 66a19 19 0 0 1 38 0" fill="none" {...S} />
        </g>
      ))}
    </svg>
  );
}

export function ArrowUpRight(p: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

/** Rice bowl with chopsticks (lunch). Original shape, flat fill + ink stroke. */
export function Bowl({ fill = "#ffe7a5", ...p }: P & { fill?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="#1e1e1e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M19 4 26 13M24 3l4 9" />
      <path d="M4 15h24a12 11 0 0 1-24 0Z" fill={fill} />
      <path d="M11 27h10" />
    </svg>
  );
}

/** Pancake stack with butter (brunch). */
export function Pancakes({ fill = "#c3ecf6", ...p }: P & { fill?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="#1e1e1e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="5" y="20" width="22" height="6" rx="3" fill={fill} />
      <rect x="6" y="14" width="20" height="6" rx="3" fill={fill} />
      <rect x="7" y="8" width="18" height="6" rx="3" fill={fill} />
      <rect x="13" y="4.5" width="6" height="3.5" rx="1" fill="#ffd427" />
    </svg>
  );
}

/** Speech bubble with three dots (reviews). */
export function Bubble({ fill = "#c3ecf6", ...p }: P & { fill?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="#1e1e1e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 7h22v15H14l-6 5v-5H5Z" fill={fill} />
      <path d="M11 14.5h.01M16 14.5h.01M21 14.5h.01" strokeWidth={3.5} />
    </svg>
  );
}

/** Cloud (拡張機能 = the features that use our cloud): three bumps on a flat base, original shape. */
export function Cloud({ fill = "#fff", ...p }: P & { fill?: string }) {
  return (
    <svg viewBox="0 -1 33 22" width={33} height={22} {...p}>
      <path d="M9 19h15a6 6 0 0 0 .5-12a8 8 0 0 0-15-1.5a6.75 6.75 0 0 0-.5 13.5Z" fill={fill} {...S} />
    </svg>
  );
}

/** Dock icon for 問地圖: a map pin with a question mark (original shape, flat fill + ink stroke). */
export function AskPin({ fill = "#ffe7a5", ...p }: P & { fill?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="#1e1e1e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M16 3C10.5 3 6 7.3 6 12.8c0 7.2 10 16.2 10 16.2s10-9 10-16.2C26 7.3 21.5 3 16 3Z" fill={fill} />
      <path d="M13.2 10.6a2.9 2.9 0 1 1 4 2.6c-.8.4-1.2 1-1.2 1.8v.3" />
      <path d="M16 18.6h.01" strokeWidth={3.5} />
    </svg>
  );
}

/** Three-quarter arc; spins inside `.btn-busy`. */
export function Spinner(p: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" {...p}>
      <path d="M12 4a8 8 0 1 0 8 8" />
    </svg>
  );
}

export function ArrowDown(p: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}

/** Two stacked rounded sheets (copy to clipboard); same stroke as ArrowUpRight. */
export function CopyIcon(p: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="9" y="9" width="11" height="11" rx="3" />
      <path d="M15 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
    </svg>
  );
}
export function Check(p: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function LongArrow({ className = "" }: { className?: string }) {
  return (
    <span className={`flex h-6 items-center ${className}`}>
      <span className="-mr-3 h-[2.5px] flex-1 rounded bg-ink" />
      <svg viewBox="0 0 14 24" className="h-6 w-3.5 flex-none overflow-visible">
        <path d="M2 3l10 9-10 9" fill="none" {...S} />
      </svg>
    </span>
  );
}
