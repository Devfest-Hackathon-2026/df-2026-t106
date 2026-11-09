/*
 * Dev harness: times one 問地圖 search round with the real collectRound (parallel queries, reused search
 * link, streamed pages). Build: npx esbuild scripts/search-timing.ts --bundle --minify --format=iife --outfile=.output/search-timing.js
 * Options: window.__gmapTimingOpts = { queries: [...] }. Results in window.__gmapTiming.
 */
import { cameraOf, collectRound } from "../lib/areaSearch";
import { QUIET } from "../lib/questions";

const T: any = ((window as any).__gmapTiming = { phase: "run", pages: [] as any[] });
const opts = { queries: ["静か カフェ", "静か レストラン", "デート レストラン", "ワインバー", "ビストロ", "レストラン"], ...((window as any).__gmapTimingOpts ?? {}) };
(async () => {
  const camera = cameraOf(location.href)!;
  const t0 = performance.now();
  const found = await collectRound(camera, opts.queries, new Set(), new AbortController().signal, undefined, undefined, QUIET, new Map(),
    (ps) => T.pages.push({ ms: Math.round(performance.now() - t0), n: ps.length }));
  T.totalMs = Math.round(performance.now() - t0);
  T.firstMs = T.pages[0]?.ms;
  T.places = found.length;
  T.phase = "done";
})().catch((e) => { T.phase = "error"; T.error = String(e?.stack || e); });
