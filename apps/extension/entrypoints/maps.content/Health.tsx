import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BandGrid, BlinkDots, Button, CheckPill, Chip, ChipButton, CountUp, Dumbbell, DumbbellKey, FoldButton, LiveDot, Meter, MonthStrip, PieChart, Quote, ReviewTimeline,
  SignalRow, Stamp, StatusPill, TrendChart, type BandRow, type Signal, type Tone, type TrendPoint,
} from "@gmap/ui";
import { holdAsk } from "@/lib/askPause";
import { classifyRemote, CONTEXT_GONE, QUOTA, warmClassify } from "@/lib/classifyRemote";
import {
  BURST, bandMove, health as computeHealth, monthKey, monthKeys, priceBand, quarterKey, quarterSpan, replyFlags, timelineMonths, verdictOf,
  VERDICT_DELTA, WARNINGS, WINDOW_DAYS, type Category, type Health, type PriceBand, type VerdictLevel, type Verdict,
} from "@/lib/health";
import { collectReviews, placeCid, type CollectStatus } from "@/lib/reviewFeed";
import type { TapReview } from "@/lib/reviewTap";
import { reviewLanguages } from "@/lib/reviewLangs";
import { langName } from "@/lib/i18n";
import { useT, type T } from "@/lib/i18n/useT";
import { ADVANCED_DEFAULT, ADVANCED_KEY } from "@/lib/advanced";
import { PanelShell, Stat, useDevMode, useStoredFlag } from "./parts";

/*
 * 「お店の今」panel: how the place is doing now versus before, plus warning signs. Reviews come from
 * the passive payload (lib/reviewFeed.ts); verdicts from services/classify through the background,
 * only while 拡張機能 is on (lib/advanced.ts). Every other section is 基本機能 and runs here.
 * Sections rotate tones blue → red → yellow → green (DESIGN.md §2).
 */
const WINDOW_MONTHS = 24;
const MAX_REVIEWS = 300;
const CLASSIFY_EVERY = 25;      // send a batch once this many judged-able reviews are waiting
const CLASSIFY_DEBOUNCE = 900;
const HOLD_ASK_MAX_MS = 3 * 60_000;
const log = (...a: unknown[]) => console.log("[GMAP]", ...a);

type Phase = "idle" | "running" | "done" | "error";
type Status = { code: CollectStatus | "stopped" | "error" | ""; message?: string };

function useHealthRun() {
  const reviews = useRef<TapReview[]>([]);
  const reachedAt = useRef<number | null>(null); // oldest last-edit time among pages loaded after the sort switch
  const runCid = useRef<string | null>(null);     // the place the current result belongs to
  const langColors = useRef(new Map<string, string>()); // one map per run: a language keeps its color while reviews stream in
  const verdicts = useRef(new Map<string, Verdict>());
  const inflight = useRef(new Set<string>());
  const sweeps = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<Status>({ code: "" });
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);
  const [tick, setTick] = useState(0);
  const bump = () => setTick((x) => x + 1);
  const cloud = useStoredFlag(ADVANCED_KEY, ADVANCED_DEFAULT);
  const cloudRef = useRef(cloud);
  cloudRef.current = cloud;

  async function flush(signal: AbortSignal) {
    if (!cloudRef.current) return;
    const todo = reviews.current.filter((r) => r.text && !verdicts.current.has(r.id) && !inflight.current.has(r.id));
    if (!todo.length) return;
    todo.forEach((r) => inflight.current.add(r.id));
    setJudging(true);
    try {
      const got = await classifyRemote(todo.map((r) => ({ id: r.id, text: r.text! })));
      if (!signal.aborted) { got.forEach((v, id) => verdicts.current.set(id, v)); setClassifyError(null); }
      log("classify", todo.length, "sent →", got.size, "verdicts", { missing: todo.filter((r) => !got.has(r.id)).map((r) => r.id.slice(0, 10)) });
    } catch (e) {
      if (!signal.aborted) setClassifyError((e as Error).message);
    } finally {
      todo.forEach((r) => inflight.current.delete(r.id));
      setJudging(inflight.current.size > 0);
      bump();
      // sweep: batches and page loads interleave, so a review can slip past every batch — send the rest
      if (!signal.aborted && inflight.current.size === 0) {
        const left = reviews.current.filter((r) => r.text && !verdicts.current.has(r.id));
        if (left.length && sweeps.current < 3) {
          sweeps.current++;
          log("classify sweep", sweeps.current, left.length, left.slice(0, 3).map((r) => ({ id: r.id.slice(0, 8), len: r.text!.length, at: new Date(r.publishedAt).toISOString().slice(0, 10) })));
          void flush(signal);
        }
      }
    }
  }

  function schedule(signal: AbortSignal, now = false) {
    if (!cloudRef.current) return;
    const waiting = reviews.current.filter((r) => r.text && !verdicts.current.has(r.id) && !inflight.current.has(r.id)).length;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!waiting) return;
    if (now || waiting >= CLASSIFY_EVERY) void flush(signal);
    else timer.current = window.setTimeout(() => void flush(signal), CLASSIFY_DEBOUNCE);
  }

  async function start() {
    ctrl.current?.abort();
    const ac = (ctrl.current = new AbortController());
    reviews.current = []; verdicts.current = new Map(); inflight.current = new Set(); sweeps.current = 0; langColors.current = new Map(); reachedAt.current = null;
    runCid.current = placeCid();
    setPhase("running"); setStatus({ code: "" }); setClassifyError(null);
    if (cloudRef.current) warmClassify(); // the cold start (~5 s) overlaps opening + sorting the list
    const t0 = performance.now();
    try {
      await collectReviews({
        maxMonths: WINDOW_MONTHS, maxN: MAX_REVIEWS, signal: ac.signal,
        onUpdate: (rs, st, at) => { reviews.current = rs; reachedAt.current = at ?? null; setStatus({ code: st }); schedule(ac.signal); bump(); },
      });
      if (ac.signal.aborted) return;
      schedule(ac.signal, true);
      setPhase("done");
      log("reviews collected", { n: reviews.current.length, withText: reviews.current.filter((r) => r.text).length, seconds: Math.round((performance.now() - t0) / 1000) });
    } catch (e) {
      if (ac.signal.aborted) return;
      setStatus({ code: "error", message: (e as Error).message }); setPhase("error");
      schedule(ac.signal, true);
    }
  }

  function stop() { ctrl.current?.abort(); setPhase("done"); setStatus({ code: "stopped" }); }

  /** Forget the last place's run (another place was opened): abort it and go back to idle. Late verdicts of the old run are dropped (its signal is aborted). */
  function reset() {
    ctrl.current?.abort(); ctrl.current = null;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    reviews.current = []; verdicts.current = new Map(); inflight.current = new Set(); sweeps.current = 0; langColors.current = new Map(); reachedAt.current = null;
    runCid.current = null;
    setPhase("idle"); setStatus({ code: "" }); setClassifyError(null); setJudging(false); bump();
  }

  // Maps opens another place without a page load (pushState, no event in this world): follow the place id in the URL
  const [cid, setCid] = useState<string | null>(() => placeCid());
  useEffect(() => {
    const t = window.setInterval(() => { const c = placeCid(); setCid((x) => (x === c ? x : c)); }, 500);
    return () => clearInterval(t);
  }, []);

  // 問地圖 waits until this place's reviews are loaded and classified (lib/askPause); a cap keeps a
  // request that never answers from stopping it for good
  const busy = phase === "running" || judging;
  useEffect(() => {
    if (!busy) return;
    const release = holdAsk();
    const cap = window.setTimeout(release, HOLD_ASK_MAX_MS);
    return () => { clearTimeout(cap); release(); };
  }, [busy]);

  // 拡張機能 switched on while the panel is open: classify what is already loaded
  useEffect(() => {
    const sig = ctrl.current?.signal;
    if (cloud) warmClassify();
    if (cloud && sig && !sig.aborted) schedule(sig, true);
  }, [cloud]); // eslint-disable-line react-hooks/exhaustive-deps

  // while loading, pass how far back the newest-first reading has got so the "now" window is not widened too early
  const result = useMemo(() => computeHealth(reviews.current, verdicts.current, Date.now(), undefined, phase === "running" || status.code === "stopped" ? reachedAt.current : undefined), [tick, phase, status.code]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    result, phase, status, classifyError, judging, cloud, start, stop, reset, cid, runCid: runCid.current,
    reviews: reviews.current, langColors: langColors.current, reachedAt: reachedAt.current,
  };
}

export function StoreHealth({ open, onClose }: { open: boolean; onClose: () => void }) {
  const a = useHealthRun();
  // another place: drop the last store's result at once (open or not); with the panel open, analyse the new place
  useEffect(() => {
    if (a.cid != null && a.runCid != null && a.runCid !== a.cid) a.reset(); // a URL without a place id (map moved) is not a new place
    else if (open && a.cid && a.phase === "idle") void a.start();
  }, [open, a.cid, a.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // keyed by place, so folded sections and opened quotes start fresh too
  return open ? <Panel key={a.runCid ?? "idle"} a={a} onClose={onClose} /> : null;
}

/*
 * Panel layout (DESIGN.md §7 「お店の今」): one status line → the verdict card (headline, rating now
 * vs before, a signal tile per section) → 01 rating trend → 02 warning signs → 03 price → 04 trust.
 * Sections with nothing to say start folded; while reviews load every section is folded.
 */
type Run = ReturnType<typeof useHealthRun>;
type SecId = "rating" | "warn" | "price" | "trust" | "lang";
const ROW_CATS: Category[] = [...WARNINGS, "improvement"];
const ASPECTS = ["food", "service", "atmosphere"] as const;
const LEVEL_BG: Record<Exclude<VerdictLevel, "none">, string> = { alert: "bg-red-soft", caution: "bg-yellow-soft", good: "bg-green-soft" };
const QUOTES_MAX = 8;
/** Earlier reviews needed before a provisional comparison is shown (16 gave ▲0.15 on a store that ended at ▼0.59). */
const MIN_BEFORE = 30;
/** Price answers needed on each side before a provisional price move is shown. */
const MIN_PRICE = 5;
const MOVE_MARK = { up: "▲", down: "▼", same: "＝" } as const;

const ym = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}/${d.getMonth() + 1}`; };
const pct = (x: number) => Math.round(x * 100);
const two = (x: number | null) => (x == null ? "—" : x.toFixed(2));
const deltaShort = (d: number) => (Math.abs(d) < 0.05 ? "＝" : `${d < 0 ? "▼" : "▲"}${Math.abs(d).toFixed(2)}`);
const deltaText = (d: number | null) => (d == null ? "—" : Math.abs(d) < 0.05 ? "＝" : `${d < 0 ? "▼" : "▲"} ${Math.abs(d).toFixed(2)}`);
/** "25Q2" on the first quarter and on each Q1, else "Q3". */
const tick = (key: string, i: number) => (i === 0 || key.endsWith("Q1") ? key.slice(2).replace("-", "") : key.slice(5));
const bandOf = (lo: number): PriceBand => (lo >= 10_000 ? { lo, hi: null } : { lo, hi: lo + 1000 });

function statusText({ t }: T, a: Run) {
  const st = a.status;
  if (st.code === "error") return st.message === "no-sort-button" ? t.review.errNoSortButton : st.message === "no-sort-menu" ? t.review.errNoSortMenu : st.message ?? "";
  return st.code ? t.review.status[st.code] : t.review.preparing;
}

function Delta({ d, className = "" }: { d: number | null; className?: string }) {
  if (d == null) return null;
  const up = d >= 0.05, down = d <= -0.05;
  return <Chip className={`${up ? "bg-green-soft" : down ? "bg-red-soft" : "bg-paper"} ${className}`}>{up ? "▲" : down ? "▼" : "＝"} {Math.abs(d).toFixed(2)}</Chip>;
}

function Chevron({ open }: { open: boolean }) {
  return <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} /></svg>;
}

function StopIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><rect x={6} y={6} width={12} height={12} rx={2} fill="currentColor" /></svg>;
}

/** The judging service failed. After an extension reload the tab must reload too: say so and offer the button. */
function ClassifyError({ error }: { error: string }) {
  const { t } = useT();
  if (error === QUOTA) return <p className="m-0 px-2 text-[12px] font-bold text-red">{t.review.classifyQuota}</p>;
  if (error !== CONTEXT_GONE) return <p className="m-0 px-2 text-[12px] font-bold text-red">{t.review.classifyError(error)}</p>;
  return (
    <div className="fade-up flex flex-col gap-2 rounded-[20px] border-2 border-ink bg-red-soft p-3">
      <p className="m-0 text-[13px] font-bold">{t.review.errReloaded}</p>
      <Button size="sm" variant="primary" className="self-start" onClick={() => location.reload()}>{t.review.reloadPage}</Button>
    </div>
  );
}

/** A numbered section card; folded it is one row: number, title, a mono summary, ＋. */
function Section({ index, kicker, title, tone, open, onToggle, summary, aside, live, sref, children }: {
  index: string; kicker: string; title: string; tone: Tone; open: boolean; onToggle: () => void;
  summary: ReactNode; aside?: ReactNode; live?: boolean; sref: (el: HTMLElement | null) => void; children: ReactNode;
}) {
  const { t } = useT();
  if (!open) {
    return (
      <section ref={sref} className={`card tone-${tone} min-h-0 flex-row items-center gap-2.5 py-2.5 pr-2.5 pl-3`}>
        <span className="sec-index h-7 min-w-11 text-[11px]">{index}</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="m-0 text-[16px] font-bold tracking-tight">{title}</h3>
          <span className="truncate font-mono text-[10.5px] font-bold text-body">{summary}</span>
        </div>
        <span className="ml-auto flex flex-none items-center gap-2.5">
          {live && <LiveDot />}
          <FoldButton open={false} onClick={onToggle} label={t.review.expand} />
        </span>
      </section>
    );
  }
  return (
    <section ref={sref} className={`card tone-${tone} min-h-0 gap-3 p-4`}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="sec-index h-7 min-w-11 text-[11px]">{index}</span>
          <span className="sec-kicker text-[11px]">{kicker}</span>
          <span className="sec-rule" />
          <FoldButton open onClick={onToggle} label={t.review.collapse} />
        </div>
        <div className="flex items-baseline gap-2">
          <h3 className="m-0 text-[22px] font-bold tracking-tight">{title}</h3>
          {aside && <span className="ml-auto font-mono text-[10.5px] font-bold text-muted">{aside}</span>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Panel({ a, onClose }: { a: Run; onClose: () => void }) {
  const tt = useT();
  const { t } = tt;
  const dev = useDevMode();
  const h: Health = a.result;
  const place = document.title.split(" - ")[0];
  const loading = a.phase === "running";
  const busy = loading || a.judging;
  const cloud = a.cloud;
  const judged = h.classified;
  const v = verdictOf(h);
  const st = a.status;
  const d = h.rating.delta;
  // reviews arrive newest first: the recent window is complete once the sorted reading has gone past it
  // (the relevance page Maps loads before the sort holds old reviews too, so h.span cannot tell)
  const reached = a.reachedAt;
  // 停止 before the end: the result is partial, shown with the same provisional language as while loading
  const stopped = !loading && st.code === "stopped";
  const partial = loading || stopped;
  const nowReady = !partial || (reached != null && reached < h.now.from);
  const opening = loading && (!st.code || st.code === "opening");
  const connecting = cloud && a.judging && judged === 0;
  const windowStart = h.asOf - WINDOW_DAYS * 86400e3;
  const frac = (ms: number) => Math.max(0, Math.min(1, (ms - windowStart) / (h.asOf - windowStart)));
  const coverage = !partial ? 1 : Math.max(reached != null ? 1 - frac(reached) : 0, h.n / MAX_REVIEWS);
  const judgedShare = h.withText ? judged / h.withText : 0;
  const comparable = !partial || h.rating.before.n >= MIN_BEFORE;

  const [fold, setFold] = useState<Partial<Record<SecId, boolean>>>({});
  const [openCat, setOpenCat] = useState<Category | null>(null);
  const refs = useRef<Partial<Record<SecId, HTMLElement | null>>>({});

  const warnTotal = WARNINGS.reduce((n, c) => n + h.warnings[c].count, 0);
  const rows = ROW_CATS.filter((c) => h.warnings[c].count > 0)
    .sort((x, y) => h.warnings[y].recent - h.warnings[x].recent || h.warnings[y].count - h.warnings[x].count);
  const priceMove = bandMove(h.price.now.median, h.price.before.median);
  const flags = replyFlags(h.replies);
  const flagText = flags.canned ? t.review.replyFlag.canned : flags.lowUnanswered ? t.review.replyFlag.lowUnanswered : flags.mismatched ? t.review.replyFlag.mismatched : null;

  const auto: Record<SecId, boolean> = {
    rating: true,
    warn: cloud && rows.length > 0,
    price: (priceMove != null && priceMove !== "same") || (cloud && h.warnings.price.count > 0),
    trust: !stopped && (h.burst.flagged || !!flagText),
    lang: false,
  };
  const isOpen = (id: SecId) => fold[id] ?? (loading ? false : auto[id]);
  const toggle = (id: SecId) => setFold((f) => ({ ...f, [id]: !isOpen(id) }));
  const go = (id: SecId) => {
    setFold((f) => ({ ...f, [id]: true }));
    requestAnimationFrame(() => refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const sref = (id: SecId) => (el: HTMLElement | null) => { refs.current[id] = el; };
  const restart = () => { setFold({}); setOpenCat(null); void a.start(); };

  /* ---------- verdict ---------- */
  const peakRange = () => {
    const f = new Date(h.burst.peak.from), e = new Date(h.burst.peak.to);
    return t.review.monthRange(f.getFullYear(), f.getMonth() + 1, e.getFullYear(), e.getMonth() + 1);
  };
  const months = Math.max(1, Math.round(h.now.days / 30));
  const head: string[] = opening ? t.review.head.opening
    : loading && !nowReady ? t.review.head.loading
    : partial && (!comparable || d == null) ? (stopped ? t.review.head.stoppedFew : t.review.head.nowReady)
    : partial ? (d! <= -VERDICT_DELTA ? t.review.head.soFarDown : d! >= VERDICT_DELTA ? t.review.head.soFarUp : t.review.head.soFarSteady)
    : v.kind === "burst" ? t.review.head.burst(peakRange())
    : v.kind === "down" ? t.review.head.down(months)
    : v.kind === "up" ? t.review.head.up(months)
    : v.kind === "warn" ? t.review.head.warn(v.recent)
    : v.kind === "steady" ? t.review.head.steady
    : t.review.head.few;

  const sentence = (() => {
    if (partial) return "";
    const out: string[] = [];
    if (v.kind === "burst") {
      const b = h.burst;
      out.push(t.review.burstSentence(b.peak.n, String(Math.round(b.ratio * 10) / 10), pct(b.newbieShare), pct(b.fiveStarShare)));
      if (h.rating.now.avg != null) out.push(t.review.burstAfter(h.now.days, h.rating.now.n, h.rating.now.avg.toFixed(2)));
    } else if (v.kind === "down" || v.kind === "up") {
      const dir = v.kind;
      const moved = ASPECTS.filter((k) => {
        const x = h.aspects[k];
        if (x.now.avg == null || x.before.avg == null) return false;
        const d = x.now.avg - x.before.avg;
        return dir === "down" ? d <= -VERDICT_DELTA : d >= VERDICT_DELTA;
      });
      if (moved.length === ASPECTS.length) out.push(t.review.aspectsAll[dir]);
      else if (moved.length) out.push(t.review.aspectsSome[dir](moved.map((k) => t.review.aspect[k]).join(t.review.listSep)));
    }
    if (cloud && v.recent > 0) {
      const list = WARNINGS.filter((c) => h.warnings[c].recent > 0).map((c) => t.review.catCount(t.review.cat[c], h.warnings[c].recent)).join(t.review.catSep);
      out.push(t.review.recentComplaints(h.now.days, list));
    }
    return out.join(t.review.sentenceSep);
  })();

  const S = t.review.sigStatus;
  const priceSides = Math.min(h.price.now.n, h.price.before.n);
  const signals: Signal[] = [
    {
      key: "rating", label: t.review.sig.rating, onClick: () => go("rating"),
      ...(partial ? (comparable && d != null ? { value: deltaShort(d), status: S.provisional, provisional: true }
          : stopped ? { value: "—", status: S.none }
          : { value: "…", status: t.review.comparingN(Math.min(h.rating.before.n, MIN_BEFORE), MIN_BEFORE), pending: true, progress: h.rating.before.n / MIN_BEFORE })
        : d == null ? { value: "—", status: S.none }
        : d <= -VERDICT_DELTA ? { value: deltaShort(d), status: S.down, tone: "red" as Tone }
        : d >= VERDICT_DELTA ? { value: deltaShort(d), status: S.up, tone: "green" as Tone }
        : { value: deltaShort(d), status: S.same }),
    },
    {
      key: "warn", label: t.review.sig.warn, onClick: () => go("warn"),
      ...(!cloud ? { value: "—", status: S.off }
        : busy && (loading || judged < h.withText) ? (connecting ? { value: "…", status: S.connecting, pending: true, waiting: true }
          : { value: pct(judgedShare) + "%", status: S.judging, pending: true, progress: judgedShare })
        : judged === 0 ? { value: "—", status: S.noData }
        : v.recent > 0 ? { value: t.review.sigCount(v.recent), status: S.recent, tone: "yellow" as Tone }
        : warnTotal > 0 ? { value: t.review.sigCount(warnTotal), status: S.older }
        : { value: t.review.sigCount(0), status: S.clear, tone: "green" as Tone }),
    },
    {
      key: "price", label: t.review.sig.price, onClick: () => go("price"),
      ...(partial ? (priceSides >= MIN_PRICE && priceMove ? { value: MOVE_MARK[priceMove], status: S.provisional, provisional: true }
          : stopped ? { value: "—", status: S.noData }
          : { value: "…", status: t.review.priceN(Math.min(priceSides, MIN_PRICE), MIN_PRICE), pending: true, progress: priceSides / MIN_PRICE })
        : priceMove == null ? { value: "—", status: S.noData }
        : priceMove === "up" ? { value: "▲", status: S.priceUp, tone: "yellow" as Tone }
        : priceMove === "down" ? { value: "▼", status: S.priceDown, tone: "green" as Tone }
        : { value: "＝", status: S.priceSame }),
    },
    {
      key: "trust", label: t.review.sig.trust, onClick: () => go("trust"),
      ...(stopped ? { value: "—", status: S.stopped }
        : loading ? { value: "…", status: t.review.coverageP(pct(coverage)), pending: true, progress: coverage }
        : h.burst.flagged ? { value: t.review.sigBurst, status: S.burst, tone: "red" as Tone }
        : !h.burst.enough ? { value: "—", status: S.short }
        : { value: "OK", status: S.ok, tone: "green" as Tone }),
    },
  ];

  /* ---------- status (one box while running: counts, what happens now, overall bar, 停止) ---------- */
  const doneLine = t.review.doneLine(h.n, cloud ? judged : null);
  const runLine2 = opening ? t.review.lineOpening
    : connecting ? t.review.lineConnecting
    : !loading ? t.review.lineFinishing
    : reached != null ? t.review.lineBack(ym(reached))
    : t.review.preparing;
  const progress = opening ? 0.03
    : loading ? 0.03 + (cloud ? 0.67 * coverage + 0.3 * judgedShare : 0.97 * coverage)
    : 0.7 + 0.3 * judgedShare;

  /* ---------- 01 rating ---------- */
  const before = h.rating.before.avg;
  const base = before ?? h.rating.all.avg;
  const quarters: TrendPoint[] = h.rating.byQuarter.map((q, i) => ({
    key: q.key, label: q.key.replace("-", " "), avg: q.avg, count: q.n, estimated: q.key === quarterKey(h.asOf), tick: tick(q.key, i),
  }));
  const qKeys = h.rating.byQuarter.map((q) => q.key);
  const bandFrom = (() => {
    if (qKeys.length < 2) return null;
    const k = quarterKey(h.now.from), i = qKeys.findIndex((x) => x >= k);
    if (i < 0) return null;
    if (qKeys[i] !== k) return i - 0.5;
    const s = quarterSpan(k);
    return i - 0.5 + (h.now.from - s.from) / (s.to - s.from);
  })();
  let mark: number | null = null;
  for (let i = 0; i < quarters.length; i++) {
    const p = quarters[i];
    if (p.estimated || p.avg == null || base == null || p.avg > base - VERDICT_DELTA) continue;
    if (mark == null || p.avg < (quarters[mark].avg ?? 5)) mark = i;
  }
  const hotIndex = h.burst.flagged ? qKeys.indexOf(quarterKey(h.burst.peak.from)) : -1;
  const hot = hotIndex >= 0 ? { index: hotIndex, label: t.review.hotBar(quarters[hotIndex].count, h.burst.peak.n) } : null;
  const minAvg = Math.min(5, base ?? 5, ...quarters.map((q) => q.avg ?? 5));
  const yMin = Math.max(1, Math.min(3, Math.floor(minAvg - 0.3)));
  const hasAspects = ASPECTS.some((k) => h.aspects[k].now.avg != null || h.aspects[k].before.avg != null);

  /* ---------- 02 warnings ---------- */
  const monthList = h.span ? monthKeys(h.span.from, h.asOf) : [];
  const nowIdx = monthList.indexOf(monthKey(h.now.from));
  const recentMonths = monthList.length - Math.max(0, nowIdx);
  const warnSummary = !cloud ? t.review.warnOffChip
    : busy && (loading || judged < h.withText) ? t.review.sumJudging(judged, h.withText)
    : rows.length ? t.review.warnTotals(warnTotal, v.recent)
    : judged > 0 ? t.review.sumWarnNone(judged)
    : S.noData;

  /* ---------- 03 price ---------- */
  const qp = h.price.byQuarter;
  const lows = [...new Set(qp.map((q) => priceBand(q.median)!.lo))].sort((x, y) => y - x);
  const bandRows: BandRow[] = lows.map((lo) => {
    const b = bandOf(lo);
    return { label: t.review.band(b.lo, b.hi), cells: qp.map((q) => (priceBand(q.median)!.lo === lo ? { n: q.n, few: q.n < 3 } : null)) };
  });
  const priceNow = priceBand(h.price.now.median ?? h.price.before.median);
  const priceSummary = loading ? t.review.sumLoading
    : priceNow ? `${t.review.band(priceNow.lo, priceNow.hi)}${priceMove ? ` · ${t.review.priceMove[priceMove]}` : ""}`
    : t.review.priceNone;

  /* ---------- 04 trust ---------- */
  const b = h.burst;
  const checks = [
    { key: "peak", label: t.review.checkPeak, value: b.peak.n, shown: t.review.count(b.peak.n), thr: BURST.minPeak, thrText: String(BURST.minPeak) },
    { key: "ratio", label: t.review.checkRatio, value: b.ratio, shown: t.review.times(String(Math.round(b.ratio * 10) / 10)), thr: BURST.minRatio, thrText: String(BURST.minRatio) },
    { key: "newbie", label: t.review.newbie, value: b.newbieShare, shown: `${pct(b.newbieShare)}%`, thr: BURST.minNewbie, thrText: `${pct(BURST.minNewbie)}%` },
  ];
  const delay = h.replies.medianDelayDays;
  const trustSummary = loading ? t.review.sumTrustLater
    : stopped ? t.review.burstStopped
    : b.flagged ? t.review.burstFlag
    : !b.enough ? t.review.burstShort
    : `${t.review.burstOk}${flagText ? ` · ${flagText}` : ""}`;
  const muted = (s: string) => <span className="font-mono text-[11px] text-muted">{s}</span>;

  /* ---------- review timeline in the verdict card (while loading only what the sorted reading has reached) ---------- */
  const timeline = useMemo(() => {
    const shown = loading && reached != null ? a.reviews.filter((r) => r.publishedAt >= reached) : loading ? [] : a.reviews;
    const warnAts = cloud ? WARNINGS.flatMap((c) => h.warnings[c].items.map((it) => it.at)) : [];
    const tl = timelineMonths(shown, warnAts, h.asOf);
    const ticks = tl.keys.flatMap((k, i) => {
      const [y, m] = k.split("-");
      if (i === 0) return [{ at: 0, label: y.slice(2) + "/" + m }];
      return m === "1" && i > 2 && i < tl.keys.length - 3 ? [{ at: i / tl.keys.length, label: y.slice(2) + "/1" }] : [];
    });
    return { months: tl.months, ticks: [...ticks, { at: 1, label: t.review.today }], n: shown.length };
  }, [h, loading, reached, cloud, tt.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 05 languages (Maps' own original-language field; rating-only reviews have none) ---------- */
  const langs = useMemo(() => {
    const from = h.asOf - WINDOW_DAYS * 86400e3;
    return reviewLanguages(a.reviews.filter((r) => r.publishedAt >= from), (c) => (c === "other" ? t.review.langOther : langName(tt.lang, c)), a.langColors);
  }, [h, tt.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const langSummary = loading ? t.review.sumLoading
    : langs.total ? t.review.langSum(pct(langs.foreign), langs.slices.filter((s) => s.key !== "other").length)
    : t.review.langNone;

  return (
    <PanelShell title={t.review.title} sub={place} onClose={onClose}>
      {/* status: one box while running, one line once done */}
      {busy ? (
        <section className="card tone-white min-h-0 gap-2.5 px-3 pt-2.5 pb-3" aria-live="polite">
          <div className="flex items-center gap-2.5">
            <LiveDot />
            <div className="min-w-0 font-mono text-[10.5px] leading-[1.45] font-bold">
              <div className="overflow-hidden text-ellipsis whitespace-nowrap">{t.review.runLine(h.n, cloud ? judged : null)}</div>
              <div className="flex items-center overflow-hidden whitespace-nowrap text-muted">{runLine2}{connecting && <BlinkDots />}</div>
            </div>
            <Button size="sm" className="ml-auto" icon={<StopIcon />} onClick={a.stop}>{t.common.stop}</Button>
          </div>
          <Meter value={progress} max={1} tone="yellow" className="h-2.5" label={t.review.progressLabel} />
          {cloud && a.classifyError && <ClassifyError error={a.classifyError} />}
        </section>
      ) : (
        <>
          <StatusPill
            className="fade-up"
            bad={a.phase === "error"}
            lines={a.phase === "error" ? [statusText(tt, a), doneLine]
              : [doneLine, st.code === "stopped" ? t.review.status.stopped : h.span ? t.review.spanLine(ym(h.span.from), ym(h.span.to)) : statusText(tt, a)]}
            action={<Button size="sm" variant="primary" onClick={restart}>{t.review.reanalyze}</Button>}
          />
          {cloud && a.classifyError && <ClassifyError error={a.classifyError} />}
        </>
      )}

      {/* verdict: the same card while waiting and when done, so nothing jumps */}
      <section className="card tone-white min-h-0 gap-3.5 p-[18px]" aria-label={t.review.verdictLabel}>
        <div className="flex min-w-0 items-center gap-1.5">
          <Chip className="flex-none whitespace-nowrap">{t.review.verdictLabel}</Chip>
          {busy ? <Chip variant="dashed" className="flex-none whitespace-nowrap">{t.review.provisional}</Chip>
            : stopped ? <Chip variant="dashed" className="flex-none whitespace-nowrap">{t.review.partialChip}</Chip>
            : v.level !== "none" && <Chip className={"pop-in flex-none whitespace-nowrap " + LEVEL_BG[v.level]}>{t.review.level[v.level]}</Chip>}
          <span className="ml-auto min-w-0 truncate font-mono text-[10.5px] font-bold text-muted">{t.review.vsLabel(h.now.days)}</span>
        </div>
        <h2 key={head.join("")} className={"fade-up m-0 text-[25px] font-bold leading-[1.2] tracking-[-0.03em] transition-colors duration-300" + (busy || stopped ? " text-body" : "")}>{head[0]}<br />{head[1]}</h2>
        <div className="flex items-end gap-2">
          {/* while loading: the partial recent average, muted, easing to each new value; ink once the recent window is complete */}
          <span className={"text-[66px] font-bold leading-[.86] tracking-[-0.05em] tabular-nums transition-colors duration-300" + (nowReady ? "" : " text-muted")}>
            {h.rating.now.avg != null ? <CountUp value={h.rating.now.avg} decimals={2} /> : "—"}
          </span>
          <span className="pb-1 text-[18px] font-bold">★</span>
          <div className="ml-auto flex min-w-0 flex-col items-end gap-1.5">
            {partial ? (comparable && d != null ? <Delta d={d} className="self-end border-dashed" /> : loading && <Chip variant="dashed" className="self-end">{t.review.comparing}</Chip>)
              : <Delta d={d} className="fade-up self-end" />}
            {loading && nowReady && <Stamp className="self-end">{t.review.recentDone}</Stamp>}
            <span className="font-mono text-[10.5px] font-bold text-muted">{t.review.nowLabel(h.now.days)} · {t.review.count(h.rating.now.n)}</span>
            <span className="font-mono text-[10.5px] font-bold text-muted">{t.review.beforeLabel} {two(before)} · {t.review.count(h.rating.before.n)}</span>
          </div>
        </div>
        <ReviewTimeline months={timeline.months} ticks={timeline.ticks}
          scan={stopped ? (reached != null ? frac(reached) : null) : !loading ? null : opening || reached == null ? 1 : frac(reached)} scanLabel={opening || reached == null ? t.review.today : ym(reached)}
          recentFrom={frac(h.now.from)} recentLabel={t.review.nowLabel(h.now.days)} recentDone={nowReady}
          title={t.review.timelineTitle} legend={["4–5★", "3★", "1–2★"]} label={t.review.timelineLabel(timeline.n)} />
        <SignalRow signals={signals} label={t.review.sigNav} />
        {sentence ? <p className="fade-up m-0 text-[13.5px] leading-[1.7] text-body">{sentence}</p>
          : stopped ? <p className="m-0 font-mono text-[10.5px] leading-[1.6] font-bold text-muted">{t.review.stoppedNote(h.n)}</p>
          : busy && <p className="m-0 font-mono text-[10.5px] leading-[1.6] font-bold text-muted">{t.review.waitHint}</p>}
      </section>

      {/* 01 rating trend */}
      <Section index="01" kicker={t.review.ratingKicker} title={t.review.ratingTitle} tone="blue" sref={sref("rating")}
        open={isOpen("rating")} onToggle={() => toggle("rating")} live={loading}
        summary={loading ? t.review.sumLoading : t.review.sumRating(two(h.rating.now.avg), deltaText(d))}>
        {quarters.length >= 2 && (
          <figure className="m-0 rounded-[20px] border-2 border-ink bg-white px-2 pt-2.5 pb-1.5">
            <TrendChart points={quarters} width={324} height={150} label={t.review.quarterLabel} estimated={t.review.partial} count={t.review.perQuarter}
              yMin={yMin} band={bandFrom != null ? { from: bandFrom, label: t.review.nowLabel(h.now.days) } : null}
              refLine={before != null ? { value: before, label: t.review.refBefore(before.toFixed(2)) } : null} mark={mark} hot={hot} />
            {dev && <figcaption className="px-1 pt-0.5 font-mono text-[9.5px] font-bold text-muted">{t.review.chartLegend}{hot ? t.review.chartLegendHot : ""}</figcaption>}
          </figure>
        )}
        {before == null && <p className="m-0 text-[12.5px] font-bold">{t.review.noBefore}</p>}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] font-bold tracking-[0.08em]">{t.review.aspectsLegend}</span>
          <span className="h-0.5 flex-1 bg-ink opacity-25" />
          <DumbbellKey before={t.review.legendBefore} now={t.review.legendNow} />
        </div>
        {hasAspects ? (
          <div className="flex flex-col gap-3">
            {ASPECTS.map((k) => {
              const x = h.aspects[k];
              return (
                <div key={k} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="w-[70px] text-[14px] font-bold">{t.review.aspect[k]}</span>
                    <span className="font-mono text-[10.5px] font-bold text-muted">{two(x.before.avg)} →</span>
                    <span className="text-[18px] leading-none font-bold">{two(x.now.avg)}</span>
                    {x.now.avg != null && x.before.avg != null && <span className="ml-auto"><Delta d={x.now.avg - x.before.avg} /></span>}
                  </div>
                  <Dumbbell before={x.before.avg} now={x.now.avg} label={t.review.aspectLabel(t.review.aspect[k], two(x.before.avg), two(x.now.avg))} />
                </div>
              );
            })}
            <div className="flex justify-between px-0.5 font-mono text-[9.5px] font-bold text-muted" aria-hidden><span>★1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
          </div>
        ) : <p className="m-0 text-[13px] text-body">{t.review.aspectsNone}</p>}
        {b.flagged && <p className="card-note m-0 text-[12px]">{t.review.burstBeforeNote}</p>}
      </Section>

      {/* 02 warning signs */}
      <Section index="02" kicker={t.review.warnKicker} title={t.review.warnTitle} tone={warnTotal > 0 ? "red" : "white"} sref={sref("warn")}
        open={isOpen("warn")} onToggle={() => toggle("warn")} live={cloud && a.judging} summary={warnSummary}
        aside={rows.length ? t.review.warnTotals(warnTotal, v.recent) : undefined}>
        {!cloud && judged === 0 ? (
          <div className="flex flex-col gap-1.5">
            <Chip variant="dashed" className="self-start">{t.review.warnOffChip}</Chip>
            <p className="m-0 text-[13px] text-body">{t.review.warnOff}</p>
          </div>
        ) : judged === 0 ? (
          <p className="m-0 text-[13px] text-body">{busy ? t.review.warnWaiting : t.review.warnNone}</p>
        ) : rows.length === 0 ? (
          <p className="m-0 text-[13px] text-body">{t.review.warnNone}</p>
        ) : (
          <>
            {rows.map((c) => {
              const g = h.warnings[c];
              const opened = openCat === c;
              const seen = new Set(g.items.map((it) => monthKey(it.at)));
              const stance = c === "price" ? g.items.filter((it) => it.stance != null) : [];
              const unhappy = stance.filter((it) => it.stance! >= 0.5).length;
              return (
                <article key={c} className="fade-up flex flex-col gap-2.5 rounded-[20px] border-2 border-ink bg-white p-3">
                  <div className="flex items-center gap-1.5">
                    <h4 className="m-0 min-w-0 text-[15px] font-bold">{t.review.cat[c]}</h4>
                    <span className="font-mono text-[11px] font-bold whitespace-nowrap">{t.review.count(g.count)}</span>
                    {g.recent > 0 && <Chip variant="ink" className="self-center px-2 py-1 text-[10px] tracking-normal normal-case">{t.review.recent(g.recent)}</Chip>}
                    <ChipButton pressed={opened} onClick={() => setOpenCat(opened ? null : c)} className="ml-auto flex-none self-center tracking-normal normal-case">
                      {t.review.quotes(Math.min(g.items.length, QUOTES_MAX))}<Chevron open={opened} />
                    </ChipButton>
                  </div>
                  {monthList.length > 1 && (
                    <MonthStrip on={monthList.map((m) => seen.has(m))} recent={recentMonths} tone={c === "improvement" ? "green" : "red"}
                      label={t.review.stripLabel(monthList.filter((m) => seen.has(m)).map((m) => m.replace("-", "/")).join(t.review.listSep))} />
                  )}
                  {(opened ? g.items.slice(0, QUOTES_MAX) : g.items.slice(0, 1)).map((it) => (
                    <Quote key={it.id} clamp={!opened} lang={it.lang ?? undefined}
                      meta={<>{ym(it.at)} · ★{it.stars}{it.stance != null && it.stance >= 0.5 && <> · <span className="text-ink">{t.review.stanceUnhappy}</span></>}</>}>
                      「{it.snippet}」
                    </Quote>
                  ))}
                  {stance.length > 0 && <span className="font-mono text-[10px] font-bold text-muted">{t.review.stance(unhappy, stance.length - unhappy)}</span>}
                </article>
              );
            })}
            {dev && monthList.length > 1 && h.span && (
              <div className="flex justify-between gap-2 px-1 font-mono text-[9.5px] font-bold text-body">
                <span>{ym(h.span.from)}</span><span>{t.review.stripLegend}</span><span>{t.review.stripRecent(h.now.days)}</span>
              </div>
            )}
          </>
        )}
        {cloud && h.warnings.staff_change.count > 0 && <p className="card-note m-0 text-[12px]">{t.review.staffNote(h.warnings.staff_change.count)}</p>}
        {dev && judged > 0 && <p className="m-0 font-mono text-[9.5px] leading-relaxed text-body">{t.review.classifiedNote}</p>}
      </Section>

      {/* 03 price per person */}
      <Section index="03" kicker={t.review.priceKicker} title={t.review.priceTitle} tone="yellow" sref={sref("price")}
        open={isOpen("price")} onToggle={() => toggle("price")} summary={priceSummary}>
        {priceNow ? (
          <>
            <div className="flex items-center gap-2.5">
              <span className="text-[30px] leading-none font-bold tracking-[-0.03em]">{t.review.band(priceNow.lo, priceNow.hi)}</span>
              {priceMove && <Chip className="ml-auto self-center">{t.review.priceMove[priceMove]}</Chip>}
            </div>
            <span className="-mt-1 font-mono text-[10.5px] font-bold text-muted">{t.review.priceMeta(h.price.now.n, h.price.before.n)}</span>
            {qp.length > 0 && <BandGrid rows={bandRows} cols={qp.map((q, i) => tick(q.key, i))} label={t.review.bandGridLabel} />}
            {cloud && h.warnings.price.count > 0 && (
              <Button className="w-full justify-between" onClick={() => { setOpenCat("price"); go("warn"); }}>{t.review.priceXref(h.warnings.price.count)}</Button>
            )}
            {dev && <p className="card-note m-0 text-[12px]">{t.review.priceNote}</p>}
          </>
        ) : <p className="m-0 text-[13px] text-body">{t.review.priceNone}</p>}
      </Section>

      {/* 04 trust */}
      <Section index="04" kicker={t.review.trustKicker} title={t.review.trustTitle} tone={b.flagged ? "red" : "green"} sref={sref("trust")}
        open={isOpen("trust")} onToggle={() => toggle("trust")} summary={trustSummary}>
        {stopped ? <Chip variant="dashed" className="self-start tracking-normal normal-case">{t.review.burstStopped}</Chip>
          : b.enough ? <CheckPill bad={b.flagged} className="self-start">{b.flagged ? t.review.burstFlagPill : t.review.burstOkPill}</CheckPill> : <Chip>{t.review.burstShort}</Chip>}
        {!stopped && b.enough && b.peak.n > 0 && (
          <div className="flex flex-col gap-3.5 rounded-[20px] border-2 border-ink bg-white px-3 py-3.5">
            {checks.map((c) => (
              <div key={c.key} className="flex flex-col gap-[7px]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-bold">{c.label}</span>
                  <span className="ml-auto text-[16px] font-bold whitespace-nowrap">{c.shown}</span>
                  <span className="font-mono text-[10px] font-bold whitespace-nowrap text-muted">{t.review.threshold(c.thrText)}</span>
                </div>
                <Meter value={c.value} max={c.thr * 2} threshold={c.thr} tone={c.value >= c.thr ? "red" : "green"} label={c.label} />
              </div>
            ))}
            {dev && <p className="card-note m-0 text-[11.5px]">{t.review.burstRule(ym(b.peak.from), ym(b.peak.to), b.flagged)}</p>}
          </div>
        )}
        {!stopped && b.flagged && (
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t.review.fiveStarPeak} value={`${pct(b.fiveStarShare)}%`} />
            <Stat label={t.review.maxPerDay} value={t.review.count(b.maxPerDay)} />
          </div>
        )}
        <div className="flex flex-col gap-2.5 rounded-[20px] border-2 border-ink bg-white px-3 py-3.5">
          <div className="flex items-center gap-2">
            <h4 className="m-0 text-[15px] font-bold">{t.review.replyTitle}</h4>
            {flagText && <Chip className="ml-auto self-center bg-yellow-soft tracking-normal normal-case">{flagText}</Chip>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {h.replies.n === 0 ? (
              <>
                <Stat label={t.review.replyRate} value={<>0%{muted(t.review.of(h.n))}</>} />
                <Stat label={t.review.replyLow} value={<>0{muted(t.review.of(h.replies.lowStar))}</>} />
              </>
            ) : (
              <>
                <Stat label={t.review.replyRate} value={`${pct(h.replies.rate)}%`} />
                <Stat label={t.review.replyCanned} value={`${pct(h.replies.canned)}%`} />
                <Stat label={t.review.replyLow} value={<>{h.replies.lowStarReplied}{muted(t.review.of(h.replies.lowStar))}</>} />
                <Stat label={t.review.replyDelay} value={delay != null ? t.review.days(delay < 10 ? Math.round(delay * 10) / 10 : Math.round(delay)) : "—"} />
                {h.replies.mismatched > 0 && <Stat label={t.review.replyMismatch} value={h.replies.mismatched} />}
              </>
            )}
          </div>
          {flags.canned && <p className="card-note m-0 text-[11.5px]">{t.review.cannedNote(h.replies.n, pct(h.replies.canned))}</p>}
        </div>
      </Section>

      {/* 05 review languages (基本機能) */}
      <Section index="05" kicker={t.review.langKicker} title={t.review.langTitle} tone="blue" sref={sref("lang")}
        open={isOpen("lang")} onToggle={() => toggle("lang")} summary={langSummary}>
        {langs.total ? (
          <>
            <PieChart data={langs.slices} size={140} label={t.review.langTitle}
              center={<div><div className="text-[22px] leading-none font-bold">{langs.total}</div><div className="mt-1 font-mono text-[10px] font-bold">{t.review.langCenter}</div></div>} />
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t.review.langForeign} value={`${pct(langs.foreign)}%`} />
              <Stat label={t.review.langCount} value={langs.slices.filter((s) => s.key !== "other").length} />
            </div>
            <p className="m-0 font-mono text-[10.5px] leading-relaxed font-bold text-body">
              {t.review.langStars}{langs.slices.map((s) => `${s.label} ${s.avg.toFixed(1)}`).join(" · ")}
            </p>
            {dev && <p className="card-note m-0 text-[12px]">{t.review.langNote}</p>}
          </>
        ) : <p className="m-0 text-[13px] text-body">{t.review.langNone}</p>}
      </Section>
    </PanelShell>
  );
}
