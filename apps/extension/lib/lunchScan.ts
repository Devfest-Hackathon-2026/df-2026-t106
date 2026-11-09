import { extractFacts, quickVerdict, ruleVerdict, type Evidence, type LunchFacts, type Verdict } from "./lunch";
import type { LatLng, RawPlace } from "./mapsData";
import { LUNCH } from "./meals";
import type { QuestionSpec } from "./questions";
import { nanoTurn, type NanoAnswer } from "./nanoLunch";
import { lunchPrice, type LunchPrice } from "./lunchPrice";
import { cacheable, LUNCH_VERSION, type LunchStore, type StoredVerdict } from "./lunchStore";
import type { ListedPlace } from "./searchList";
import type { FoundPlace } from "./mapsData";

/*
 * One-click scan of one question (lunch, or a 問地圖 template) over the places the user is looking at:
 *   meal:     cache (local → shared) → fetch place JSON (3 at a time) → rules (tier A / closed / none)
 *             → Gemini Nano for tier B, one store at a time.
 *   question: cache → rules on the search record (attributes, review quote) → Nano for a keyword quote.
 */

export type Status = "pending" | "fetching" | "judging";
export type LunchResult = {
  fid: string; name: string;
  verdict: Verdict | Status;
  evidence?: Evidence;
  pos?: LatLng;
  from?: "local" | "shared";
  nano?: NanoAnswer;
  note?: string;
  /** cheapest lunch meal from menu / owner text / reviews; only read from a detail fetch */
  price?: LunchPrice;
  /** Nano was skipped (another condition already says no, or the per-scan cap); judged again on a later scan */
  skipped?: boolean;
};
export type ScanStats = { fetched: number; cached: number; ruled: number; quick: number; nano: number; nanoMs: number; errors: number };

type Judge = { judge(f: LunchFacts, owner: string[], reviews: string[], signal: AbortSignal): Promise<NanoAnswer>; warm?(): Promise<void> };
export type ScanDeps = {
  fetchPlace: (name: string, fid: string, signal: AbortSignal) => Promise<RawPlace>;
  stores: { local: LunchStore; shared?: LunchStore };
  nano: Judge | null;
  onUpdate: () => void;
  concurrency?: number;
  /** the question being answered (default LUNCH); kept as `meal` for the lunch call sites */
  meal?: QuestionSpec;
  now?: () => number;
  /** false → skip Nano for this place now (e.g. it already fails another selected question) */
  nanoFilter?: (fid: string) => boolean;
  /** at most this many Nano judgments per round (see newRound), nearest places first (default: no cap) */
  nanoCap?: number;
  /** while held, Nano judgments wait before taking a turn (問地圖 yields to 「お店の今」, lib/askPause) */
  pause?: { held(): boolean; resumed(signal: AbortSignal): Promise<void> };
};

/**
 * One queued Nano judgment. It carries the signal of the scan that queued it: one scanner's queue mixes
 * jobs of several scans (a search round, the place the user opened), and stopping one scan must neither
 * stop the others' jobs nor leave its own rows "judging".
 */
type NanoJob = { r: LunchResult; f: LunchFacts; owner: string[]; reviews: string[]; signal: AbortSignal; urgent: boolean; done: () => void };

export const isFinal = (v: LunchResult["verdict"]): v is Verdict => v !== "pending" && v !== "fetching" && v !== "judging";

export class LunchScanner {
  results = new Map<string, LunchResult>();
  stats: ScanStats = { fetched: 0, cached: 0, ruled: 0, quick: 0, nano: 0, nanoMs: 0, errors: 0 };
  private nanoQueue: NanoJob[] = [];
  private nanoRunning: Promise<void> | null = null;
  /** a row's queued Nano judgment, settled once it is judged or dropped */
  private judged = new WeakMap<LunchResult, Promise<void>>();
  /** rows of urgent scans: their Nano judgment goes first and is outside the per-round cap */
  private urgent = new WeakSet<LunchResult>();
  /** skipped rows a running scan is giving another chance */
  private retrying = new WeakSet<LunchResult>();
  private snips = new Map<string, string[]>();
  private nanoLeft = Infinity;

  constructor(private deps: ScanDeps) { this.nanoLeft = deps.nanoCap ?? Infinity; }

  /** Prepare the Nano session while the search downloads (no-op without Nano). */
  warmNano() { return this.deps.nano?.warm?.(); }

  /** A new search round: the Nano budget starts over (pages of one round arrive as several scan() calls). */
  newRound() { this.nanoLeft = this.deps.nanoCap ?? Infinity; }

  get spec(): QuestionSpec { return this.deps.meal ?? LUNCH; }

  get list() { return [...this.results.values()]; }
  get busy() { return this.list.some((r) => !isFinal(r.verdict)); }

  private set(r: LunchResult, patch: Partial<LunchResult>) { Object.assign(r, patch); this.deps.onUpdate(); }

  private async finish(r: LunchResult, verdict: Verdict, patch: Partial<LunchResult> = {}, persist = cacheable(verdict)) {
    // a retried row loses its "skipped" mark (and the note why) once it gets a real answer
    this.set(r, { verdict, skipped: false, note: undefined, ...patch });
    if (!persist) return;
    const rec: StoredVerdict = { verdict, source: r.evidence?.source, evidence: r.evidence?.text, lat: r.pos?.lat, lng: r.pos?.lng, price: r.price, at: (this.deps.now ?? Date.now)(), v: LUNCH_VERSION };
    await Promise.all([this.deps.stores.local.put([[r.fid, rec]]), this.deps.stores.shared?.put([[r.fid, rec]])]);
  }

  /**
   * Scans places not seen before; resolves when every one has a final verdict (or the signal aborts).
   * `cacheOnly`: restore from cache without a single request (places not cached are dropped).
   * `urgent`: the place the user just opened: its Nano judgment jumps the queue (also when it is already
   * waiting there) and does not count toward the per-round cap.
   */
  async scan(places: (ListedPlace | FoundPlace)[], signal: AbortSignal, opts: { cacheOnly?: boolean; urgent?: boolean } = {}) {
    if (opts.urgent) this.hurry(places.map((p) => p.fid));
    const raw = new Map(places.filter((p): p is FoundPlace => "raw" in p && !!p.raw).map((p) => [p.fid, p.raw]));
    const snips = new Map(places.filter((p): p is FoundPlace => "snippets" in p && !!p.snippets?.length).map((p) => [p.fid, p.snippets!]));
    // a review question left "unsure" gets another look once a later search brings a quote with its keyword
    const kw = this.spec.kind === "ask" ? this.spec.snippet?.keyword : undefined;
    if (kw) for (const [fid, ss] of snips) if (this.results.get(fid)?.verdict === "unsure" && ss.some((s) => kw.test(s))) this.results.delete(fid);
    for (const [fid, ss] of snips) this.snips.set(fid, ss); // concurrent scans (streamed pages) share it
    // places skipped earlier get another chance (the condition that excluded them may be gone now). The row
    // keeps its state until it is really judged again: deleting it first turned every skipped place back
    // into a candidate dot for a moment at the end of each search (the 判断 count fell 542 → 453).
    // (a row another running scan is already retrying is left to that scan, or Nano would judge it twice)
    const retry = [...new Set(places.map((p) => this.results.get(p.fid)).filter((r): r is LunchResult => !!r?.skipped && !this.retrying.has(r)))];
    const fresh = places.filter((p) => !this.results.has(p.fid)).map((p) => {
      const r: LunchResult = { fid: p.fid, name: p.name, verdict: "pending" };
      this.results.set(p.fid, r);
      return r;
    });
    const rows = [...fresh, ...retry];
    if (opts.urgent) for (const r of rows) this.urgent.add(r);
    this.deps.onUpdate();
    if (!rows.length) return;
    for (const r of retry) this.retrying.add(r);
    // stopped: this scan's queued judgments leave the queue now, not when their turn comes
    const drop = () => { this.nanoQueue = this.nanoQueue.filter((j) => j.signal !== signal || (j.done(), false)); };
    signal.addEventListener("abort", drop, { once: true });
    try { await this.scanFresh(rows, raw, signal, opts, new Set(fresh)); } finally {
      signal.removeEventListener("abort", drop);
      for (const r of retry) this.retrying.delete(r);
    }
  }

  /** Moves the queued judgments of these places to the front of the queue. */
  private hurry(fids: string[]) {
    const want = new Set(fids);
    const first = this.nanoQueue.filter((j) => want.has(j.r.fid));
    if (first.length) this.nanoQueue = [...first, ...this.nanoQueue.filter((j) => !want.has(j.r.fid))];
  }

  /** `isNew`: rows this scan created (a cache miss drops them in cacheOnly mode); the others are skipped rows retried. */
  private async scanFresh(rows: LunchResult[], raw: Map<string, RawPlace | undefined>, signal: AbortSignal, opts: { cacheOnly?: boolean }, isNew: Set<LunchResult>) {
    let todo = await this.fromCache(rows, "local");
    if (this.deps.stores.shared) todo = await this.fromCache(todo, "shared");
    if (opts.cacheOnly) {
      for (const r of todo) if (isNew.has(r)) this.results.delete(r.fid);
      this.deps.onUpdate();
      return;
    }

    // the search record settles places closed at meal time without a request; owner-set lunch hours
    // still need the detail fetch, because the menu (and so the price) lives there
    // questions (questions.ts) are answered from the search record alone: attributes + review quote, no fetch
    const queue: LunchResult[] = [];
    for (const r of todo) {
      const rec = raw.get(r.fid);
      const f = rec ? this.facts(extractFacts(rec), r.fid) : null;
      if (f?.pos) r.pos = f.pos;
      if (this.spec.kind === "ask") {
        if (f) { this.stats.quick++; await this.rule(r, f, signal, false); } else queue.push(r);
        continue;
      }
      const q = f && quickVerdict(f, this.spec);
      if (q?.verdict === "closed") { this.stats.quick++; await this.finish(r, q.verdict); } else queue.push(r);
    }
    const worker = async () => {
      for (let r = queue.shift(); r && !signal.aborted; r = queue.shift()) await this.fetchAndRule(r, signal);
    };
    await Promise.all(Array.from({ length: this.deps.concurrency ?? 3 }, worker));
    // only this scan's own Nano judgments (the queue may also hold other scans' jobs)
    await Promise.all(rows.map((r) => this.judged.get(r)));
    if (signal.aborted) for (const r of rows) if (!isFinal(r.verdict)) this.set(r, { verdict: "pending" });
    // aborted rows go back to "pending" and are dropped so a rescan picks them up
    for (const r of rows) if (r.verdict === "pending") this.results.delete(r.fid);
    this.deps.onUpdate();
  }

  private async fromCache(rows: LunchResult[], from: "local" | "shared") {
    const store = this.deps.stores[from]!;
    const hit = await store.get(rows.map((r) => r.fid)).catch(() => new Map<string, StoredVerdict>());
    const left: LunchResult[] = [];
    for (const r of rows) {
      const c = hit.get(r.fid);
      if (!c) { left.push(r); continue; }
      this.stats.cached++;
      this.set(r, { verdict: c.verdict, from, skipped: false, note: undefined, price: c.price, pos: c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : undefined, evidence: c.source && c.evidence ? { source: c.source as Evidence["source"], text: c.evidence } : undefined });
      if (from === "shared") await this.deps.stores.local.put([[r.fid, c]]);
    }
    return left;
  }

  private async fetchAndRule(r: LunchResult, signal: AbortSignal) {
    this.set(r, { verdict: "fetching" });
    let f: LunchFacts;
    try {
      f = extractFacts(await this.deps.fetchPlace(r.name, r.fid, signal));
      this.stats.fetched++;
    } catch (e) {
      if (signal.aborted) return;
      this.stats.errors++;
      return this.finish(r, "error", { note: (e as Error).message });
    }
    return this.rule(r, this.facts(f, r.fid), signal);
  }

  /** Merges the review quotes other searches attached to this place (see FoundPlace.snippets). */
  private facts(f: LunchFacts, fid: string): LunchFacts {
    const more = this.snips.get(fid);
    if (more) f.snippets = [...new Set([...f.snippets, ...more])];
    return f;
  }

  private async rule(r: LunchResult, f: LunchFacts, signal: AbortSignal, count = true) {
    if (f.pos) r.pos = f.pos;
    if (this.spec.kind === "meal") r.price = lunchPrice(f, this.spec) ?? undefined;
    const out = ruleVerdict(f, this.spec);
    if (out.verdict !== "nano") {
      if (count) this.stats.ruled++;
      // a review question without a keyword quote stays open: another search may bring one
      const keep = cacheable(out.verdict) && !(this.spec.kind === "ask" && this.spec.snippet && out.verdict === "unsure");
      return this.finish(r, out.verdict, { evidence: out.evidence }, keep);
    }
    const urgent = this.urgent.has(r);
    const capped = !urgent && this.nanoLeft <= 0;
    if (capped || (this.deps.nanoFilter && !this.deps.nanoFilter(r.fid)))
      return this.finish(r, "unsure", { skipped: true, note: capped ? "超過本輪 Nano 上限" : "其他條件不符，略過 Nano" }, false);
    if (!urgent) this.nanoLeft--;
    this.set(r, { verdict: "judging" });
    const job: NanoJob = { r, f, owner: out.owner, reviews: out.reviews, signal, urgent, done: () => {} };
    this.judged.set(r, new Promise<void>((settle) => { job.done = settle; }));
    if (urgent) this.nanoQueue.unshift(job); else this.nanoQueue.push(job);
    this.nanoRunning ??= this.drainNano().finally(() => { this.nanoRunning = null; });
  }

  private async drainNano() {
    for (let job = this.nanoQueue.shift(); job; job = this.nanoQueue.shift()) {
      try { await this.judgeOne(job); } finally { job.done(); }
    }
  }

  /** A turn in the page-wide Nano queue once no pause holds it; null if the job's scan stopped meanwhile. */
  private async nanoSlot(signal: AbortSignal): Promise<(() => void) | null> {
    for (;;) {
      try { await this.deps.pause?.resumed(signal); } catch { return null; }
      const release = await nanoTurn();
      if (signal.aborted) { release(); return null; }
      if (!this.deps.pause?.held()) return release;
      release(); // paused while waiting for the turn: hand it back and wait again
    }
  }

  private async judgeOne({ r, f, owner, reviews, signal, urgent }: NanoJob) {
    if (signal.aborted) return; // its scan puts the row back to "pending"
    const first: Evidence = owner.length ? { source: "owner", text: owner[0] } : { source: "review", text: reviews[0] };
    // without Nano a review question stays open (not cached) so a later scan with Nano can judge it
    if (!this.deps.nano) return this.finish(r, "unsure", { evidence: first, note: "Nano 不可用" }, this.spec.kind === "meal");
    const release = await this.nanoSlot(signal);
    if (!release) return;
    try {
      // other questions may have said no while this one waited for its turn
      if (this.deps.nanoFilter && !this.deps.nanoFilter(r.fid)) {
        if (!urgent) this.nanoLeft++;
        return await this.finish(r, "unsure", { skipped: true, note: "其他條件不符，略過 Nano" }, false);
      }
      const a = await this.deps.nano.judge(f, owner, reviews, signal);
      this.stats.nano++; this.stats.nanoMs += a.ms;
      const quoted: Evidence = { source: owner.some((s) => s.includes(a.quote.slice(0, 12))) ? "owner" : "review", text: a.quote };
      if (a.answer === "yes") await this.finish(r, "likely", { evidence: quoted, nano: a });
      else if (a.answer === "no") await this.finish(r, "none", { evidence: first, nano: a });
      else await this.finish(r, "unsure", { evidence: first, nano: a });
    } catch (e) {
      if (signal.aborted) return;
      this.stats.errors++;
      // timeouts are not cached so the next scan retries them
      await this.finish(r, "unsure", { evidence: first, note: `Nano：${(e as Error).name === "TimeoutError" ? "逾時" : (e as Error).message}` }, false);
    } finally { release(); }
  }
}

export function summarize(list: LunchResult[]) {
  const c = { menu: 0, likely: 0, none: 0, closed: 0, unsure: 0, error: 0, busy: 0 };
  for (const r of list) isFinal(r.verdict) ? c[r.verdict]++ : c.busy++;
  return c;
}
