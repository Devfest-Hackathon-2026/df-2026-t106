/*
 * Dev harness for 問地圖: runs the real area search + scanner for each template on the current Maps camera
 * (no extension APIs, memory cache) and records every Nano input/answer for manual review.
 * Build: npx esbuild scripts/ask-harness.ts --bundle --minify --format=iife --outfile=.output/ask-harness.js
 * Options (set before injecting): window.__gmapAskOpts = { templates: ["solo", "outlet"], nanoCap?: 25 }
 * Results land in window.__gmapAsk.
 */
import { cameraOf, collectRound } from "../lib/areaSearch";
import { fetchPlace, type FoundPlace } from "../lib/mapsData";
import { LunchNano, type NanoSpec } from "../lib/nanoLunch";
import { LunchScanner, summarize } from "../lib/lunchScan";
import { needsNano, QUESTIONS, type QuestionId } from "../lib/questions";
import type { LunchFacts } from "../lib/lunch";
import type { LunchStore } from "../lib/lunchStore";

const T: any = ((window as any).__gmapAsk = { phase: "init", per: {} as Record<string, any> });
const opts = { templates: ["solo", "cashless", "outlet"] as QuestionId[], ...((window as any).__gmapAskOpts ?? {}) };
const none: LunchStore = { async get() { return new Map(); }, async put() {} };

(async () => {
  T.nanoAvail = await LunchNano.available();
  const camera = cameraOf(location.href);
  if (!camera) throw new Error("no camera in URL");
  for (const id of opts.templates as QuestionId[]) {
    const spec = QUESTIONS[id];
    const t0 = performance.now();
    const rec: any = (T.per[id] = { phase: "search", judged: [] as any[] });
    const snips = new Map<string, string[]>();
    const found: FoundPlace[] = await collectRound(camera, spec.rounds[0], new Set(), new AbortController().signal, undefined, undefined, spec, snips);
    rec.found = found.length;
    rec.withKeyword = spec.kind === "ask" && spec.snippet ? found.filter((p) => p.snippets?.some((s) => spec.snippet!.keyword.test(s))).length : null;
    const nano = T.nanoAvail === "available" && needsNano(spec) ? new LunchNano(spec as NanoSpec) : null;
    const judge = nano && {
      async judge(f: LunchFacts, owner: string[], reviews: string[], signal: AbortSignal) {
        const j: any = { name: f.name, review: reviews[0] };
        rec.judged.push(j);
        try { return (j.answer = await nano.judge(f, owner, reviews, signal)); } catch (e) { j.error = String(e); throw e; }
      },
    };
    rec.phase = "scan";
    const sc = new LunchScanner({ fetchPlace, stores: { local: none }, nano: judge, onUpdate: () => {}, meal: spec, nanoCap: opts.nanoCap ?? Infinity });
    await sc.scan(found, new AbortController().signal);
    rec.summary = summarize(sc.list);
    rec.stats = sc.stats;
    rec.yes = sc.list.filter((r) => r.verdict === "menu" || r.verdict === "likely").slice(0, 12).map((r) => [r.name, r.verdict, r.evidence?.source, r.evidence?.text?.slice(0, 50)]);
    rec.sec = Math.round((performance.now() - t0) / 1000);
    rec.phase = "done";
    nano?.destroy();
  }
  T.phase = "done";
})().catch((e) => { T.phase = "error"; T.error = String(e?.stack || e); });
