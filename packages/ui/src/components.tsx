import { Fragment, useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type AnchorHTMLAttributes, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpRight, Check, Cloud, CopyIcon, Spinner } from "./shapes";

export type Tone = "blue" | "red" | "yellow" | "green" | "pink" | "white";
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

type BtnBase = { variant?: "default" | "primary"; size?: "sm" | "md" | "lg"; icon?: ReactNode };
const btnClass = ({ variant, size }: BtnBase, extra?: string) =>
  cx("btn", variant === "primary" && "btn-primary", size === "lg" && "btn-lg", size === "sm" && "btn-sm", extra);

/** `busy` swaps the arrow for a spinning arc (work in progress after a click). */
export function Button({ variant, size, icon, busy, children, className, ...rest }: BtnBase & { busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={btnClass({ variant, size }, cx(busy && "btn-busy", className))} aria-busy={busy || undefined} {...rest}>
      <span>{children}</span>
      <span className="btn-icon">{busy ? <Spinner /> : icon ?? <ArrowUpRight />}</span>
    </button>
  );
}

export function LinkButton({ variant, size, icon, children, className, ...rest }: BtnBase & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={btnClass({ variant, size }, cx("no-underline", className))} {...rest}>
      <span>{children}</span>
      <span className="btn-icon">{icon ?? <ArrowUpRight />}</span>
    </a>
  );
}

/**
 * Text the user must paste somewhere else (web pages can't link to chrome:// URLs): mono pill, case kept,
 * with the round ink circle of .btn as the copy button; shows a check for 1.5 s after copying.
 */
export function CopyField({ value, label = "Copy", doneLabel = "Copied", className }: {
  value: string; label?: string; doneLabel?: string; className?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  const copy = () => navigator.clipboard?.writeText(value).then(() => setDone(true), () => {});
  return (
    <span className={cx("copy-field", className)}>
      <code>{value}</code>
      <button type="button" className="copy-field-go" onClick={copy} title={done ? doneLabel : label} aria-label={`${done ? doneLabel : label}: ${value}`}>
        <span className="btn-icon">{done ? <Check /> : <CopyIcon />}</span>
      </button>
    </span>
  );
}

export function Chip({ children, variant, className }: { children: ReactNode; variant?: "dashed" | "ink"; className?: string }) {
  return <span className={cx("chip", variant === "dashed" && "chip-dashed", variant === "ink" && "chip-ink", className)}>{children}</span>;
}

export type StepState = "idle" | "active" | "done";
export type Step = { label: string; sub?: ReactNode; state: StepState };

/** Numbered steps on an ink rail (like the Tile row): the active one pulses yellow, done ones turn green with a check. */
export function StepRail({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cx("step-rail m-0 list-none p-0", className)} style={{ ["--steps" as string]: steps.length }}>
      {steps.map((s, i) => (
        <li key={i} className="step" data-state={s.state} aria-current={s.state === "active" ? "step" : undefined}>
          <span className="step-head">{String(i + 1).padStart(2, "0")}{s.state === "done" ? <Check /> : s.state === "active" ? <LiveDot /> : null}</span>
          <span className="step-label">{s.label}</span>
          {s.sub != null && <span key={String(s.state)} className="step-sub">{s.sub}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Pill bar with a tone fill; `value / max` of the width (an empty bar when max is 0).
 * `threshold` (same unit as value) draws an ink tick where a rule fires.
 */
export function Meter({ value, max, tone = "blue", threshold, label, className }: { value: number; max: number; tone?: Tone; threshold?: number; label?: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bar = (
    <span className={cx("meter block", `tone-${tone}`, threshold == null && className)} role="meter" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
      <span className="meter-fill" data-empty={pct === 0} data-full={pct >= 100} style={{ width: `${pct}%` }} />
    </span>
  );
  if (threshold == null) return bar;
  return (
    <span className={cx("meter-wrap block", className)}>
      {bar}
      <span className="meter-mark" aria-hidden style={{ left: `${max > 0 ? Math.min(100, (threshold / max) * 100) : 0}%` }} />
    </span>
  );
}

/**
 * One status tile. `pending` = still waiting (dashed, muted value, not clickable); `provisional` = a value
 * that may still change (dashed, ink value); `progress` (0–1) draws a small meter of how far along;
 * `waiting` adds blinking dots after the status (waiting for a service to answer).
 */
export type Signal = {
  key: string; label: string; value: ReactNode; status: ReactNode; tone?: Tone;
  pending?: boolean; provisional?: boolean; progress?: number; waiting?: boolean; onClick?: () => void;
};

/**
 * Status tiles on an ink rail: one per section of a report; a click opens that section.
 * While a run is going each tile says what it waits for; when it ends they take their tone one after another.
 */
export function SignalRow({ signals, label, className }: { signals: Signal[]; label?: string; className?: string }) {
  return (
    <nav className={cx("signal-row", className)} aria-label={label} style={{ ["--signals" as string]: signals.length }}>
      {signals.map((s, i) => (
        <button key={s.key} type="button" className={cx("signal", `tone-${s.tone ?? "white"}`)} data-pending={!!s.pending} data-provisional={!!s.provisional}
          onClick={s.onClick} disabled={s.pending} style={{ ["--i" as string]: i }}>
          <span className="signal-k">{s.label}</span>
          <span key={s.pending ? "wait" : "done"} className={cx("signal-v", !s.pending && "fade-up")}>{s.value}</span>
          <span className="signal-s">{s.status}{s.waiting && <BlinkDots />}</span>
          {s.progress != null && <span className="signal-meter" aria-hidden><span style={{ width: `${Math.round(Math.max(0, Math.min(1, s.progress)) * 100)}%` }} /></span>}
        </button>
      ))}
    </nav>
  );
}

/** Three dots blinking in turn: waiting for a reply. Takes the text color. */
export function BlinkDots({ className }: { className?: string }) {
  return <span className={cx("blink-dots", className)} aria-hidden><i /><i /><i /></span>;
}

/** A partial result stamped in place the moment it is final (green-soft pill, tilted, pops in once). */
export function Stamp({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("stamp", className)}>{children}</span>;
}

/** One calendar month of the timeline: the star ratings of its reviews and how many judged warning signs it has. */
export type TimelineMonth = { stars: number[]; warn: number };
const starColor = (s: number) => (s >= 4 ? "var(--color-green-half)" : s === 3 ? "var(--color-yellow-half)" : "var(--color-red)");

/**
 * Reviews per month, oldest month left: each review is a small pill colored by its stars (4–5 green-half,
 * 3 yellow-half, 1–2 red) stacked in its month; once a month holds more than `capacity` the columns become
 * stacked bars scaled to the busiest month. `scan` (0–1 from the left edge, null when done) is how far back
 * reading has got: an ink line with `scanLabel`, and the part left of it not read yet is dotted. `recentFrom`
 * (0–1) starts the yellow-soft recent band; `recentDone` stamps it. `ticks` label positions (0–1).
 */
export function ReviewTimeline({ months, scan, scanLabel, recentFrom, recentLabel, recentDone, ticks, title, legend, label, capacity = 11, className }: {
  months: TimelineMonth[]; scan: number | null; scanLabel?: string; recentFrom: number; recentLabel: string; recentDone?: boolean;
  ticks: { at: number; label: string }[]; title: string; legend: [string, string, string]; label: string; capacity?: number; className?: string;
}) {
  const n = Math.max(1, months.length);
  const busiest = Math.max(0, ...months.map((m) => m.stars.length));
  const bars = busiest > capacity;
  const pos = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10}%`;
  const tagStyle = scan == null ? undefined : scan < 0.1 ? { left: 0, transform: "none" } : scan > 0.9 ? { left: "auto", right: 0, transform: "none" } : undefined;
  return (
    <figure className={cx("m-0 flex flex-col gap-1.5", className)}>
      <figcaption className="flex items-center gap-2">
        <span className="font-mono text-[10px] font-bold tracking-[0.08em]">{title}</span>
        <span className="h-0.5 flex-1 bg-ink opacity-20" />
        <span className="timeline-key">
          <span className="timeline-dot" style={{ background: starColor(5) }} />{legend[0]}
          <span className="timeline-dot" style={{ background: starColor(3) }} />{legend[1]}
          <span className="timeline-dot" style={{ background: starColor(1) }} />{legend[2]}
        </span>
      </figcaption>
      <div className="timeline" role="img" aria-label={label} style={{ ["--months" as string]: n }}>
        <div className="timeline-plot">
          <div className="timeline-band" style={{ width: `calc(${pos(1 - recentFrom)} + 4px)` }}>
            <span className="timeline-band-tag">{recentLabel}{recentDone && <Stamp>✓</Stamp>}</span>
          </div>
          <div className="timeline-unread" style={{ width: pos(scan ?? 0) }} />
          <div className="timeline-cols">
            {months.map((m, i) => (
              <div key={i} className="timeline-col">
                {bars
                  ? [[4, 5], [3, 3], [1, 2]].map(([lo, hi]) => {
                      const k = m.stars.filter((s) => s >= lo && s <= hi).length;
                      return k > 0 && <span key={lo} className="timeline-bar" style={{ height: `${(k / busiest) * 100}%`, background: starColor(lo) }} />;
                    })
                  : m.stars.map((s, j) => <span key={j} className="timeline-dot" style={{ background: starColor(s) }} />)}
              </div>
            ))}
          </div>
          {scan != null && (
            <div className="timeline-scan" style={{ left: pos(scan) }}>
              {scanLabel && <span className="timeline-scan-tag" style={tagStyle}>{scanLabel}</span>}
            </div>
          )}
        </div>
        <div className="timeline-axis" />
        <div className="timeline-warn" aria-hidden>
          {months.map((m, i) => <span key={i}>{m.warn > 0 && <b>{m.warn}</b>}</span>)}
        </div>
        <div className="timeline-ticks" aria-hidden>
          {ticks.map((t) => <span key={t.label} style={t.at >= 0.95 ? { right: 0 } : { left: pos(t.at) }}>{t.label}</span>)}
        </div>
      </div>
    </figure>
  );
}

/**
 * Before → now on a pill track between `min` and `max` (stars 1–5 by default): small dashed dot = before,
 * ink dot in a tone ring = now, the segment between is red when it fell and green when it rose.
 * On mount the now dot travels from before to now and its ring pulses three times.
 */
export function Dumbbell({ before, now, min = 1, max = 5, label, className }: { before: number | null; now: number | null; min?: number; max?: number; label?: string; className?: string }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
  const both = before != null && now != null;
  const lo = both ? Math.min(before, now) : null, hi = both ? Math.max(before, now) : null;
  const fell = both && now < before;
  return (
    <span className={cx("dumbbell block", `tone-${fell ? "red" : "green"}`, className)} role="img" aria-label={label}>
      {lo != null && hi != null && <span className="dumbbell-seg" style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})`, transformOrigin: fell ? "right" : "left" }} />}
      {before != null && <span className="dumbbell-dot" style={{ left: at(before) }} />}
      {now != null && <span className="dumbbell-dot dumbbell-now" style={{ left: at(now), ["--from" as string]: at(before ?? now) }} />}
    </span>
  );
}

/** Legend for Dumbbell: the two marks inline, e.g. "○ 以前 → ● 直近". */
export function DumbbellKey({ before, now, className }: { before: string; now: string; className?: string }) {
  return (
    <span className={cx("dumbbell-key", className)}>
      <span className="dumbbell-key-before" aria-hidden />{before}<span aria-hidden>→</span><span className="dumbbell-key-now" aria-hidden />{now}
    </span>
  );
}

/** One cell per month (oldest left); `on` months get a tone dot, the last `recent` months sit on a yellow-soft band. */
export function MonthStrip({ on, recent = 0, tone = "red", label, className }: { on: boolean[]; recent?: number; tone?: Tone; label?: string; className?: string }) {
  const n = on.length, k = Math.min(recent, n);
  return (
    <span className={cx("month-strip", `tone-${tone}`, className)} role="img" aria-label={label} style={{ ["--months" as string]: n }}>
      {k > 0 && <span className="month-band" aria-hidden style={{ width: `calc((100% - ${(n - 1) * 3}px) * ${k} / ${n} + ${(k - 1) * 3 + 7}px)` }} />}
      {on.map((x, i) => <span key={i} className="month-cell" data-on={x} />)}
    </span>
  );
}

export type BandRow = { label: string; cells: ({ n: number; few?: boolean } | null)[] };

/** Bucketed values per period: rows = buckets (high first), columns = periods; a filled cell carries its count. */
export function BandGrid({ rows, cols, label, className }: { rows: BandRow[]; cols: string[]; label?: string; className?: string }) {
  return (
    <div className={cx("band-grid", className)} role="img" aria-label={label} style={{ ["--cols" as string]: cols.length }}>
      {rows.map((r) => (
        <Fragment key={r.label}>
          <span className="band-label">{r.label}</span>
          {r.cells.map((c, i) => <span key={i} className="band-cell" data-on={!!c} data-few={!!c?.few}>{c?.n}</span>)}
        </Fragment>
      ))}
      <span />
      {cols.map((c, i) => <span key={i} className="band-col">{c}</span>)}
    </div>
  );
}

/** A review quote in its original language (`lang`), with a mono meta line; `clamp` cuts it to 2 lines. */
export function Quote({ meta, children, lang, clamp }: { meta: ReactNode; children: ReactNode; lang?: string; clamp?: boolean }) {
  return (
    <figure className={cx("quote", clamp && "quote-clamp")}>
      <figcaption className="quote-meta">{meta}</figcaption>
      <blockquote className="quote-text" lang={lang}>{children}</blockquote>
    </figure>
  );
}

/** A finished background job in one line: check (or red "!") dot, two mono lines, an action on the right. */
export function StatusPill({ lines, bad, action, className }: { lines: [ReactNode, ReactNode?]; bad?: boolean; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("status-pill", className)}>
      <span className="check-pill-dot" data-bad={!!bad} aria-hidden>{bad ? "!" : <Check className="h-3 w-3" />}</span>
      <div className="status-pill-text"><div>{lines[0]}</div>{lines[1] != null && <div>{lines[1]}</div>}</div>
      {action}
    </div>
  );
}

/** Round 30px toggle that opens / closes a section (＋ / −). */
export function FoldButton({ open, onClick, label, className }: { open: boolean; onClick: () => void; label: string; className?: string }) {
  return (
    <button type="button" className={cx("fold-btn", className)} aria-expanded={open} aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden>
        <path d="M5 12h14" />{!open && <path d="M12 5v14" />}
      </svg>
    </button>
  );
}

/** A number that counts up/down to `value` (ease-out, ~600 ms) instead of jumping; `decimals` for ratings like 3.21. */
export function CountUp({ value, ms = 600, decimals = 0 }: { value: number; ms?: number; decimals?: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const from = shown, t0 = performance.now();
    if (from === value) return;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
      const x = from + (value - from) * e;
      setShown(decimals ? x : Math.round(x));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{decimals ? shown.toFixed(decimals) : shown.toLocaleString("ja-JP")}</>;
}

/** A selectable chip (multi-select filters): idle in its tone's soft color, pressed = ink. */
export function ChipButton({ children, pressed, tone = "white", onClick, disabled, title, className }: {
  children: ReactNode; pressed: boolean; tone?: Tone; onClick: () => void; disabled?: boolean; title?: string; className?: string;
}) {
  return (
    <button type="button" className={cx("chip chip-btn", `tone-${tone}`, className)} aria-pressed={pressed} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/**
 * Pill text field with the round ink submit circle of Button. Enter submits, except while an IME
 * (Japanese / Chinese input) is still composing.
 */
export function AskBar({ value, onChange, onSubmit, placeholder, busy, disabled, label = "送出", className }: {
  value: string; onChange: (v: string) => void; onSubmit: (v: string) => void;
  placeholder?: string; busy?: boolean; disabled?: boolean; label?: string; className?: string;
}) {
  const submit = (e: FormEvent) => { e.preventDefault(); if (!busy && !disabled && value.trim()) onSubmit(value.trim()); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault(); };
  return (
    <form className={cx("ask-bar", busy && "ask-bar-busy", className)} onSubmit={submit} aria-busy={busy || undefined}>
      <input value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={key} placeholder={placeholder} disabled={disabled} aria-label={placeholder ?? label} />
      <button type="submit" className="ask-bar-go" disabled={disabled || !value.trim()} aria-label={label}>
        <span className="btn-icon">{busy ? <Spinner /> : <ArrowUpRight />}</span>
      </button>
    </form>
  );
}

/** Pill with a green check circle; `bad` = red circle with "!" (a check that failed). */
export function CheckPill({ children, bad, className }: { children: ReactNode; bad?: boolean; className?: string }) {
  return (
    <span className={cx("check-pill", className)}>
      <span className="check-pill-dot" data-bad={!!bad} aria-hidden>{bad ? "!" : <Check className="h-3 w-3" />}</span>
      {children}
    </span>
  );
}

export function LiveDot() {
  return <span className="live-dot" aria-hidden />;
}

export function Card({ tone = "white", solid, label, art, children, className }: {
  tone?: Tone; solid?: boolean; label?: ReactNode; art?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <div className={cx("card", `tone-${tone}`, solid && "card-solid", className)}>
      {label && <Chip>{label}</Chip>}
      {art && <div className="card-art">{art}</div>}
      {children}
    </div>
  );
}

export function TabCard({ tab, children, className }: { tab: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("tab-card", className)}>
      <div className="tab-card-tab">{tab}</div>
      {children}
    </div>
  );
}

export function Tile({ tone = "blue", step, value, sub, label, meta }: {
  tone?: Tone; step?: string; value: ReactNode; sub?: string; label?: ReactNode; meta?: ReactNode;
}) {
  return (
    <div className={cx("tile", `tone-${tone}`)}>
      {step && <span className="tile-step">{step}</span>}
      <strong className="tile-value">{value}</strong>
      {sub && <span className="font-mono text-[11px] font-bold tracking-wider">{sub}</span>}
      {label && <span className="tile-label">{label}</span>}
      {meta && <span className="tile-meta">{meta}</span>}
    </div>
  );
}

export function SectionHeading({ index, kicker, title, desc }: { index: string; kicker: string; title: ReactNode; desc?: ReactNode }) {
  return (
    <header className="sec-head">
      <div className="sec-head-meta">
        <span className="sec-index">{index}</span>
        <span className="sec-kicker">{kicker}</span>
        <span className="sec-rule" />
      </div>
      <h2 className="sec-title">{title}</h2>
      {desc && <p className="sec-desc">{desc}</p>}
    </header>
  );
}

const SEP_COLORS = ["#4285f4", "#ea4335", "#f9ab00", "#34a853"];
function MarqueeRow({ items, className }: { items: string[]; className: string }) {
  const group = (hidden?: boolean) => (
    <div className="marquee-group" aria-hidden={hidden}>
      {items.map((t, i) => (
        <span key={i} className="flex items-center gap-7">
          <span className="marquee-sep" style={{ background: SEP_COLORS[i % 4] }} />
          <span className="marquee-item">{t}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={cx("marquee-band", className)}>
      <div className="marquee-track">{group()}{group(true)}{group(true)}{group(true)}</div>
    </div>
  );
}

export function Marquee({ top, bottom }: { top: string[]; bottom?: string[] }) {
  return (
    <div className="marquee">
      <MarqueeRow items={top} className="marquee-ink" />
      <MarqueeRow items={bottom ?? top} className="marquee-yellow" />
    </div>
  );
}

export function SegToggle<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg-toggle" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * On/off switch (popup flags): an ink knob slides along a pill that turns green-soft when on.
 * `cloud` (拡張機能): turning it on blinks three dots ("connecting"), then a cloud pops onto the knob.
 * Motion plays only after a click, never when the switch first appears with its stored value.
 */
export function Switch({ on, onChange, label, onText = "ON", offText = "OFF", cloud }: {
  on: boolean; onChange: (on: boolean) => void; label: string; onText?: string; offText?: string; cloud?: boolean;
}) {
  const [live, setLive] = useState(false);
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={cx("switch", cloud && "switch-cloud", live && "is-live")} onClick={() => { setLive(true); onChange(!on); }}>
      {cloud && <span className="switch-dots" aria-hidden><i /><i /><i /></span>}
      <span className="switch-text" aria-hidden>{on ? onText : offText}</span>
      <span className="switch-knob" aria-hidden>{cloud && <Cloud className="switch-cloud-icon" />}</span>
    </button>
  );
}

export type DockTool = { id: string; label: string; icon: ReactNode; active?: boolean; disabled?: boolean; badge?: ReactNode; title?: string };

/** Vertical tool stack pinned to the map's right edge; each tool opens its own panel. `toggle` = master ON/OFF on top. */
export function ToolDock({ tools, onSelect, toggle, className }: {
  tools: DockTool[]; onSelect: (id: string) => void; className?: string;
  toggle?: { on: boolean; onChange: (on: boolean) => void; title?: string };
}) {
  return (
    <nav className={cx("tool-dock", className)} aria-label="Tools">
      {toggle && (
        <button type="button" className="tool-dock-switch" aria-pressed={toggle.on} title={toggle.title} onClick={() => toggle.onChange(!toggle.on)}>
          {toggle.on ? "ON" : "OFF"}
        </button>
      )}
      {tools.map((t) => (
        <button key={t.id} type="button" className="tool-dock-btn" aria-pressed={!!t.active} disabled={t.disabled} title={t.title ?? t.label} onClick={() => onSelect(t.id)}>
          <span className="tool-dock-icon">{t.icon}</span>
          <span className="tool-dock-label">{t.label}</span>
          {t.badge != null && <span className="tool-dock-badge">{t.badge}</span>}
        </button>
      ))}
    </nav>
  );
}

export function ColorBar() {
  return <div className="colorbar"><span /><span /><span /><span /></div>;
}

export function Countdown({ to, units = ["日", "時", "分", "秒"] }: { to: Date; units?: [string, string, string, string] | string[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((to.getTime() - now) / 1000));
  const parts = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
  const tones: Tone[] = ["blue", "red", "yellow", "green"];
  return (
    <div className="flex flex-wrap items-baseline gap-2 sm:gap-3">
      {parts.map((n, i) => (
        <span key={i} className={cx("count-part", `tone-${tones[i]}`)}>
          <strong>{String(n).padStart(2, "0")}</strong>
          <span className="count-unit">{units[i]}</span>
        </span>
      ))}
    </div>
  );
}
