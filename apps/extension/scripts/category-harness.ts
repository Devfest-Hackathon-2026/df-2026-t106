/*
 * Dev harness for 問地圖 place types: runs Maps searches on the current camera and tallies the hl=ja
 * category strings of the light records, so each type's category regex is written from real data.
 * Build: npx esbuild scripts/category-harness.ts --bundle --minify --format=iife --outfile=.output/category-harness.js
 * Options: window.__gmapCatOpts = { queries: [...] }. Results in window.__gmapCat.
 */
import { cameraOf } from "../lib/areaSearch";
import { extractFacts } from "../lib/lunch";
import { searchAt } from "../lib/mapsData";

const T: any = ((window as any).__gmapCat = { phase: "run", per: {} as Record<string, any> });
const opts = {
  queries: ["カフェ", "居酒屋", "バー", "ラーメン", "寿司", "焼肉", "和食", "定食", "イタリアン", "フレンチ", "洋食", "中華料理", "韓国料理", "タイ料理", "インド料理", "カレー", "ベーカリー", "ケーキ", "レストラン"],
  ...((window as any).__gmapCatOpts ?? {}),
};
(async () => {
  const camera = cameraOf(location.href)!;
  const all = new Map<string, number>();
  const firsts = new Map<string, number>();
  const seen = new Set<string>();
  await Promise.all(opts.queries.map(async (q: string) => {
    const found = await searchAt(q, camera, new AbortController().signal);
    const per = new Map<string, number>();
    for (const p of found) {
      if (!p.raw) continue;
      const cats = extractFacts(p.raw).categories;
      for (const c of cats) per.set(c, (per.get(c) ?? 0) + 1);
      if (seen.has(p.fid)) continue;
      seen.add(p.fid);
      for (const c of cats) all.set(c, (all.get(c) ?? 0) + 1);
      if (cats[0]) firsts.set(cats[0], (firsts.get(cats[0]) ?? 0) + 1);
    }
    T.per[q] = { n: found.length, top: [...per].sort((a, b) => b[1] - a[1]).slice(0, 12) };
  }));
  T.places = seen.size;
  T.all = [...all].sort((a, b) => b[1] - a[1]);
  T.firsts = [...firsts].sort((a, b) => b[1] - a[1]);
  T.phase = "done";
})().catch((e) => { T.phase = "error"; T.error = String(e?.stack || e); });
