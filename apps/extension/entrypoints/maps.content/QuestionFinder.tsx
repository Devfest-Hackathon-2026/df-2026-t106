import { useEffect, useRef, useState } from "react";
import { AskBar, Button, Chip, ChipButton, CountUp, LiveDot, Meter, SegToggle, StepRail, type Step } from "@gmap/ui";
import { cameraOf, collectRound, distance, movedFrom, ROUND_MAX_NEW } from "@/lib/areaSearch";
import { CHIP_ORDER, MODIFIER_ORDER, TYPE_ORDER, isQuestionId, isVenue, oneVenue, isShareable, needsNano, QUESTIONS, roundCount, roundQueries, type QuestionId, type QuestionSpec } from "@/lib/questions";
import { coordsOf, fetchPlace, type FoundPlace } from "@/lib/mapsData";
import { BlockedError, mapsGate } from "@/lib/mapsGate";
import { askHeld, askResumed, onAskHold, pausable } from "@/lib/askPause";
import { LunchNano, lunchNanoFor, LUNCH_NANO, type NanoSpec } from "@/lib/nanoLunch";
import { IntentNano, intentNano as sharedIntentNano, resolveIntent, type IntentNote, type IntentResult } from "@/lib/nanoIntent";
import { gatedStore, localLunchStore, LUNCH_VERSION, sharedLunchStore } from "@/lib/lunchStore";
import { ADVANCED_DEFAULT, ADVANCED_KEY } from "@/lib/advanced";
import { NO_CACHE_KEY } from "@/lib/noCache";
import { messageRemote } from "@/lib/sharedRemote";
import { isFinal, LunchScanner, type LunchResult } from "@/lib/lunchScan";
import { priceIndex } from "@/lib/lunchPrice";
import { fidFromHref, KEEP_RESULTS_KEY, openPlace } from "@/lib/searchList";
import { parseView, type CenterMode, type View } from "@/lib/mapView";
import { assignRanks, bubblesFor, isMatch, type Bubble } from "@/lib/askBubbles";
import { budgetChoices, budgetFromText } from "@/lib/budget";
import { htmlLang } from "@/lib/i18n";
import { useT, type T } from "@/lib/i18n/useT";
import { ListBadges, MapOverlay, type MapLabel } from "./Highlights";
import { combine, hasLunch, type AskRow } from "@/lib/askCombine";
import { LOOK, TONE_BG } from "./askLook";
import { partLabel, yen } from "./askWords";
import { PanelShell, SecHead, Stat, useDevMode, useStoredFlag } from "./parts";

/*
 * 問地圖: one sentence or a few chips → the places on screen that answer every selected question.
 * One pool of places per map area (Maps searches: the union of the selected questions' queries), one
 * LunchScanner per question over that pool. Questions answered from the search record (attributes,
 * review quotes) settle at once; lunch (needs a detail fetch per place) only scans the places that
 * already pass the other questions, at most ROUND_MAX_NEW per click.
 * The map shows the work as it happens (lib/askBubbles): every found place is a dot, judged places turn
 * into rings or fade out, and the top matches get a numbered name label once judging ends.
 */

const log = (...a: unknown[]) => console.log("[GMAP]", ...a);
type Area = { camera: string; view: View; round: number };
type Saved = { area: Area; active: QuestionId[]; places: { fid: string; name: string }[]; ran?: string[]; at?: number; tab?: string };
/** A panel message: a dictionary key, or an error message as it came. */
type Note = "" | "errView" | "errPick" | "noNew" | { message: string };
const SAVE_KEY = "ask:lastSet";
/** 問地圖's Maps requests wait while 「お店の今」 runs (lib/askPause); the place page's own checks don't. */
const askGate = pausable(mapsGate);
const askPause = { held: askHeld, resumed: askResumed };
/** Review questions: Nano judgments per scan, nearest places first (~3 s each); 載入更多 continues. */
const NANO_PER_SCAN = 40;
/**
 * The last result set comes back only after OUR full page load (openPlace's last resort when Maps' router
 * did not open the place), in the same tab, within RESTORE_MS. A refresh or a new visit starts clean.
 */
const RESTORE_MS = 15 * 60_000;
function consumeKeep() {
  try {
    const t = Number(sessionStorage.getItem(KEEP_RESULTS_KEY));
    sessionStorage.removeItem(KEEP_RESULTS_KEY);
    return t > 0 && Date.now() - t < 60_000;
  } catch { return false; }
}
const TAB_KEY = "gmap-ask-tab";
const tabId = (() => {
  try {
    let t = sessionStorage.getItem(TAB_KEY);
    if (!t) { t = Math.random().toString(36).slice(2); sessionStorage.setItem(TAB_KEY, t); }
    return t;
  } catch { return "x"; }
})();
async function persist(patch: Partial<Saved>) {
  const cur = (await browser.storage.local.get(SAVE_KEY))[SAVE_KEY] as Saved | undefined;
  await browser.storage.local.set({ [SAVE_KEY]: { ...cur, ...patch, at: Date.now(), tab: tabId } });
}

function useAsk() {
  const [active, setActiveState] = useState<QuestionId[]>([]);
  const activeRef = useRef(active);
  const scanners = useRef(new Map<QuestionId, LunchScanner>());
  const pool = useRef(new Map<string, FoundPlace>());
  const seen = useRef(new Set<string>());
  /** lunch: places found in this area that the fetch cap left for the next 「もっと見る」 */
  const pending = useRef<FoundPlace[]>([]);
  const snips = useRef(new Map<string, string[]>());
  const ran = useRef(new Set<string>());
  const ctrl = useRef<AbortController | null>(null);
  const advanced = useStoredFlag(ADVANCED_KEY, ADVANCED_DEFAULT); // 拡張機能: shared cache on/off
  const advancedRef = useRef(advanced);
  advancedRef.current = advanced;
  // dev 「キャッシュなし」 (lib/noCache.ts): no stored answers, and each new question starts over in this page
  const noCacheFlag = useStoredFlag(NO_CACHE_KEY);
  const devFlag = useDevMode();
  const noCacheRef = useRef(false);
  noCacheRef.current = noCacheFlag && devFlag;
  const [area, setArea] = useState<Area | null>(null);
  const [phase, setPhase] = useState<"idle" | "searching" | "scanning" | "done">("idle");
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [note, setNote] = useState<Note>("");
  const [nanoState, setNanoState] = useState("");
  const [queries, setQueries] = useState(0); // Maps searches in the running round (step rail)
  const [paused, setPaused] = useState(askHeld);
  useEffect(() => onAskHold(setPaused), []);
  const [, setTick] = useState(0);
  const dirty = useRef(false);
  useEffect(() => {
    const t = setInterval(() => { if (dirty.current) { dirty.current = false; setTick((x) => x + 1); } }, 300);
    return () => clearInterval(t);
  }, []);

  const setActive = (ids: QuestionId[]) => {
    activeRef.current = ids;
    setActiveState(ids);
    persist({ active: ids });
  };

  async function scannerFor(id: QuestionId) {
    const have = scanners.current.get(id);
    if (have) return have;
    const spec: QuestionSpec = QUESTIONS[id];
    const avail = needsNano(spec) ? await LunchNano.available() : "available";
    if (needsNano(spec)) setNanoState(avail);
    const sc = new LunchScanner({
      fetchPlace: (name, fid, signal) => fetchPlace(name, fid, signal, askGate),
      pause: askPause,
      stores: {
        local: gatedStore(localLunchStore(browser.storage.local, undefined, id), () => noCacheRef.current),
        shared: isShareable(id) ? sharedLunchStore({ remote: messageRemote, enabled: () => advancedRef.current && !noCacheRef.current, log, meal: id }) : undefined,
      },
      nano: avail === "available" && needsNano(spec) ? lunchNanoFor(spec as NanoSpec) : null,
      onUpdate: () => { dirty.current = true; },
      concurrency: 4,
      meal: spec,
      // Nano only reads reviews for places that can still pass every other selected question
      nanoFilter: (fid) => activeRef.current.every((o) => {
        if (o === id) return true;
        const r = scanners.current.get(o)?.results.get(fid);
        return !r || !isFinal(r.verdict) || hasLunch(r);
      }),
      nanoCap: NANO_PER_SCAN,
    });
    scanners.current.set(id, scanners.current.get(id) ?? sc);
    return scanners.current.get(id)!;
  }

  /** Every selected question over the pool: search-record questions first, then lunch on the survivors. */
  async function scanAll(ids: QuestionId[], signal: AbortSignal) {
    const list = [...pool.current.values()];
    const asks = ids.filter((id) => QUESTIONS[id].kind === "ask"), meals = ids.filter((id) => QUESTIONS[id].kind === "meal");
    await Promise.all(asks.map(async (id) => {
      const sc = await scannerFor(id);
      // places restored without their search record are only read from the cache (no detail fetch)
      await Promise.all([sc.scan(list.filter((p) => p.raw), signal), sc.scan(list.filter((p) => !p.raw), signal, { cacheOnly: true })]);
    }));
    for (const id of meals) {
      const sc = await scannerFor(id);
      const askScs = await Promise.all(asks.map(scannerFor));
      const pass = list.filter((p) => askScs.every((s) => { const r = s.results.get(p.fid); return !!r && hasLunch(r); }));
      // cached verdicts cost no request, so only places that need a fetch use the cap
      await sc.scan(pass.filter((p) => !sc.results.has(p.fid)), signal, { cacheOnly: true });
      await sc.scan(pass.filter((p) => !sc.results.has(p.fid)).slice(0, ROUND_MAX_NEW), signal);
    }
  }

  async function save() {
    if (!area && !ctrl.current) return;
    const places = [...pool.current.values()].map(({ fid, name }) => ({ fid, name }));
    await persist({ places, active: activeRef.current, ran: [...ran.current] });
  }

  /** Runs the selected questions' Maps searches for `round` (skipping queries already run here), then scans. */
  async function run(ids: QuestionId[], round: number, freshArea: boolean) {
    const camera = freshArea || !area ? cameraOf(location.href) : area.camera;
    const view = freshArea || !area ? parseView(location.href) : area.view;
    if (!camera || !view) { setNote("errView"); return; }
    if (!ids.length) { setNote("errPick"); return; }
    ctrl.current?.abort();
    const ac = (ctrl.current = new AbortController());
    setNote(""); setPhase("searching");
    const t0 = performance.now();
    const next: Area = { camera, view, round };
    try {
      const specs = ids.map((id) => QUESTIONS[id]);
      const queries = roundQueries(specs, round).filter((q) => !ran.current.has(`${camera}|${q}`));
      setQueries(queries.length);
      // the lunch fetch budget only applies when lunch is the only question (otherwise it scans survivors)
      const budget = specs.length === 1 ? specs[0] : QUESTIONS.solo;
      // a new map area replaces the old one: its places leave the list and the map (verdicts stay cached)
      if (freshArea && area && movedFrom(area.view, view)) { pool.current.clear(); seen.current.clear(); pending.current = []; }
      setArea(next);
      for (const id of ids) { const sc = await scannerFor(id); sc.newRound(); sc.warmNano(); }
      // judge each results page as it lands (questions answered from the search record need no other data)
      const asks = ids.filter((id) => QUESTIONS[id].kind === "ask");
      const streamed: Promise<unknown>[] = [];
      const onFound = (ps: FoundPlace[]) => {
        for (const p of ps) pool.current.set(p.fid, p);
        dirty.current = true;
        streamed.push(...asks.map(async (id) => (await scannerFor(id)).scan(ps, ac.signal)));
      };
      const known = budget.kind === "meal" ? async (fids: string[]) => new Set((await gatedStore(localLunchStore(browser.storage.local, undefined, budget.id), () => noCacheRef.current).get(fids)).keys()) : undefined;
      const found = queries.length || pending.current.length
        ? await collectRound(camera, queries, seen.current, ac.signal, askGate, undefined, budget, snips.current, onFound, { pending: pending.current, known })
        : [];
      for (const q of queries) ran.current.add(`${camera}|${q}`);
      for (const p of found) pool.current.set(p.fid, p);
      await persist({ area: next, active: ids, places: [...pool.current.values()].map(({ fid, name }) => ({ fid, name })) });
      setPhase("scanning");
      await Promise.all(streamed);
      await scanAll(ids, ac.signal);
      await save();
      if (!found.length && round > 0) setNote("noNew");
    } catch (e) {
      if (e instanceof BlockedError) setBlockedUntil(e.until);
      else if (!ac.signal.aborted) setNote({ message: (e as Error).message });
    }
    if (mapsGate.blockedUntil > Date.now()) { setBlockedUntil(mapsGate.blockedUntil); ac.abort(); }
    if (ctrl.current === ac) setPhase("done");
    log("ask area", ids, { pool: pool.current.size, round, sec: Math.round((performance.now() - t0) / 1000) });
    dirty.current = true;
  }

  /** Scan the current pool again (no Maps search): fills in places skipped while another condition excluded them. */
  async function rescan(ids: QuestionId[]) {
    ctrl.current?.abort();
    const ac = (ctrl.current = new AbortController());
    for (const id of ids) (await scannerFor(id)).newRound();
    setPhase("scanning");
    try { await scanAll(ids, ac.signal); } catch (e) { if (!ac.signal.aborted) setNote({ message: (e as Error).message }); }
    if (ctrl.current === ac) setPhase("done");
    dirty.current = true;
  }

  const moved = () => { const v = parseView(location.href); return !area || !v || movedFrom(area.view, v); };

  /** New selection: run its queries here (or in the new map area) and scan. */
  function ask(next: QuestionId[]) {
    const ids = oneVenue(next);
    // キャッシュなし: forget this page's answers and searches too, so every place is searched and judged again
    if (noCacheRef.current) {
      ctrl.current?.abort();
      scanners.current.clear(); ran.current.clear(); pool.current.clear(); seen.current.clear(); pending.current = [];
      setActive(ids);
      if (ids.length) return run(ids, 0, true);
      setPhase("done"); dirty.current = true; return;
    }
    const narrower = ids.every((id) => activeRef.current.includes(id));
    setActive(ids);
    // dropping a condition only widens the intersection: no new search, only places Nano skipped get judged
    if (narrower && area && !moved()) { if (ids.length) rescan(ids); dirty.current = true; return; }
    if (ids.length) return run(ids, 0, moved());
    ctrl.current?.abort(); setPhase("done"); dirty.current = true;
  }
  function toggle(id: QuestionId) {
    const cur = activeRef.current;
    return ask(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }
  const searchHere = () => run(activeRef.current, 0, true);
  function loadMore() {
    if (!area) return;
    // places already found here come before the next round's searches
    return run(activeRef.current, pending.current.length ? area.round : area.round + 1, false);
  }
  function stop() { ctrl.current?.abort(); setPhase("done"); }

  /** Clean map: no questions, no places (answers stay in the caches). */
  function clear() {
    ctrl.current?.abort();
    activeRef.current = []; setActiveState([]);
    pool.current.clear(); seen.current.clear(); pending.current = [];
    setArea(null); setPhase("idle"); setNote("");
    browser.storage.local.remove(SAVE_KEY);
    dirty.current = true;
  }

  /** After a full page load, bring the last set back from the caches only (no requests). */
  async function restore() {
    const v = (await browser.storage.local.get(SAVE_KEY))[SAVE_KEY] as Saved | undefined;
    if (!consumeKeep() || !v || v.tab !== tabId || !v.at || Date.now() - v.at > RESTORE_MS) return;
    const ids = (v.active ?? []).filter(isQuestionId);
    activeRef.current = ids; setActiveState(ids);
    if (!v?.places?.length || !v.area) return;
    for (const p of v.places) { pool.current.set(p.fid, p); seen.current.add(p.fid); }
    for (const q of v.ran ?? []) ran.current.add(q);
    const signal = new AbortController().signal;
    await Promise.all(ids.map(async (id) => (await scannerFor(id)).scan(v.places, signal, { cacheOnly: true })));
    setArea(v.area); setPhase("done");
    dirty.current = true;
  }

  /**
   * A place opened on its own page joins the pool with its record and gets every selected question,
   * ahead of the rest of the queue. It shares the running search's signal, so 停止 / a new sentence stops
   * it too (with a signal of its own, a stop left it "judging" for good).
   */
  async function addOne(p: FoundPlace) {
    if (!pool.current.has(p.fid)) pool.current.set(p.fid, p);
    else if (p.raw) pool.current.get(p.fid)!.raw ??= p.raw;
    if (!ctrl.current || ctrl.current.signal.aborted) ctrl.current = new AbortController();
    const signal = ctrl.current.signal, place = pool.current.get(p.fid)!;
    // lunch is checked by the place page itself (LunchChip); here it is only read from the cache
    await Promise.all(activeRef.current.map(async (id) => (await scannerFor(id)).scan([place], signal, { cacheOnly: QUESTIONS[id].kind === "meal", urgent: true })));
    dirty.current = true;
  }

  const ids = active;
  const places = [...pool.current.values()];
  const rows = combine(places, ids, (id, fid) => scanners.current.get(id)?.results.get(fid));
  const view = parseView(location.href);
  const rounds = roundCount(ids.map((id) => QUESTIONS[id]));
  return {
    active: ids, rows, places, area, phase, note, nanoState, advanced, noCache: noCacheFlag && devFlag, blockedUntil, queries, pool: pool.current.size,
    scanners: scanners.current,
    moved: !!area && !!view && movedFrom(area.view, view),
    blocked: blockedUntil > Date.now(),
    roundsLeft: (area ? rounds - 1 - area.round : rounds - 1) + (pending.current.length ? 1 : 0),
    nextQueries: area ? roundQueries(ids.map((id) => QUESTIONS[id]), area.round + 1) : [],
    waiting: mapsGate.waitingUntil > Date.now(),
    paused,
    ask, toggle, searchHere, loadMore, restore, stop, addOne, clear,
  };
}

/** "all" or a yen amount: a preset, or the one the sentence named (lib/budget). */
type Budget = string;
/** Within budget: a match whose cheapest priced lunch meal fits. Places without a price never match. */
const fitsBudget = (r: AskRow, b: Budget) => hasLunch(r) && (b === "all" || (!!r.price && r.price.yen <= Number(b)));
const posOf = (p: FoundPlace) => (p.raw ? coordsOf(p.raw) : null);
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function noteText({ t }: T, n: IntentNote) {
  if (n.code === "nano-error") return t.ask.noteNanoError(n.message);
  return n.code === "nano-off" ? t.ask.noteNanoOff : t.ask.noteNanoTimeout;
}
function intentNote(tt: T, r: IntentResult | null, asked: number | null) {
  if (!r) return "";
  const { t, q } = tt;
  const words = r.ids.map((id) => t.ask.quote(q(id).chip)).join(t.common.join);
  const note = r.note ? noteText(tt, r.note) : "";
  if (!r.ids.length) return `${note ? note + t.common.period : ""}${t.ask.intentNone}`;
  const picked = r.source === "nano" ? t.ask.intentNano(words) : t.ask.intentRule(words) + (note ? t.common.paren(note) : "");
  return asked ? `${picked}${t.common.period}${t.ask.budgetFromText(yen(asked))}` : picked;
}

export function QuestionFinder({ open, layers, onClose, onCount }: { open: boolean; layers: boolean; onClose: () => void; onCount?: (n: number) => void }) {
  const s = useAsk();
  const dev = useDevMode();
  const tt = useT();
  const { t, q, lang } = tt;
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [thinking, setThinking] = useState(false);
  const intentNano = useRef<IntentNano | null>(null);
  const [filter, setFilter] = useState<"match" | "all">("match");
  const [budget, setBudget] = useState<Budget>("all");
  // the budget the last sentence named (「1000円以下の…」); it joins the toggle's choices when not a preset
  const [askedBudget, setAskedBudget] = useState<number | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  // the place open in Maps keeps glowing on the map (after opening it from the list or a ring)
  const [placeFid, setPlaceFid] = useState(() => fidFromHref(location.href));
  // the camera lives in the URL: re-render when it changes, or the panel kept offering 「再検索」 (and no
  // "the map moved" hint) after the user panned to another area
  const [, setHref] = useState(location.href);
  useEffect(() => { const t = setInterval(() => { setPlaceFid(fidFromHref(location.href)); setHref(location.href); }, 500); return () => clearInterval(t); }, []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dim, setDim] = useState<"on" | "off">("off");
  const [centerMode, setCenterMode] = useState<CenterMode>("canvas");
  useEffect(() => { s.restore(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // load Gemini Nano when the panel first opens — the model (one throwaway sentence) and every question's
  // judge session, one at a time in the page-wide queue — so the first question pays no cold start (~1 min).
  // Not on page load: a Maps visit that never opens the panel costs no model memory, CPU or battery.
  // Closing the panel does not stop it; leaving the page does.
  const [preload, setPreload] = useState<{ done: number; total: number } | null>(null);
  const preloadStarted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open || preloadStarted.current) return;
    preloadStarted.current = true;
    (async () => {
      if ((await IntentNano.available()) !== "available") return;
      const specs = (Object.values(QUESTIONS) as QuestionSpec[]).filter(needsNano) as NanoSpec[];
      const total = specs.length + 1;
      setPreload({ done: 0, total });
      intentNano.current ??= sharedIntentNano();
      await intentNano.current.warm(true);
      if (!mounted.current) return;
      setPreload({ done: 1, total });
      for (const [i, spec] of specs.entries()) {
        if (!mounted.current) return;
        await lunchNanoFor(spec).warm();
        setPreload({ done: i + 2, total });
      }
    })();
  }, [open]);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<FoundPlace>).detail; if (d?.fid) s.addOne(d); };
    window.addEventListener("gmap:place-checked", on);
    return () => window.removeEventListener("gmap:place-checked", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lunchOn = s.active.includes("lunch");
  useEffect(() => { if (!lunchOn) setBudget("all"); }, [lunchOn]);
  const matches = s.rows.filter(hasLunch);
  useEffect(() => { onCount?.(matches.length); }, [matches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(sentence: string) {
    // free the device first: the sentence must not wait behind the previous search's review judgments
    s.stop();
    setThinking(true); setIntent(null);
    try {
      const r = await resolveIntent(sentence, intentNano.current, new AbortController().signal);
      // 「1000円以下の和食ランチ」 sets the lunch budget too; a sentence without an amount clears it
      const asked = r.ids.includes("lunch") ? budgetFromText(sentence) : null;
      setIntent(r); setAskedBudget(asked); setBudget(asked ? String(asked) : "all");
      if (r.ids.length) s.ask(r.ids);
    } finally { setThinking(false); }
  }
  function toggle(id: QuestionId) { setIntent(null); s.toggle(id); }

  const running = s.phase === "searching" || s.phase === "scanning" || s.rows.some((r) => !isFinal(r.verdict));

  // the map: every searched place, its state while judging; outside the lunch budget counts as no
  const bubbles: Bubble[] = bubblesFor(s.places, s.rows, posOf).map((b) =>
    budget !== "all" && isMatch(b.state) && !fitsBudget(b.row!, budget) ? { ...b, state: "no" } : b);
  // rank numbers: handed out when judging ends, kept while the same questions stay on the same area
  const ranksRef = useRef<{ key: string; map: Map<string, number> }>({ key: "", map: new Map() });
  const rankKey = s.area ? `${s.area.camera}|${s.active.join()}` : "";
  if (ranksRef.current.key !== rankKey) ranksRef.current = { key: rankKey, map: new Map() };
  if (s.area && !running) ranksRef.current.map = assignRanks(ranksRef.current.map, bubbles, s.area.view);
  const ranks = ranksRef.current.map;
  // name-label candidates in order: matches by number; while judging (no numbers yet), the sure ones nearest
  // the searched centre — the same rule the numbers use, so the labels rarely jump when judging ends.
  // The overlay labels the first LOOK.labelsMax of them that do not share a spot (top places in one
  // building used to show one label over three stacked rings).
  const ranked = bubbles.filter((b) => isMatch(b.state) && ranks.has(b.fid)).sort((a, b) => ranks.get(a.fid)! - ranks.get(b.fid)!);
  const early = () => {
    const c = s.area?.view;
    const sure = bubbles.filter((b) => b.state === "sure");
    return c ? sure.sort((a, b) => distance(a.pos, c) - distance(b.pos, c)) : sure;
  };
  const named = new Map((ranked.length ? ranked : early()).map((b, i) => [b.fid, i]));
  const labelOf = (b: Bubble): MapLabel | null => {
    const order = named.get(b.fid);
    if (order == null) return null;
    const price = budget !== "all" ? b.row?.price : undefined;
    return { num: ranks.get(b.fid), order, text: price ? `${yen(price.yen)} ${short(price.item, 9)}` : b.name };
  };

  const badge = (r: LunchResult) => {
    const row = r as AskRow;
    if (budget !== "all" && row.price) return t.common.lunchPrice(yen(row.price.yen));
    // the place type is already in the question; the sticker keeps the other answers (unless it is alone)
    const parts = row.parts.length > 1 ? row.parts.filter(([id]) => !isVenue(id)) : row.parts;
    const words = parts.map(([id, p]) => partLabel(tt, id, p)), sep = lang === "en" ? " · " : "・";
    return words.length <= 2 ? words.join(sep) : `${words.slice(0, 2).join(sep)}+${words.length - 2}`;
  };
  // highlights stay after the panel closes; the dock's ON/OFF switch hides every layer
  const inBudget = budget === "all" ? s.rows : s.rows.filter((r) => fitsBudget(r, budget));
  const highlights = layers && !!s.area && bubbles.length > 0 && (
    <>
      <ListBadges results={inBudget} dim={dim === "on"} text={badge} rank={(fid) => ranks.get(fid)} lang={htmlLang(lang)} />
      <MapOverlay bubbles={bubbles} labelOf={labelOf} ranks={ranks} mode={centerMode} debug={dev} tt={tt}
        hot={(open ? hot : null) ?? placeFid} onOpen={(b) => openPlace(b.fid, b.name, b.pos)} />
    </>
  );
  if (!open) return highlights || null;

  const total = s.rows.length;
  const checked = s.rows.filter((r) => isFinal(r.verdict)).length;
  const strong = matches.filter((r) => r.verdict === "menu").length;
  const priced = matches.filter((r) => r.price);
  const index = priceIndex(priced.map((r) => r.price!.yen));
  // the list follows the map's numbers (matches first, by number; numbers are handed out when judging ends)
  const byRank = (a: AskRow, b: AskRow) => Number(!hasLunch(a)) - Number(!hasLunch(b)) || (ranks.get(a.fid) ?? 1e9) - (ranks.get(b.fid) ?? 1e9);
  const shown = budget !== "all"
    ? inBudget.slice().sort((a, b) => a.price!.yen - b.price!.yen)
    : (filter === "match" ? matches : s.rows).slice().sort(byRank);
  const mins = Math.max(1, Math.ceil((s.blockedUntil - Date.now()) / 60_000));
  const reviewQs = s.active.filter((id) => { const x = QUESTIONS[id]; return x.kind === "ask" && !!x.snippet; });
  const nanoBusy = s.rows.some((r) => r.parts.some(([, p]) => p?.verdict === "judging"));
  const noteMsg = typeof s.note === "object" ? s.note.message : s.note ? t.ask[s.note] : "";
  let sec = 1;
  const num = () => String(sec++).padStart(2, "0");

  // 01 理解 → 02 搜尋 → 03 判斷 → 04 標出
  // pages are judged while later pages still load, so 搜尋 and 判斷 can both be active
  const searching = s.phase === "searching", judging = running && (!searching || total > 0);
  const steps: Step[] = [
    { label: t.ask.steps.understand, state: thinking ? "active" : s.active.length ? "done" : "idle",
      sub: thinking ? t.ask.stepNano : intent?.source === "nano" ? t.ask.seconds(((intent.ms ?? 0) / 1000).toFixed(1)) : intent?.source === "rule" ? t.ask.stepKeyword : s.active.length ? t.ask.stepPicked : "—" },
    { label: t.ask.steps.search, state: searching ? "active" : s.area ? "done" : "idle", sub: searching ? t.ask.queries(s.queries) : s.area ? t.ask.places(s.pool) : "—" },
    { label: t.ask.steps.judge, state: judging ? "active" : s.area && !searching ? "done" : "idle", sub: s.area ? (nanoBusy ? `Nano ${checked}/${total}` : `${checked}/${total}`) : "—" },
    { label: t.ask.steps.mark, state: s.area && !running ? "done" : matches.length ? "active" : "idle", sub: s.area ? t.ask.places(matches.length) : "—" },
  ];
  const showRail = thinking || !!s.area || running;
  // per question, over this area's places only (a scanner also keeps answers from earlier areas and searches)
  const per = s.active.map((id) => {
    const sc = s.scanners.get(id);
    const res = s.places.flatMap((p) => { const r = sc?.results.get(p.fid); return r ? [r] : []; });
    return { id, yes: res.filter(hasLunch).length, done: res.filter((r) => isFinal(r.verdict)).length };
  });

  return (
    <>
    {highlights}
    <PanelShell title={t.ask.title} sub={s.active.length ? s.active.map((id) => q(id).chip).join(lang === "en" ? " · " : "・") : t.ask.subIdle} onClose={onClose}>
      <section className="card tone-yellow min-h-0 gap-3 p-4">
        <SecHead index={num()} kicker="Ask" title={t.ask.heading} />
        <AskBar value={text} onChange={setText} onSubmit={submit} busy={thinking} placeholder={t.ask.placeholder} label={t.ask.submit} />
        {intent && <p key={intentNote(tt, intent, askedBudget)} className="fade-up m-0 text-[13px] font-bold">{intentNote(tt, intent, askedBudget)}</p>}
        {/* the entry is one sentence through Gemini Nano; the full chip rows are a dev tool */}
        {!dev && s.active.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10.5px] font-bold tracking-[.12em] text-muted uppercase">{t.ask.conditions}</span>
            {s.active.map((id) => (
              <ChipButton key={id} tone={QUESTIONS[id].tone} pressed={false} onClick={() => toggle(id)} title={t.ask.remove(q(id).chip)} className="fade-up">{q(id).chip} ×</ChipButton>
            ))}
          </div>
        )}
        {!dev && !s.active.length && !thinking && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10.5px] font-bold tracking-[.12em] text-muted uppercase">{t.ask.tryThese}</span>
            {t.ask.examples.map((ex) => (
              <button key={ex} type="button" className="chip chip-dashed cursor-pointer bg-white font-sans text-ink normal-case tracking-normal" onClick={() => { setText(ex); submit(ex); }}>{ex}</button>
            ))}
          </div>
        )}
        {dev && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {CHIP_ORDER.map((id) => (
                <ChipButton key={id} tone={QUESTIONS[id].tone} pressed={s.active.includes(id)} onClick={() => toggle(id)} title={q(id).title}>{q(id).chip}</ChipButton>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t-2 border-dashed border-ink pt-2.5">
              <span className="mr-1 font-mono text-[10.5px] font-bold tracking-[.12em] text-muted uppercase">{t.ask.addModifier}</span>
              {MODIFIER_ORDER.map((id) => (
                <ChipButton key={id} tone={QUESTIONS[id].tone} pressed={s.active.includes(id)} onClick={() => toggle(id)} title={q(id).title} className="px-2.5 py-1.5 text-[10.5px]">{q(id).chip}</ChipButton>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t-2 border-dashed border-ink pt-2.5">
              <span className="mr-1 font-mono text-[10.5px] font-bold tracking-[.12em] text-muted uppercase">{t.ask.types}</span>
              {TYPE_ORDER.map((id) => (
                <ChipButton key={id} tone={QUESTIONS[id].tone} pressed={s.active.includes(id)} onClick={() => toggle(id)} title={t.ask.typeOnly(q(id).chip)} className="px-2.5 py-1.5 text-[10.5px]">{q(id).chip}</ChipButton>
              ))}
            </div>
          </>
        )}
        {showRail && <StepRail steps={steps} className="fade-up" />}
        {!showRail && <p className="card-note m-0 text-[12px]">{t.ask.intro}</p>}
        {preload && preload.done < preload.total && <p className="m-0 flex items-center gap-2 font-mono text-[11px] font-bold text-muted"><LiveDot /> {t.ask.preparing(preload.done, preload.total)}</p>}
      </section>

      {s.active.length > 0 && (
        <section className="card tone-white min-h-0 gap-3 p-4">
          <SecHead index={num()} kicker={t.ask.kickerAnswer} title={s.active.length === 1 ? q(s.active[0]).title : t.ask.allOf(s.active.length)} />
          <div className="flex items-end gap-2">
            <b className="text-[64px] leading-[.85] tracking-[-.045em]"><CountUp value={matches.length} /></b>
            <b className="pb-1 text-[20px]">{t.ask.unit}</b>
            <span className="ml-auto pb-1 text-right font-mono text-[11px] font-bold text-muted uppercase">
              {strong > 0 && <><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink bg-green" /> {t.ask.sure} {strong}　</>}
              {matches.length - strong > 0 && <><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink bg-yellow" /> {t.ask.likely} {matches.length - strong}</>}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {per.map(({ id, yes, done }) => (
              <li key={id} className="grid grid-cols-[84px_1fr_64px] items-center gap-2">
                <span className="truncate text-[13px] font-bold">{q(id).chip}</span>
                <Meter value={yes} max={Math.max(done, 1)} tone={QUESTIONS[id].tone} />
                <span className="text-right font-mono text-[11px] font-bold text-muted">{yes}/{done}</span>
              </li>
            ))}
          </ul>
          {s.blocked && <p className="m-0 rounded-[16px] border-2 border-ink bg-red-soft px-3 py-2 text-[13px] font-bold">{t.ask.blocked(mins)}</p>}
          {s.waiting && <p className="m-0 text-[13px] font-bold">{t.ask.waiting}</p>}
          {s.paused && running && <p className="m-0 flex items-center gap-2 text-[13px] font-bold"><LiveDot /> {t.ask.pausedForReview}</p>}
          {s.moved && !running && <p className="m-0 text-[13px] font-bold">{t.ask.moved}</p>}
          {noteMsg && <p className="m-0 text-[13px] text-body">{noteMsg}</p>}
          {dev && running && reviewQs.length > 0 && nanoBusy && <p className="m-0 text-[12px] text-body">{t.ask.reviewNote}</p>}
          {dev && running && lunchOn && <p className="m-0 text-[12px] text-body">{t.ask.lunchNote}</p>}
          <div className="flex flex-wrap gap-2">
            {running ? <Button size="sm" busy onClick={s.stop}>{t.common.stop}</Button>
              : <Button size="sm" variant="primary" disabled={s.blocked} onClick={s.searchHere}>{s.moved || !s.area ? t.ask.searchHere : t.ask.searchAgain}</Button>}
            <Button size="sm" disabled={running || s.blocked || !s.area || s.roundsLeft <= 0} onClick={s.loadMore}>
              {s.area && s.roundsLeft <= 0 ? t.ask.allSearched : t.ask.loadMore}
            </Button>
            <Button size="sm" onClick={() => { s.clear(); setIntent(null); setText(""); setExpanded(null); }}>{t.ask.clear}</Button>
          </div>
        </section>
      )}

      {lunchOn && (
        <section className="card tone-green min-h-0 gap-2 p-4">
          <SecHead index={num()} kicker={t.ask.kickerBudget} title={t.ask.budgetTitle} />
          <div className="self-start">
            <SegToggle value={budget} onChange={setBudget}
              options={[{ value: "all", label: t.ask.budgetAny }, ...budgetChoices(askedBudget).map((b) => ({ value: String(b), label: `≤${yen(b)}` }))]} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t.ask.budgetMedian} value={index ? yen(index.median) : "—"} />
            <Stat label={t.ask.budgetRange} value={index ? <span className="text-[14px]">{yen(index.p25)}–{index.p75.toLocaleString("ja-JP")}</span> : "—"} />
            <Stat label={t.ask.budgetPriced} value={`${priced.length}/${matches.length}`} />
          </div>
          {/* how the cheapest dish is picked: dev mode only; the "too few prices" status stays */}
          {(dev || (!index && priced.length > 0)) && (
            <p className="card-note m-0 text-[12px]">
              {dev && t.ask.budgetNote}
              {!index && priced.length > 0 && t.ask.budgetFew(priced.length).trim()}
            </p>
          )}
        </section>
      )}

      {s.active.length > 0 && (
        <section className="card tone-blue min-h-0 gap-3 p-4">
          <SecHead index={num()} kicker={t.ask.kickerPlaces} title={budget !== "all" ? t.ask.within(yen(Number(budget))) : t.ask.placesTitle} />
          {budget === "all" && <div className="self-start"><SegToggle value={filter} onChange={setFilter} options={[{ value: "match", label: t.ask.filterMatch(matches.length) }, { value: "all", label: t.ask.filterAll(total) }]} /></div>}
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {shown.slice(0, 80).map((r) => (
              <Row key={r.fid} r={r} rank={ranks.get(r.fid)} dev={dev} tt={tt} open={expanded === r.fid} onToggle={() => setExpanded((x) => (x === r.fid ? null : r.fid))} onHover={setHot} />
            ))}
          </ul>
          {!shown.length && <p className="m-0 text-[13px] text-body">{running ? t.ask.checking : budget !== "all" ? t.ask.emptyBudget : t.ask.emptyArea}</p>}
          <p className="card-note m-0 text-[12px]">{t.ask.legend}{s.nanoState && s.nanoState !== "available" && t.ask.nanoState(s.nanoState)}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-dashed border-ink pt-3">
            <span className="flex items-center gap-2 font-mono text-[11px] font-bold">{t.ask.fadeOthers} <SegToggle value={dim} onChange={setDim} options={[{ value: "on", label: t.common.on }, { value: "off", label: t.common.off }]} /></span>
            {dev && <span className="flex items-center gap-2 font-mono text-[11px] font-bold">{t.ask.centre} <SegToggle value={centerMode} onChange={setCenterMode} options={[{ value: "canvas", label: t.ask.centreCanvas }, { value: "visible", label: t.ask.centreVisible }]} /></span>}
          </div>
        </section>
      )}

      {dev && (
        <section className="card tone-white min-h-0 gap-2 p-4">
          <Chip variant="ink" className="self-start">Dev mode</Chip>
          {s.active.map((id) => {
            const st = s.scanners.get(id)?.stats;
            return (
              <p key={id} className="m-0 font-mono text-[10.5px] text-muted">
                {id}: cache {st?.cached ?? 0} · search {st?.quick ?? 0} · rule {st?.ruled ?? 0} · fetch {st?.fetched ?? 0} · Nano {st?.nano ?? 0}{st?.nano ? ` (${Math.round(st.nanoMs / st.nano)}ms)` : ""} · err {st?.errors ?? 0}
              </p>
            );
          })}
          {preload && <p className="m-0 font-mono text-[10.5px] font-bold text-ink">Nano preload {preload.done}/{preload.total}{preload.done === preload.total ? " ✓" : "…"}</p>}
          <p className="m-0 font-mono text-[10.5px] text-muted">
            pool {s.pool} · round {(s.area?.round ?? 0) + 1} · {LUNCH_VERSION} · timeout {LUNCH_NANO.timeoutMs / 1000}s · cloud {s.advanced ? "on" : "off"} · cache {s.noCache ? "off" : "on"} · ranks {ranks.size}
          </p>
        </section>
      )}
    </PanelShell>
    </>
  );
}

/** One line per place (dot, rank, name, price, one chip per question); click to see the evidence and open the place. */
function Row({ r, rank, dev, tt, open, onToggle, onHover }: { r: AskRow; rank?: number; dev: boolean; tt: T; open: boolean; onToggle: () => void; onHover: (fid: string | null) => void }) {
  const { t, q } = tt;
  const yes = hasLunch(r), busy = !isFinal(r.verdict);
  const bg = r.verdict === "menu" ? LOOK.strongBg : r.verdict === "likely" ? LOOK.weakBg : "bg-white";
  const dot = r.verdict === "menu" ? "bg-green" : r.verdict === "likely" ? "bg-yellow" : "bg-white";
  const from = r.parts.some(([, p]) => p?.from === "shared") ? t.place.shared : r.parts.every(([, p]) => p?.from === "local") ? t.place.cached : "";
  return (
    <li className="fade-up" onMouseEnter={() => onHover(r.fid)} onMouseLeave={() => onHover(null)}>
      <div className={`overflow-hidden rounded-[18px] border-2 border-ink ${bg}`}>
        <button type="button" onClick={onToggle} onFocus={() => onHover(r.fid)} onBlur={() => onHover(null)} aria-expanded={open}
          className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left font-sans text-ink">
          {yes && rank != null ? <span className="map-num">{rank}</span> : <span className={`h-3 w-3 shrink-0 rounded-full border-2 border-ink ${dot}`} />}
          <b className="min-w-0 flex-1 truncate text-[13.5px]">{r.name}</b>
          {busy && <LiveDot />}
          {r.price && yes && <b className="shrink-0 text-[13px]">{yen(r.price.yen)}</b>}
          <span className="flex shrink-0 gap-1">
            {r.parts.map(([id, p]) => (
              <span key={id} title={partLabel(tt, id, p)}
                className={`chip px-1.5 py-1 text-[10px] tracking-[.04em] ${p && hasLunch(p) ? TONE_BG[QUESTIONS[id].tone] : "chip-dashed bg-white text-muted"}`}>{q(id).label}</span>
            ))}
          </span>
          <span className="shrink-0 font-mono text-[12px] font-bold" aria-hidden>{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <div className="fade-up flex flex-col gap-2 border-t-2 border-ink bg-white px-3 py-2.5">
            {r.parts.map(([id, p]) => (
              <div key={id} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className={`chip px-2 py-1 text-[10px] ${p && hasLunch(p) ? TONE_BG[QUESTIONS[id].tone] : "chip-dashed"}`}>{partLabel(tt, id, p)}</span>
                  {p?.evidence && <span className="font-mono text-[10px] font-bold tracking-wider text-muted uppercase">{t.source[p.evidence.source]}</span>}
                </span>
                {p?.evidence && <span className="text-[12px] leading-snug text-body">「{p.evidence.text}」</span>}
                {dev && p && <span className="font-mono text-[10px] text-muted">{id}:{p.verdict}{p.nano ? ` · nano ${p.nano.answer}${p.nano.downgraded ? `→${p.nano.downgraded}` : ""} ${p.nano.ms}ms` : ""}{p.note ? ` · ${p.note}` : ""}</span>}
              </div>
            ))}
            {r.price && yes && (
              <span className="flex min-w-0 items-baseline gap-2">
                <b className="text-[15px]">{yen(r.price.yen)}</b>
                <span className="min-w-0 flex-1 truncate text-[12px] text-body">{r.price.item}</span>
                <span className="shrink-0 font-mono text-[10px] font-bold tracking-wider text-muted uppercase">{t.priceSource[r.price.source]}</span>
              </span>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => openPlace(r.fid, r.name, r.pos)}>{t.place.open}</Button>
              {from && <span className="font-mono text-[10px] font-bold tracking-wider text-muted uppercase">{from}</span>}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
