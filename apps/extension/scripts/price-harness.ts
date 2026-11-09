/*
 * Dev harness for lunch prices: one "ランチ" Maps search around the current camera, fetches up to
 * `max` places through the gate and dumps the raw price material (menu items with their section,
 * owner/review sentences that carry a price) so extractor rules can be written from real data.
 * Build: npx esbuild scripts/price-harness.ts --bundle --minify --format=iife --outfile=.output/price-harness.js
 * Options (set before injecting): window.__gmapPriceOpts = { query: "ランチ", max: 40 }
 * Results land in window.__gmapPrice.
 */
import { fetchPlace, searchAt } from "../lib/mapsData";
import { cameraOf } from "../lib/areaSearch";
import { extractFacts } from "../lib/lunch";
import { lunchPrice } from "../lib/lunchPrice";

const T: any = ((window as any).__gmapPrice = { phase: "init", places: [] as any[] });
const opts = { query: "ランチ", max: 40, ...((window as any).__gmapPriceOpts ?? {}) };
const PRICE = /[0-9０-９][0-9０-９,，]*\s*円|[¥￥]\s*[0-9０-９]/;

const sentences = (texts: string[]) => {
  const out = new Set<string>();
  for (const t of texts) for (const s of t.replace(/\s+/g, " ").split(/(?<=[。！!？?\n])|\s(?=[#＃【■◆●・])/)) if (PRICE.test(s)) out.add(s.trim().slice(0, 160));
  return [...out];
};

(window as any).__gmapPriceRun = async () => {
  T.phase = "search";
  const camera = cameraOf(location.href);
  if (!camera) { T.phase = "error"; T.error = "no camera"; return; }
  const found = await searchAt(opts.query, camera, undefined, undefined, Math.min(100, opts.max), 1);
  T.found = found.length;
  T.phase = "fetch";
  const todo = found.slice(0, opts.max);
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let x = todo.shift(); x; x = todo.shift()) {
      try {
        const p = await fetchPlace(x.name, x.fid);
        const f = extractFacts(p);
        T.places.push({
          name: f.name, cats: f.categories.slice(0, 2), fid: f.fid,
          more: f.moreHours.map((h) => h.type),
          menu: f.menuRows,
          price: lunchPrice(f),
          owner: sentences(f.ownerText),
          reviews: sentences(f.reviewText),
        });
      } catch (e) { T.places.push({ name: x.name, error: String(e) }); }
    }
  }));
  T.phase = "done";
};
(window as any).__gmapPriceRun();
