import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askVerdict, extractFacts, parseAttrs, quickVerdict, ruleVerdict } from "../lib/lunch";
import { PLACE, snippetOf } from "../lib/mapsData";
import { gate, lunchPrompt, type NanoSpec } from "../lib/nanoLunch";
import { aimQuery, BAR, CAFE, CASHLESS, DATE, IZAKAYA, LATE_NIGHT, LIVELY, MOOD, oneVenue, OUTLET, QUESTIONS, QUIET, RAMEN, roundCount, roundQueries, SOLO, SUSHI, TEA, VEGETARIAN, WASHOKU, WESTERN, WORK, type QuestionId } from "../lib/questions";
import { DICTS, UI_LANGS, type UiLang } from "../lib/i18n";
import { localLunchStore, toReport } from "../lib/lunchStore";
import { LunchScanner } from "../lib/lunchScan";
import { collectRound, ROUND_MAX_NEW } from "../lib/areaSearch";
import { gateModifiers, mergeIds, resolveIntent, ruleIntent, ruleType, toIds } from "../lib/nanoIntent";
import { combine } from "../lib/askCombine";
import { LUNCH } from "../lib/meals";

/* Light search records laid out like J[64][i][1]: attributes at [100] (flag entries [1, [[1|0]]]), the review quote at [142]. */
type Attr = [id: string, label: string, flag: 0 | 1 | null];
const attrEntry = ([id, label, flag]: Attr) =>
  [`/geo/type/establishment_poi/${id}`, label, flag == null ? [[2, null, null, ["/g/x", null, "無料 Wi-Fi あり"]], null, [23]] : [1, [[flag]]]];
const day = (name: string, s: number[], e: number[]) => [name, 1, [2026, 11, 2], [["x", [s, e]]], 0, 1];

function rec(o: { fid?: string; name?: string; cats?: string[]; attrs?: Attr[]; snippet?: string; hours?: unknown[]; lat?: number }) {
  const p: any[] = new Array(260).fill(null);
  p[PLACE.fid] = o.fid ?? "0x1:0x2";
  p[PLACE.name] = o.name ?? "テスト店";
  p[PLACE.categories] = o.cats ?? ["カフェ"];
  p[PLACE.coords] = [null, null, o.lat ?? 35.7, 139.7];
  p[PLACE.attrs] = [null, [["", (o.attrs ?? []).map(attrEntry)]]];
  if (o.snippet) p[PLACE.snippet] = [null, [[null, [[`"${o.snippet}"`]]]]];
  if (o.hours) p[PLACE.hours] = [o.hours];
  return p;
}
const facts = (o: Parameters<typeof rec>[0]) => extractFacts(rec(o));
const memKV = () => {
  const m = new Map<string, unknown>();
  return { m, kv: { async get(keys: string[]) { return Object.fromEntries(keys.filter((k) => m.has(k)).map((k) => [k, m.get(k)])); }, async set(o: Record<string, unknown>) { for (const [k, v] of Object.entries(o)) m.set(k, v); } } };
};

test("parseAttrs: id suffix, label, 0/1 flag; enum twins carry no flag", () => {
  const a = parseAttrs(rec({ attrs: [["suitable_for_solo_dining", "一人での食事", 1], ["requires_cash_only", "現金のみ", 0], ["wi_fi", "Wi-Fi", null]] })[PLACE.attrs]);
  assert.deepEqual(a, [
    { id: "suitable_for_solo_dining", label: "一人での食事", yes: true },
    { id: "requires_cash_only", label: "現金のみ", yes: false },
    { id: "wi_fi", label: "Wi-Fi", yes: null },
  ]);
});

test("snippetOf strips the quotes Maps wraps around the review", () => {
  assert.equal(snippetOf(rec({ snippet: "全席電源があるのはありがたい。" })), "全席電源があるのはありがたい。");
  assert.equal(snippetOf(rec({})), null);
});

test("attribute questions: yes → menu with the label, likely → likely, absent → unsure", () => {
  const solo = askVerdict(facts({ attrs: [["suitable_for_solo_dining", "一人での食事", 1]] }), SOLO);
  assert.deepEqual(solo, { verdict: "menu", evidence: { source: "attr", text: "一人での食事" } });
  assert.equal(askVerdict(facts({ attrs: [["has_counter_seating", "カウンター席", 1]] }), SOLO).verdict, "likely");
  assert.equal(askVerdict(facts({}), SOLO).verdict, "unsure");
  // the flagged twin decides, the enum twin of the same label never matches; Wi-Fi alone is no work spot
  assert.equal(askVerdict(facts({ attrs: [["has_wi_fi", "Wi-Fi", 1]] }), WORK).verdict, "unsure");
  assert.equal(askVerdict(facts({ attrs: [["feels_quiet", "静か", 1]] }), WORK).verdict, "likely");
  assert.equal(askVerdict(facts({ attrs: [["suitable_for_working_on_laptop", "ノートパソコンでの作業", 1]] }), WORK).verdict, "menu");
});

test("cashless: any payment attribute → menu; 現金のみ → none; explicit 0 on a yes-attribute → none", () => {
  assert.equal(askVerdict(facts({ attrs: [["pay_epayment_paypay", "PayPay", 1]] }), CASHLESS).verdict, "menu");
  assert.equal(askVerdict(facts({ attrs: [["requires_cash_only", "現金のみ", 1]] }), CASHLESS).verdict, "none");
  assert.equal(askVerdict(facts({ attrs: [["serves_vegetarian", "ベジタリアンメニュー", 0]] }), VEGETARIAN).verdict, "none");
});

test("下午茶: cafe category open 14–17 → menu, closed then → closed, dessert attribute → likely", () => {
  const open = [day("土曜日", [11], [19])], night = [day("土曜日", [18], [23])];
  assert.deepEqual(askVerdict(facts({ cats: ["カフェ"], hours: open }), TEA), { verdict: "menu", evidence: { source: "category", text: "カフェ" } });
  assert.equal(askVerdict(facts({ cats: ["カフェ"], hours: night }), TEA).verdict, "closed");
  assert.equal(askVerdict(facts({ cats: ["居酒屋"], hours: open, attrs: [["serves_dessert", "デザート", 1]] }), TEA).verdict, "likely");
});

test("non food places (parks, schools) never answer a question and never reach Nano", () => {
  assert.deepEqual(askVerdict(facts({ cats: ["公園"], snippet: "デートスポットとしてもおすすめです。" }), QUESTIONS.date as any), { verdict: "none", evidence: { source: "category", text: "公園" } });
  assert.equal(askVerdict(facts({ cats: ["英会話教室"], attrs: [["pay_epayment_paypay", "PayPay", 1]] }), CASHLESS).verdict, "none");
  assert.equal(askVerdict(facts({ cats: ["居酒屋"], attrs: [["pay_epayment_paypay", "PayPay", 1]] }), CASHLESS).verdict, "menu");
});

test("review questions: a keyword quote goes to Nano, anything else stays unsure", () => {
  const f = facts({ snippet: "全席電源があるのはありがたい。" });
  assert.deepEqual(ruleVerdict(f, OUTLET), { verdict: "nano", owner: [], reviews: ["全席電源があるのはありがたい。"] });
  assert.equal(quickVerdict(f, OUTLET), null);
  assert.equal(ruleVerdict(facts({ snippet: "コーヒーが美味しい。" }), OUTLET).verdict, "unsure");
  assert.match(lunchPrompt(f, [], ["全席電源がある"], OUTLET as NanoSpec), /Review: 全席電源がある/);
});

test("gate for a review question: quote must be in the input and keep the keyword", () => {
  const spec = OUTLET as NanoSpec, input = "Store: X\nReview: 全席電源があるのはありがたい。";
  assert.equal(gate({ answer: "yes", quote: "全席電源がある" }, input, 1, spec).answer, "yes");
  assert.equal(gate({ answer: "yes", quote: "ありがたい。" }, input, 1, spec).downgraded, "vague");
  assert.equal(gate({ answer: "yes", quote: "電源タップが各席に" }, input, 1, spec).downgraded, "quote-not-in-input");
});

test("scanner: attribute question settles from search records with no fetch and no Nano", async () => {
  let fetched = 0;
  const { kv, m } = memKV();
  const sc = new LunchScanner({
    fetchPlace: async () => { fetched++; throw new Error("no fetch"); },
    stores: { local: localLunchStore(kv, () => 1, "solo") }, nano: null, onUpdate: () => {}, meal: SOLO,
  });
  await sc.scan([
    { fid: "a", name: "a", raw: rec({ fid: "a", attrs: [["suitable_for_solo_dining", "一人での食事", 1]] }) },
    { fid: "b", name: "b", raw: rec({ fid: "b" }) },
  ], new AbortController().signal);
  assert.equal(fetched, 0);
  assert.equal(sc.results.get("a")!.verdict, "menu");
  assert.equal(sc.results.get("b")!.verdict, "unsure");
  assert.equal(sc.stats.quick, 2);
  assert.ok([...m.keys()].every((k) => k.startsWith("solo:")), "cached under the question's own namespace");
});

test("scanner: review question asks Nano only about keyword quotes; open unsure is not cached and is re-judged later", async () => {
  const asked: string[] = [];
  const { kv, m } = memKV();
  const sc = new LunchScanner({
    fetchPlace: async () => { throw new Error("no fetch"); },
    stores: { local: localLunchStore(kv, () => 1, "outlet") },
    nano: { async judge(_f, _o, reviews) { asked.push(reviews[0]); return { answer: reviews[0].includes("ありません") ? "no" : "yes", quote: reviews[0].slice(0, 7), ms: 5 }; } },
    onUpdate: () => {}, meal: OUTLET,
  });
  const signal = new AbortController().signal;
  await sc.scan([
    { fid: "y", name: "y", raw: rec({ fid: "y", snippet: "全席電源がある" }) },
    { fid: "n", name: "n", raw: rec({ fid: "n", snippet: "電源はありません。" }) },
    { fid: "u", name: "u", raw: rec({ fid: "u", snippet: "ケーキが美味しい" }) },
  ], signal);
  assert.deepEqual(asked.sort(), ["全席電源がある", "電源はありません。"]);
  assert.equal(sc.results.get("y")!.verdict, "likely");
  assert.equal(sc.results.get("y")!.evidence?.source, "review");
  assert.equal(sc.results.get("n")!.verdict, "none");
  assert.equal(sc.results.get("u")!.verdict, "unsure");
  assert.deepEqual([...m.keys()].map((k) => k.split(":").pop()).sort(), ["n", "y"], "keyword-less unsure is not cached");
  // another search later attaches a keyword quote to "u"
  await sc.scan([{ fid: "u", name: "u", raw: rec({ fid: "u", snippet: "ケーキが美味しい" }), snippets: ["コンセントあり"] }], signal);
  assert.equal(sc.results.get("u")!.verdict, "likely");
});

test("collectRound: questions skip the fetch budget and keep every query's review quote", async () => {
  const many = Array.from({ length: ROUND_MAX_NEW + 10 }, (_, i) => ({ fid: `p${i}`, name: `p${i}`, raw: rec({ fid: `p${i}`, lat: 35.7 + i * 1e-5 }) }));
  const out = await collectRound("@35.7,139.7,17z", ["X"], new Set(), new AbortController().signal, undefined, (async () => many) as any, SOLO);
  assert.equal(out.length, many.length);
  const snips = new Map<string, string[]>(), seen = new Set<string>();
  const byQuery: Record<string, any[]> = {
    "電源 カフェ": [{ fid: "c", name: "c", raw: rec({ fid: "c", snippet: "ケーキが美味しい" }) }],
    "Wi-Fi カフェ": [{ fid: "c", name: "c", raw: rec({ fid: "c", snippet: "Wi-Fiと電源あり" }) }],
  };
  const got = await collectRound("@35.7,139.7,17z", Object.keys(byQuery), seen, new AbortController().signal, undefined, (async (q: string) => byQuery[q]) as any, OUTLET, snips);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].snippets, ["ケーキが美味しい", "Wi-Fiと電源あり"]);
});

test("roundQueries: union of the selected questions' queries, deduped and capped", () => {
  assert.deepEqual(roundQueries([OUTLET, WORK], 0), ["電源 カフェ", "コンセント カフェ", "充電 カフェ", "作業 カフェ", "長居 カフェ", "勉強 カフェ"]);
  assert.deepEqual(roundQueries([SOLO, CASHLESS], 0), LUNCH.rounds[0]);
  assert.equal(roundQueries([OUTLET, WORK, TEA], 0).length, 6);
});

test("toReport: only Nano judgments of review questions leave the browser; attributes never do", () => {
  const base = { at: 1, v: "x" };
  assert.equal(toReport("f", { ...base, verdict: "menu", source: "attr" }, "solo"), null);
  assert.equal(toReport("f", { ...base, verdict: "menu", source: "attr" }, "work"), null);
  assert.equal(toReport("f", { ...base, verdict: "likely", source: "review" }, "outlet")?.key, "outlet~f");
  assert.equal(toReport("f", { ...base, verdict: "menu", source: "menu" }, "lunch")?.meal, "lunch");
});

test("firestore.rules: clients may only read tallies; votes, verdicts and quotas are server-only", () => {
  // (which questions may be voted on is checked by the server: services/classify/shared_ids.json, see lunch.test.ts)
  const rules = readFileSync(join(process.cwd(), "../../firestore.rules"), "utf8").replace(/\/\/.*$/gm, "");
  const allows = [...rules.matchAll(/allow ([\w, ]+): if ([^;]+);/g)].map((m) => `${m[1]}: ${m[2].trim()}`);
  assert.deepEqual(allows, ["read: true", "write: false", "read, write: false"]);
  assert.match(rules, /match \/tallies\/\{id\} \{\s*allow read: if true;/);
});

test("ruleIntent: zh/ja/en sentences pick templates without Nano; brunch is not lunch", () => {
  assert.deepEqual(ruleIntent("一個人吃不尷尬"), ["solo"]);
  assert.deepEqual(ruleIntent("有插座可以工作"), ["work", "outlet"]);
  assert.deepEqual(ruleIntent("週末早午餐"), ["brunch"]);
  assert.deepEqual(ruleIntent("便宜的午餐"), ["lunch"]);
  assert.deepEqual(ruleIntent("I don't eat meat"), ["vegetarian"]);
  assert.deepEqual(ruleIntent("要停車"), []);
});

test("resolveIntent: Nano first, rules when Nano is missing, empty or slow", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await resolveIntent("一個人", null, signal), { ids: ["solo"], source: "rule", note: { code: "nano-off" } });
  const both = await resolveIntent("一個人", { map: async () => ({ ids: ["date"], ms: 9 }) }, signal);
  assert.equal(both.source, "nano");
  assert.deepEqual(both.ids, ["date", "solo"], "a condition Nano dropped comes back from the keyword rules");
  assert.deepEqual((await resolveIntent("一個人", { map: async () => ({ ids: [], ms: 9 }) }, signal)).ids, ["solo"]);
  const slow = { map: async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; } };
  assert.deepEqual(await resolveIntent("一個人", slow, signal), { ids: ["solo"], source: "rule", note: { code: "nano-timeout" } });
  assert.deepEqual(await resolveIntent("要停車", slow, signal), { ids: [], source: "none", note: { code: "nano-timeout" } });
});

test("ruleIntent: every starter sentence of every UI language maps to its conditions without Nano", () => {
  const want: Record<UiLang, QuestionId[][]> = {
    ja: [["date", "quiet"], ["solo", "outlet", "cafe"], ["solo", "late_night"]],
    zh: [["date", "quiet"], ["solo", "outlet", "cafe"], ["solo", "late_night"]],
    en: [["date", "quiet"], ["solo", "outlet", "cafe"], ["solo", "late_night"]],
  };
  for (const lang of UI_LANGS) DICTS[lang].ask.examples.forEach((s, i) => assert.deepEqual(ruleIntent(s), want[lang][i], `${lang}: ${s}`));
});

test("ruleIntent: common Japanese words, and English words only as whole words", () => {
  assert.deepEqual(ruleIntent("1人でランチ"), ["solo", "lunch"]);
  assert.deepEqual(ruleIntent("昼食を安く"), ["lunch"]);
  assert.deepEqual(ruleIntent("リモートで仕事できるカフェ"), ["work", "cafe"]);
  assert.deepEqual(ruleIntent("カードが使える居酒屋"), ["cashless", "izakaya"]);
  assert.deepEqual(ruleIntent("a cafe to work on my laptop"), ["work", "cafe"]);
  assert.deepEqual(ruleIntent("レビューが良い店"), [], "レビュー (review) is not ビュー (view)");
  for (const s of ["good reviews", "any update", "free of charge", "powerful flavours", "discard"]) assert.deepEqual(ruleIntent(s), [], s);
});

test("combine: intersection of the selected questions", () => {
  const r = (fid: string, verdict: any) => ({ fid, name: fid, verdict });
  const table: Record<string, Record<string, any>> = {
    solo: { a: r("a", "menu"), b: r("b", "menu"), c: r("c", "none"), d: r("d", "menu") },
    outlet: { a: r("a", "menu"), b: r("b", "likely"), c: r("c", "likely"), d: r("d", "judging") },
  };
  const pool = ["a", "b", "c", "d", "e"].map((fid) => ({ fid, name: fid }));
  const rows = combine(pool, ["solo", "outlet"], (id, fid) => table[id][fid]);
  assert.deepEqual(rows.map((x) => [x.fid, x.verdict]), [["a", "menu"], ["b", "likely"], ["c", "none"], ["d", "judging"]]);
  assert.equal(QUESTIONS.solo.kind, "ask");
});

test("modifiers: 安靜 from feels_quiet, 落ち着く is only likely, an explicit 'not quiet' counts for 熱鬧", () => {
  assert.equal(askVerdict(facts({ attrs: [["feels_quiet", "静か", 1]] }), QUIET).verdict, "menu");
  assert.equal(askVerdict(facts({ attrs: [["feels_cozy", "落ち着く", 1]] }), QUIET).verdict, "likely");
  assert.equal(askVerdict(facts({ attrs: [["feels_quiet", "静か", 0]] }), QUIET).verdict, "none");
  assert.equal(askVerdict(facts({ attrs: [["feels_quiet", "静か", 0]] }), LIVELY).verdict, "likely");
  assert.equal(askVerdict(facts({ attrs: [["feels_quiet", "静か", 1]] }), LIVELY).verdict, "unsure");
  assert.equal(askVerdict(facts({ attrs: [["feels_romantic", "ロマンチック", 1]] }), MOOD).verdict, "menu");
  assert.equal(ruleVerdict(facts({ snippet: "照明が暗めでおしゃれな雰囲気。" }), MOOD).verdict, "nano");
});

test("深夜: the attribute, or hours past 23:30 on some day; early closing every day → none", () => {
  assert.equal(askVerdict(facts({ attrs: [["serves_late_night_food", "深夜の食事可", 1]] }), LATE_NIGHT).verdict, "menu");
  const late = askVerdict(facts({ hours: [day("金曜日", [17], [2])] }), LATE_NIGHT);
  assert.deepEqual(late, { verdict: "likely", evidence: { source: "hours", text: "金 17:00–2:00" } });
  assert.equal(askVerdict(facts({ hours: [day("金曜日", [11], [22])] }), LATE_NIGHT).verdict, "none");
  assert.equal(askVerdict(facts({}), LATE_NIGHT).verdict, "unsure");
});

test("intent: a modifier stays only when the sentence names it (cue gate)", () => {
  assert.deepEqual(gateModifiers("有插座可以工作兩小時", ["lively"]), []);
  assert.deepEqual(gateModifiers("下午想吃蛋糕喝茶", ["quiet"]), []);
  assert.deepEqual(toIds("安靜的約會", { purposes: ["date"], modifiers: ["quiet"] }), ["date", "quiet"]);
  assert.deepEqual(toIds("便宜的午餐", { purposes: ["lunch"], modifiers: ["casual"] }), ["lunch"]);
  assert.deepEqual(toIds("夜景がきれいなレストラン", { purposes: ["any"], modifiers: ["view"] }), ["view"]);
  assert.deepEqual(toIds("好吃的壽司", { purposes: ["none"], modifiers: [] }), []);
  assert.deepEqual(toIds("安靜的約會", { purposes: ["chat", "date"], modifiers: ["quiet"] }), ["date", "quiet"], "an uncued extra purpose is dropped");
  assert.deepEqual(toIds("想找個地方待著", { purposes: ["work", "chat"], modifiers: [] }), ["work"], "nothing cued: Nano's first purpose");
});

test("ruleIntent: purposes first, then the modifiers the sentence names", () => {
  assert.deepEqual(ruleIntent("安靜的約會"), ["date", "quiet"]);
  assert.deepEqual(ruleIntent("有包廂的聚會"), ["chat", "private_room"]);
  assert.deepEqual(ruleIntent("深夜一個人吃飯"), ["solo", "late_night"]);
  assert.deepEqual(ruleIntent("a quiet cafe"), ["quiet", "cafe"]);
});

test("scanner: Nano skips places another condition already rules out, and stops at the per-scan cap", async () => {
  const asked: string[] = [];
  const nano = { async judge(f: any) { asked.push(f.fid); return { answer: "yes" as const, quote: "静かで落ち着く", ms: 1 }; } };
  const places = ["a", "b", "c", "d"].map((fid) => ({ fid, name: fid, raw: rec({ fid, snippet: "静かで落ち着く" }) }));
  let blocked = new Set(["b"]);
  const sc = new LunchScanner({ fetchPlace: async () => { throw new Error("no"); }, stores: { local: localLunchStore(memKV().kv, () => 1, "quiet") },
    nano, onUpdate: () => {}, meal: QUIET, nanoFilter: (fid) => !blocked.has(fid), nanoCap: 2 });
  const signal = new AbortController().signal;
  await sc.scan(places, signal);
  assert.deepEqual(asked.sort(), ["a", "c"], "b fails another condition, d is past the cap");
  assert.equal(sc.results.get("b")!.skipped, true);
  assert.equal(sc.results.get("d")!.skipped, true);
  // the other condition is dropped: the next scan judges the skipped places
  blocked = new Set();
  sc.newRound();
  await sc.scan(places, signal);
  assert.deepEqual(asked.sort(), ["a", "b", "c", "d"]);
  assert.equal(sc.results.get("d")!.verdict, "likely");
});

test("scanner: a skipped place keeps its answer while it is retried, and two scans at once judge it once", async () => {
  const asked: string[] = [];
  const nano = { async judge(f: any) { asked.push(f.fid); await new Promise((r) => setTimeout(r, 5)); return { answer: "yes" as const, quote: "静かで落ち着く", ms: 1 }; } };
  const places = ["a", "b", "c"].map((fid) => ({ fid, name: fid, raw: rec({ fid, snippet: "静かで落ち着く" }) }));
  const seen: string[] = [];
  const sc = new LunchScanner({ fetchPlace: async () => { throw new Error("no"); }, stores: { local: localLunchStore(memKV().kv, () => 1, "quiet") },
    nano, onUpdate: () => { const r = sc.results.get("c"); seen.push(r ? r.verdict : "gone"); }, meal: QUIET, nanoCap: 2 });
  const signal = new AbortController().signal;
  await sc.scan(places, signal);
  assert.equal(sc.results.get("c")!.skipped, true, "c is past the cap");
  // the same round scans the pool once more (QuestionFinder.scanAll after the streamed pages): c is capped again
  const row = sc.results.get("c");
  seen.length = 0;
  await sc.scan(places, signal);
  assert.equal(sc.results.get("c"), row, "the same row");
  assert.ok(seen.length > 0 && seen.every((v) => v === "unsure"), `c never went back to a candidate: ${seen.join()}`);
  // the next round: two result pages with the same place are scanned at once; Nano reads c once
  sc.newRound();
  await Promise.all([sc.scan(places, signal), sc.scan(places, signal)]);
  assert.deepEqual(asked.sort(), ["a", "b", "c"]);
  assert.equal(sc.results.get("c")!.verdict, "likely");
  assert.equal(sc.results.get("c")!.skipped, false);
});

test("place types: any of the place's Maps categories, a hard requirement; no categories → unsure", () => {
  assert.deepEqual(askVerdict(facts({ cats: ["寿司店", "和食店", "居酒屋"] }), SUSHI), { verdict: "menu", evidence: { source: "category", text: "寿司店" } });
  assert.equal(askVerdict(facts({ cats: ["寿司店", "和食店", "居酒屋"] }), IZAKAYA).verdict, "menu");
  assert.deepEqual(askVerdict(facts({ cats: ["ラーメン屋"] }), CAFE), { verdict: "none", evidence: { source: "category", text: "ラーメン屋" } });
  assert.equal(askVerdict(facts({ cats: [] }), CAFE).verdict, "unsure");
  // measured noise in 池袋 results (research fixture place_types)
  assert.equal(askVerdict(facts({ cats: ["コスプレカフェ"] }), CAFE).verdict, "none");
  assert.equal(askVerdict(facts({ cats: ["カフェ・喫茶"] }), CAFE).verdict, "menu");
  assert.equal(askVerdict(facts({ cats: ["コーヒーショップ・喫茶店"] }), CAFE).verdict, "menu");
  assert.equal(askVerdict(facts({ cats: ["ガールズバー"] }), BAR).verdict, "none");
  assert.equal(askVerdict(facts({ cats: ["カクテル バー"] }), BAR).verdict, "menu");
  assert.equal(askVerdict(facts({ cats: ["ハンバーガー店"] }), BAR).verdict, "none");
  assert.equal(askVerdict(facts({ cats: ["油そば店"] }), WASHOKU).verdict, "none");
  assert.equal(askVerdict(facts({ cats: ["中華麺レストラン"] }), RAMEN).verdict, "menu");
  assert.equal(askVerdict(facts({ cats: ["日本式洋食レストラン"] }), WESTERN).verdict, "menu");
  assert.equal(askVerdict(facts({ cats: ["公園"] }), CAFE).verdict, "none");
});

test("aimQuery: other questions' searches follow the place type", () => {
  assert.deepEqual(aimQuery("静か カフェ", IZAKAYA), ["静か 居酒屋"]);
  assert.deepEqual(aimQuery("レストラン", RAMEN), ["ラーメン"]);
  assert.deepEqual(aimQuery("デート レストラン", WESTERN), ["デート イタリアン", "デート フレンチ"]);
  assert.deepEqual(aimQuery("喫茶店", CAFE), ["喫茶店"]);
  assert.deepEqual(aimQuery("ワインバー", RAMEN), [], "names another type");
  assert.deepEqual(aimQuery("居酒屋", CAFE), []);
  assert.deepEqual(aimQuery("ベジタリアン", RAMEN), ["ベジタリアン ラーメン"]);
  assert.deepEqual(aimQuery("アフタヌーンティー", CAFE), ["アフタヌーンティー カフェ"]);
});

test("roundQueries with a type: aimed queries first, then the type's own; rounds end with the last non-empty one", () => {
  assert.deepEqual(roundQueries([DATE, QUIET, CAFE], 0), ["デート カフェ", "静か カフェ", "カフェ", "喫茶店", "コーヒー"]);
  const all = Array.from({ length: roundCount([QUIET, CAFE]) }, (_, r) => roundQueries([QUIET, CAFE], r)).flat();
  assert.equal(new Set(all).size, all.length, "a query runs once");
  assert.deepEqual(roundQueries([RAMEN], 0), RAMEN.rounds[0]);
  assert.equal(roundCount([RAMEN]), RAMEN.rounds.length);
  assert.ok(roundCount([QUIET, CAFE]) >= 2);
  for (let r = 0; r < roundCount([QUIET, CAFE]); r++) assert.ok(roundQueries([QUIET, CAFE], r).length > 0, `round ${r}`);
});

test("one place type at a time: the last one added wins", () => {
  assert.deepEqual(oneVenue(["quiet", "cafe", "date", "ramen"]), ["quiet", "date", "ramen"]);
  assert.deepEqual(oneVenue(["quiet", "date"]), ["quiet", "date"]);
});

test("intent: place type from the word table only (the type named last)", () => {
  assert.equal(ruleType("一個人可以充電的咖啡廳"), "cafe");
  assert.equal(ruleType("好吃的拉麵"), "ramen");
  assert.equal(ruleType("韓式烤肉"), "yakiniku");
  assert.equal(ruleType("デートでイタリアン"), "western");
  assert.equal(ruleType("午餐定食"), null, "定食 stays with lunch");
  assert.equal(ruleType("下午想吃蛋糕"), null, "cake stays with 下午茶");
  assert.equal(ruleType("安靜的約會"), null);
  assert.equal(ruleType("ハンバーガー"), "western");
  // the two sentences Nano got that the first table missed (harness 2026-11-01)
  assert.equal(ruleType("想吃麵"), "ramen");
  assert.equal(ruleType("想喝一杯"), "bar");
  assert.equal(ruleType("想喝杯酒"), "bar");
  assert.equal(ruleType("烏龍麵"), "washoku");
  assert.equal(ruleType("義大利麵"), "western");
  assert.equal(ruleType("麵包店"), "sweets");
  assert.equal(ruleType("包廂で飲み会"), null, "飲み会 is a party, not a bar");
  assert.deepEqual(ruleIntent("深夜の居酒屋"), ["late_night", "izakaya"]);
  assert.deepEqual(mergeIds(["date", "quiet"], ["date", "sushi"]), ["date", "quiet", "sushi"]);
});
