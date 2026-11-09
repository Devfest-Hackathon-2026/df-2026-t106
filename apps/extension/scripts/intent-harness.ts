/*
 * Dev harness for free text → templates (lib/nanoIntent.ts) with the real prompt, schema and cue gate.
 * Build: npx esbuild scripts/intent-harness.ts --bundle --minify --format=iife --outfile=.output/intent-harness.js
 * Results land in window.__gmapIntent ({ ok, n, wrong, ms }).
 */
import { IntentNano, resolveIntent, ruleIntent } from "../lib/nanoIntent";

const CASES: [string, string[]][] = [
  ["安靜的約會", ["date", "quiet"]], ["有氣氛的約會", ["date", "mood"]], ["可以看夜景的約會", ["date", "view"]],
  ["熱鬧的居酒屋聚會", ["chat", "lively", "izakaya"]], ["安靜可以讀書的地方", ["work", "quiet"]], ["深夜一個人吃飯", ["solo", "late_night"]],
  ["高級的記念日晚餐", ["date", "upscale"]], ["包廂で飲み会", ["chat", "private_room"]], ["静かなカフェで作業したい", ["work", "quiet", "cafe"]],
  ["おしゃれな雰囲気のデート", ["date", "mood"]], ["a quiet place for a date", ["date", "quiet"]], ["夜景がきれいなレストラン", ["view"]],
  ["安靜的咖啡廳", ["quiet", "cafe"]], ["隨性的晚餐，不用現金", ["cashless", "casual"]],
  ["一個人吃不尷尬", ["solo"]], ["有插座可以工作兩小時", ["outlet", "work"]], ["素食者有主餐", ["vegetarian"]],
  ["可以用 Suica 付", ["cashless"]], ["便宜的午餐", ["lunch"]], ["下午想吃蛋糕喝茶", ["tea"]], ["和朋友聊天聚會", ["chat"]],
  ["一個人可以充電的咖啡廳", ["solo", "outlet", "cafe"]], ["好吃的壽司", ["sushi"]], ["要停車", []],
  // place types (2026-11-01)
  ["深夜的居酒屋", ["late_night", "izakaya"]], ["約會吃義大利菜", ["date", "western"]], ["一個人吃拉麵", ["solo", "ramen"]],
  ["便宜的燒肉", ["yakiniku"]], ["韓式料理聚餐", ["chat", "asian"]], ["パン屋さん", ["sweets"]], ["安靜的酒吧", ["quiet", "bar"]],
  ["中華料理で飲み会", ["chat", "chinese"]], ["quiet sushi for a date", ["date", "quiet", "sushi"]], ["おいしいうどん", ["washoku"]],
  ["想吃麵", ["ramen"]], ["想喝杯酒", ["bar"]], ["想喝一杯", ["bar"]], ["吃點日本料理以外的", []],
  // 2026-11-04: Japanese is the primary UI language; the starter sentences of each language and common ja/en phrasings
  ["静かなデート", ["date", "quiet"]], ["一人で電源が使えるカフェ", ["solo", "outlet", "cafe"]], ["深夜に一人でごはん", ["solo", "late_night"]],
  ["1人でランチ", ["solo", "lunch"]], ["リモートで仕事できるカフェ", ["work", "cafe"]], ["カードが使える居酒屋", ["cashless", "izakaya"]],
  ["個室のある焼肉で記念日", ["date", "private_room", "yakiniku"]], ["レビューが良い店", []],
  ["quiet date spot", ["date", "quiet"]], ["solo cafe with outlets", ["solo", "outlet", "cafe"]], ["late-night solo meal", ["solo", "late_night"]],
  ["a cafe to work on my laptop", ["work", "cafe"]], ["good reviews", []],
];
const T: any = ((window as any).__gmapIntent = { phase: "run", res: [] as any[] });
(async () => {
  const avail = await IntentNano.available();
  const nano = avail === "available" ? new IntentNano() : null;
  T.avail = avail;
  for (const [q, exp] of CASES) {
    const r = await resolveIntent(q, nano, new AbortController().signal);
    const got = [...r.ids].sort().join(","), want = [...exp].sort().join(",");
    T.res.push({ q, want, got, ok: got === want, source: r.source, ms: r.ms, note: r.note, rule: ruleIntent(q).sort().join(",") });
  }
  T.ok = T.res.filter((x: any) => x.ok).length; T.n = T.res.length;
  T.ruleOk = T.res.filter((x: any) => x.rule === x.want).length;
  T.wrong = T.res.filter((x: any) => !x.ok).map((x: any) => [x.q, x.want, x.got, x.source, x.note]);
  T.msMax = Math.max(...T.res.map((x: any) => x.ms ?? 0));
  T.phase = "done";
})().catch((e) => { T.phase = "error"; T.error = String(e?.stack || e); });
