/*
 * Dev harness for the lunch scan: runs the real scanner on the search list in the current Maps tab
 * (no extension APIs, memory cache) and records every Nano input/answer for manual tier-B review.
 * Build: npx esbuild scripts/lunch-harness.ts --bundle --minify --format=iife --outfile=.output/lunch-harness.js
 * Options (set before injecting): window.__gmapLunchOpts = { loadMore: 2 }  → also scrolls for 2 more pages.
 * Results land in window.__gmapLunch.
 */
import { fetchPlace } from "../lib/mapsData";
import { LunchNano } from "../lib/nanoLunch";
import { LunchScanner, summarize } from "../lib/lunchScan";
import { hoursSummary, type LunchFacts } from "../lib/lunch";
import type { LunchStore } from "../lib/lunchStore";
import { listedPlaces, loadMoreListed } from "../lib/searchList";

const T: any = ((window as any).__gmapLunch = { phase: "init", judged: [] as any[] });
const opts = { loadMore: 0, ...((window as any).__gmapLunchOpts ?? {}) };
// re-run without re-injecting: window.__gmapLunchRun() after changing the search
const none: LunchStore = { async get() { return new Map(); }, async put() {} };
const t0 = performance.now();

const run = async () => {
  T.phase = "init"; T.judged = [];
  T.nanoAvail = await LunchNano.available();
  const nano = T.nanoAvail === "available" ? new LunchNano() : null;
  const judge = nano && {
    async judge(f: LunchFacts, owner: string[], reviews: string[], signal: AbortSignal) {
      const rec: any = { name: f.name, cats: f.categories.slice(0, 2), hours: hoursSummary(f), owner, reviews };
      T.judged.push(rec);
      try { return (rec.answer = await nano.judge(f, owner, reviews, signal)); } catch (e) { rec.error = String(e); throw e; }
    },
  };
  const ac = new AbortController();
  T.abort = () => ac.abort();
  const sc = new LunchScanner({ fetchPlace, stores: { local: none }, nano: judge, onUpdate: () => {} });
  T.phase = "scanning";
  await sc.scan(listedPlaces(), ac.signal);
  for (let i = 0; i < opts.loadMore && !ac.signal.aborted; i++) {
    if (!(await loadMoreListed(ac.signal))) break;
    await sc.scan(listedPlaces(), ac.signal);
  }
  T.results = sc.list.map((r) => ({ name: r.name, verdict: r.verdict, ev: r.evidence?.text?.slice(0, 60), src: r.evidence?.source, nano: r.nano?.answer, note: r.note }));
  T.summary = summarize(sc.list);
  T.stats = sc.stats;
  T.sec = Math.round((performance.now() - t0) / 1000);
  T.phase = "done";
};
(window as any).__gmapLunchRun = () => run().catch((e) => { T.phase = "error"; T.error = String(e); });
(window as any).__gmapLunchRun();
