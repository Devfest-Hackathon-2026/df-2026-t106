import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFacts, LUNCH_RE, opensAtMidday, parseDays, quickVerdict, ruleVerdict, snippets, tierA } from "../lib/lunch";
import { findPlace, parseMapsJson, preloadHref, PLACE } from "../lib/mapsData";
import { concreteLunch, gate, lunchPrompt, quoteInInput } from "../lib/nanoLunch";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromTally, localLunchStore, LUNCH_VERSION, MIN_AGREE, sharedLunchStore, toReport, type Report, type Tally } from "../lib/lunchStore";
import { createReportQueue, postReports } from "../lib/sharedRemote";
import { SHARED_IDS } from "../lib/questions";
import { LunchScanner, summarize } from "../lib/lunchScan";
import { fidFromHref } from "../lib/searchList";
import { placeCid } from "../lib/reviewFeed";

/* Synthetic place arrays laid out like the real /maps/preview/place record (indexes from fixtures/lunch-research-ikebukuro.json). */
const day = (name: string, ...segs: [number[], number[]][]) => [name, 1, [2026, 10, 30], segs.length ? segs.map(([s, e]) => [`${s}-${e}`, [s, e]]) : [["定休日"]], 0, 1];
const WEEK_SPLIT = [day("金曜日", [[11, 30], [14, 30]], [[17], [23]]), day("土曜日", [[12], [23]])];
const WEEK_NIGHT = [day("金曜日", [[17], [23, 30]]), day("土曜日", [[16], [2]])];

function mkPlace(o: { name?: string; fid?: string; hours?: unknown[]; more?: unknown[]; menu?: unknown; posts?: unknown; desc?: string; reviews?: unknown; cats?: string[] }) {
  const p: unknown[] = new Array(260).fill(null);
  p[PLACE.name] = o.name ?? "テスト店";
  p[PLACE.fid] = o.fid ?? "0x1:0x2";
  p[PLACE.categories] = o.cats ?? ["居酒屋"];
  p[PLACE.hours] = [o.hours ?? WEEK_SPLIT];
  p[PLACE.moreHours] = o.more ?? null;
  p[PLACE.menu] = o.menu ?? null;
  p[PLACE.posts] = o.posts ?? null;
  p[PLACE.description] = o.desc ? [o.desc] : null;
  p[PLACE.reviews] = o.reviews ?? null;
  return p as any[];
}
const menuOf = (sections: [string, [string, string][]][]) =>
  [[[null, sections.map(([s, items]) => [[s], items.map(([n, price]) => [[n, ""], [price], null, null, null, null, null, "id"])])]]];

test("LUNCH_RE ignores katakana words that contain ランチ", () => {
  for (const s of ["アランチーニ", "フランチャコルタ", "ブランチ", "ランチャー"]) assert.equal(LUNCH_RE.test(s), false, s);
  for (const s of ["ランチ", "平日ランチ1,200円", "LUNCH -ランチ-", "Lunch Set", "午餐", "お昼のセット", "昼定食"]) assert.equal(LUNCH_RE.test(s), true, s);
});

test("parseDays: Maps drops zero fields — 0時00分 is [] and 0時30分 is [null, 30]", () => {
  assert.deepEqual(parseDays([day("土曜日", [[11], []]), day("日曜日", [[17], [null as any, 30]]), day("月曜日", [[], [6]])]).map((d) => d.ranges),
    [[[660, 1440]], [[1020, 1470]], [[0, 360]]]);
  // evening-only izakaya closing at midnight is closed at lunch (was "unknown hours → open")
  assert.equal(ruleVerdict(extractFacts(mkPlace({ hours: [day("金曜日", [[17], []])] }))).verdict, "closed");
});

test("names marked 【閉店】 are closed, even with lunch on the menu", () => {
  const f = extractFacts(mkPlace({ name: "【閉店】京の里久 池袋店", menu: menuOf([["ランチ", [["ランチ御膳", "¥1,200"]]]]) }));
  assert.equal(ruleVerdict(f).verdict, "closed");
  assert.equal(quickVerdict(f)!.verdict, "closed");
  assert.equal(ruleVerdict(extractFacts(mkPlace({ name: "閉店セール食堂" }))).verdict, "none");
});

test("parseDays handles split hours, missing minutes, past-midnight and closed days", () => {
  const d = parseDays([day("金曜日", [[11, 30], [14, 30]], [[17], [23]]), day("土曜日", [[16], [4]]), day("日曜日")]);
  assert.deepEqual(d[0].ranges, [[690, 870], [1020, 1380]]);
  assert.deepEqual(d[1].ranges, [[960, 240 + 1440]]);
  assert.deepEqual(d[2].ranges, []);
});

test("tier A: lunch menu section wins", () => {
  const f = extractFacts(mkPlace({ menu: menuOf([["前菜", [["サラダ", "¥500"]]], ["ランチ Pranzo", [["パスタランチ", "¥1,200"]]]]) }));
  assert.deepEqual(f.menuSections, ["前菜", "ランチ Pranzo"]);
  assert.deepEqual(tierA(f), { source: "menu", text: "ランチ Pranzo" });
  assert.equal(ruleVerdict(f).verdict, "menu");
});

test("tier A: lunch menu item without a lunch section", () => {
  const f = extractFacts(mkPlace({ menu: menuOf([["コース", [["【ランチカジュアルコース】", "¥3,000"], ["ディナー", "¥6,000"]]]]) }));
  assert.equal(tierA(f)?.text, "【ランチカジュアルコース】");
});

test("tier A: owner-set ランチ secondary hours", () => {
  const f = extractFacts(mkPlace({ more: [["ランチ", null, null, [[day("金曜日", [[11, 30], [14, 30]])]]], ["テイクアウト", null, null, [[]]]] }));
  assert.deepEqual(f.moreHours.map((h) => h.type), ["ランチ", "テイクアウト"]);
  assert.deepEqual(tierA(f), { source: "hours", text: "ランチ 11:30–14:30" });
});

test("dinner-only places are 'closed' at lunch even if text says ランチ (SEO hashtags)", () => {
  const f = extractFacts(mkPlace({ hours: WEEK_NIGHT, desc: "池袋グルメ 池袋ランチ 池袋居酒屋" }));
  assert.equal(opensAtMidday(f), false);
  assert.equal(ruleVerdict(f).verdict, "closed");
});

test("no lunch mention anywhere → none; text mention → nano with snippets", () => {
  assert.equal(ruleVerdict(extractFacts(mkPlace({ desc: "焼鳥と日本酒の店" }))).verdict, "none");
  const out = ruleVerdict(extractFacts(mkPlace({ posts: [[null, ["【期間限定ランチ販売】鶏ちゃん焼定食 販売開始！"]]], reviews: [["アランチーニが美味しかったです本当に"]] })));
  assert.equal(out.verdict, "nano");
  if (out.verdict !== "nano") return;
  assert.equal(out.owner.length, 1);
  assert.equal(out.reviews.length, 0, "アランチーニ must not count");
});

test("snippets dedupe repeated translations and cap the count", () => {
  const s = snippets(["今日のランチは最高", "今日のランチは最高", "ランチA", "ランチB", "ランチC"], 3);
  assert.equal(s.length, 3);
  assert.equal(s[0], "今日のランチは最高");
});

test("maps JSON helpers: XSSI prefix, preload link, place lookup", () => {
  assert.deepEqual(parseMapsJson(")]}'\n[1,2]"), [1, 2]);
  const html = `<link href="/maps/preview/place?authuser=0&amp;hl=ja&amp;pb=!1m2" as="fetch" rel="preload">`;
  assert.equal(preloadHref(html, "/maps/preview/place"), "/maps/preview/place?authuser=0&hl=ja&pb=!1m2");
  assert.equal(preloadHref("<html></html>", "/maps/preview/place"), null);
  const p = mkPlace({ name: "鳥良商店 南池袋店" });
  assert.equal(findPlace([null, [5, [p]]])?.[PLACE.name], "鳥良商店 南池袋店");
});

test("fidFromHref reads the feature id from a result link", () => {
  assert.equal(fidFromHref("https://www.google.com/maps/place/X/data=!4m7!3m6!1s0x60188d681355b373:0x984160981caefe27!8m2"), "0x60188d681355b373:0x984160981caefe27");
  assert.equal(fidFromHref("https://www.google.com/maps/place/X"), null);
  // opened from another place's page: the previous place stays in a nested block, the current one is last
  const nested = "https://www.google.com/maps/place/Y/@35.68,139.69,17z/data=!3m1!5s0x60188cd14404a7f7:0xe76948e54b968a5f!4m18!1m9!3m8!1s0x60188daf406b3ccf:0xba56b4c06cdd0923!2zX!8m2!3d35.6!4d139.6!9m1!1b1!16s%2Fg%2F11swk01kc5!3m7!1s0x60188cd16f458895:0x1c79e85a760a66b!8m2!3d35.6!4d139.6!9m1!1b1!16s%2Fg%2F11c1vpq9c2?hl=ja";
  assert.equal(fidFromHref(nested), "0x60188cd16f458895:0x1c79e85a760a66b");
  assert.equal(placeCid(nested), "1c79e85a760a66b");
  assert.equal(placeCid("https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x60188d67c8f4d177:0x363b5a4b8f64a7e0!8m2"), "363b5a4b8f64a7e0");
});

test("quoteInInput rejects quotes the model made up", () => {
  const f = extractFacts(mkPlace({ name: "店" }));
  const input = lunchPrompt(f, ["ランチは豊富な本格パスタをメインに"], []);
  assert.equal(quoteInInput("ランチは豊富な本格パスタ", input), true);
  assert.equal(quoteInInput("「ランチは 豊富な本格パスタ」", input), true);
  assert.equal(quoteInInput("日替わりランチ 900円", input), false);
  assert.equal(quoteInInput("", input), false);
});

function memKV() {
  const m = new Map<string, unknown>();
  return { m, kv: { async get(keys: string[]) { return Object.fromEntries(keys.filter((k) => m.has(k)).map((k) => [k, m.get(k)])); }, async set(o: Record<string, unknown>) { for (const [k, v] of Object.entries(o)) m.set(k, v); } } };
}

test("local store: TTL, version, errors not cached", async () => {
  let now = 1_000_000;
  const { kv } = memKV();
  const s = localLunchStore(kv, () => now);
  await s.put([["a", { verdict: "menu", at: now, v: LUNCH_VERSION }], ["b", { verdict: "error", at: now, v: LUNCH_VERSION }]]);
  assert.deepEqual([...(await s.get(["a", "b"])).keys()], ["a"]);
  now += 15 * 24 * 3600_000;
  assert.equal((await s.get(["a"])).size, 0);
});

test("shared report never carries Maps text or any position", () => {
  const row = toReport("f", { verdict: "menu", source: "menu", evidence: "ランチは豊富な本格パスタ", lat: 35.7295, lng: 139.7109,
    price: { yen: 1078, item: "日替わりランチ", source: "owner", items: 3 }, at: 1, v: LUNCH_VERSION })!;
  assert.deepEqual(row, { key: "lunch~f", meal: "lunch", fid: "f", verdict: "menu", v: LUNCH_VERSION, source: "menu", yen: 1078, yenSource: "owner" });
  assert.equal(toReport("f", { verdict: "unsure", at: 1, v: LUNCH_VERSION }), null);
  assert.equal(toReport("f", { verdict: "error", at: 1, v: LUNCH_VERSION }), null);
  // a price on a "none" verdict is noise, not shared
  assert.equal(toReport("f", { verdict: "none", price: { yen: 900, item: "x", source: "review", items: 1 }, at: 1, v: LUNCH_VERSION })!.yen, undefined);
});

const tally = (p: Partial<Tally>): Tally => ({ key: "lunch~f", meal: "lunch", fid: "f", v: LUNCH_VERSION, verdict: "menu", agree: 2, total: 2, at: 1000, ...p });

test("tally: used only when 2 people agree, under this version, within 30 days", () => {
  assert.equal(MIN_AGREE, 2);
  const now = 2000;
  const m = fromTally(tally({ yen: 1100, yenSource: "menu", source: "menu", agree: 3, total: 4 }), now)!;
  assert.deepEqual(m, { verdict: "menu", source: "menu", price: { yen: 1100, item: "", source: "menu", items: 0 }, at: 1000, v: LUNCH_VERSION, reports: 3 });
  assert.equal(fromTally(tally({ agree: 1, total: 1 }), now), null, "one anonymous vote is not enough");
  assert.equal(fromTally(tally({ v: "r0" }), now), null, "another rules version");
  assert.equal(fromTally(tally({}), 1000 + 30 * 24 * 3600_000), null, "30 days old");
});

test("shared store: nothing while 拡張機能 is off; reads tallies by key; writes only shareable verdicts", async () => {
  const asked: string[][] = [], wrote: Report[][] = [];
  let on = false;
  const s = sharedLunchStore({
    remote: {
      async read(keys) { asked.push(keys); return [tally({ fid: "a", key: "lunch~a" }), tally({ fid: "b", key: "lunch~b", agree: 1, total: 1 })]; },
      async write(r) { wrote.push(r); },
    },
    enabled: () => on, now: () => 2000,
  });
  // off: no read, no write
  assert.equal((await s.get(["a", "b"])).size, 0);
  await s.put([["a", { verdict: "menu", at: 1, v: LUNCH_VERSION }]]);
  assert.deepEqual([asked.length, wrote.length], [0, 0]);
  on = true;
  const got = await s.get(["a", "b"]);
  assert.deepEqual(asked, [["lunch~a", "lunch~b"]]);
  assert.deepEqual([...got.keys()], ["a"], "b has a single vote, so it is judged locally");
  assert.equal(got.get("a")!.verdict, "menu");
  // "unsure" is not shareable, so only a is written
  await s.put([["a", { verdict: "menu", at: 1, v: LUNCH_VERSION }], ["b", { verdict: "unsure", at: 1, v: LUNCH_VERSION }]]);
  assert.deepEqual(wrote.map((w) => w.map((r) => r.fid)), [["a"]]);
});

test("vote queue: one request per pause, newest vote per place wins, at most 50 per request", async () => {
  const sent: Report[][] = [];
  const timers: (() => void)[] = [];
  const q = createReportQueue({ post: async (r) => { sent.push(r); }, setTimer: (fn) => { timers.push(fn); } });
  const r = (fid: string, verdict: Report["verdict"] = "menu"): Report => ({ key: `lunch~${fid}`, meal: "lunch", fid, verdict, v: LUNCH_VERSION });
  await q.add([r("a")]);
  await q.add([r("b"), r("a", "none")]);
  assert.equal(sent.length, 0, "waits for the pause");
  assert.equal(timers.length, 1, "one timer for the whole burst");
  timers[0]();
  assert.deepEqual(sent, [[r("b"), r("a", "none")]]);
  await q.add(Array.from({ length: 120 }, (_, i) => r(`x${i}`)));
  assert.deepEqual(sent.slice(1).map((b) => b.length), [50, 50, 20], "a full batch goes at once, split by 50");
});

test("vote request: ID token, JSON body, HTTP 429 becomes quota", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const post = postReports(async () => "tok", "https://svc/report", (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status }); }) as typeof fetch);
  const v: Report = { key: "lunch~f", meal: "lunch", fid: "f", verdict: "menu", v: LUNCH_VERSION };
  await post([v]);
  assert.equal(calls[0].url, "https://svc/report");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { reports: [v] });
  status = 429;
  await assert.rejects(post([v]), /^Error: quota$/);
});

test("the server accepts votes for exactly the questions the extension shares", () => {
  const server = JSON.parse(readFileSync(join(process.cwd(), "../../services/classify/shared_ids.json"), "utf8")) as string[];
  assert.deepEqual([...server].sort(), [...SHARED_IDS].sort());
});

test("scanner: cache → rules → nano, with quote check and persistence", async () => {
  const places: Record<string, any[]> = {
    A: mkPlace({ fid: "A", menu: menuOf([["LUNCH -ランチ-", [["ランチセット", "¥1,100"]]]]) }),
    B: mkPlace({ fid: "B", desc: "ランチは豊富な本格パスタをメインにご用意" }),
    C: mkPlace({ fid: "C", hours: WEEK_NIGHT, desc: "#池袋ランチ" }),
    D: mkPlace({ fid: "D", posts: [[null, ["土日祝は昼飲みもできます。お友達とのランチにも"]]] }),
    E: mkPlace({ fid: "E" }),
  };
  const { kv, m } = memKV();
  const local = localLunchStore(kv);
  await local.put([["E", { verdict: "none", at: Date.now(), v: LUNCH_VERSION }]]);
  const fetched: string[] = [];
  const sc = new LunchScanner({
    fetchPlace: async (_n, fid) => { fetched.push(fid); if (fid === "X") throw new Error("boom"); return places[fid]; },
    stores: { local },
    nano: {
      async judge(f) {
        if (f.fid === "B") return { answer: "yes", quote: "ランチは豊富な本格パスタ", ms: 5 };
        return { answer: "no", quote: "昼飲み", ms: 5 };
      },
    },
    onUpdate: () => {},
  });
  await sc.scan(["A", "B", "C", "D", "E", "X"].map((fid) => ({ fid, name: fid })), new AbortController().signal);
  const v = Object.fromEntries(sc.list.map((r) => [r.fid, r.verdict]));
  assert.deepEqual(v, { A: "menu", B: "likely", C: "closed", D: "none", E: "none", X: "error" });
  assert.equal(fetched.includes("E"), false, "cached place is not fetched");
  assert.equal(sc.results.get("E")?.from, "local");
  assert.equal(sc.results.get("B")?.evidence?.text, "ランチは豊富な本格パスタ");
  assert.deepEqual(summarize(sc.list), { menu: 1, likely: 1, none: 2, closed: 1, unsure: 0, error: 1, busy: 0 });
  assert.equal([...m.keys()].some((k) => k.endsWith(":X")), false, "errors are not cached");
  // second scan of the same list is a no-op; new places are added after
  await sc.scan([{ fid: "A", name: "A" }], new AbortController().signal);
  assert.equal(fetched.filter((f) => f === "A").length, 1);
});

test("scanner: without Nano, tier B becomes unsure with owner evidence", async () => {
  const sc = new LunchScanner({
    fetchPlace: async () => mkPlace({ fid: "B", desc: "ランチからお食事をお楽しみいただけます" }),
    stores: { local: localLunchStore(memKV().kv) },
    nano: null,
    onUpdate: () => {},
  });
  await sc.scan([{ fid: "B", name: "B" }], new AbortController().signal);
  assert.equal(sc.results.get("B")?.verdict, "unsure");
  assert.equal(sc.results.get("B")?.evidence?.source, "owner");
});

test("coordsOf reads [9] = [null, null, lat, lng] and falls back to a nested quad", async () => {
  const { coordsOf } = await import("../lib/mapsData");
  const p = mkPlace({});
  p[9] = [null, null, 35.7280039, 139.7128001];
  assert.deepEqual(coordsOf(p), { lat: 35.7280039, lng: 139.7128001 });
  const q = mkPlace({});
  q[20] = [[null, null, 35.1, 139.2]];
  assert.deepEqual(coordsOf(q), { lat: 35.1, lng: 139.2 });
  assert.equal(coordsOf(mkPlace({})), null);
  assert.deepEqual(extractFacts(p).pos, { lat: 35.7280039, lng: 139.7128001 });
});

test("map projection: URL parse, centre maps to rect centre, 1 zoom = 2× distance", async () => {
  const { parseView, project, centerRect, worldPx } = await import("../lib/mapView");
  const v = parseView("https://www.google.com/maps/search/x/@35.7280039,139.7128001,17z/data=!3m1")!;
  assert.deepEqual(v, { lat: 35.7280039, lng: 139.7128001, zoom: 17 });
  assert.equal(parseView("/maps/place/x/@35.7,139.7,1200m/data"), null);
  assert.deepEqual(parseView("/@35.7,139.7,15.5z"), { lat: 35.7, lng: 139.7, zoom: 15.5 });
  const rect = { left: 0, top: 0, width: 1000, height: 800 };
  assert.deepEqual(project(v, v, rect), { x: 500, y: 400 });
  // zoom 0: whole world = 256 px; lng 0 → x 128
  assert.equal(worldPx({ lat: 0, lng: 0 }, 0).x, 128);
  assert.ok(Math.abs(worldPx({ lat: 0, lng: 0 }, 0).y - 128) < 1e-9);
  const east = { lat: v.lat, lng: v.lng + 0.001 };
  const d17 = project(east, v, rect).x - 500, d18 = project(east, { ...v, zoom: 18 }, rect).x - 500;
  assert.ok(Math.abs(d18 - 2 * d17) < 1e-6 && d17 > 0);
  const north = project({ lat: v.lat + 0.001, lng: v.lng }, v, rect);
  assert.ok(north.y < 400, "north is up");
  assert.deepEqual(centerRect(rect, 420, "visible"), { left: 420, top: 0, width: 580, height: 800 });
  assert.equal(centerRect(rect, 420, "canvas"), rect);
});

test("scanner keeps coordinates and caches them locally", async () => {
  const p = mkPlace({ fid: "A", menu: menuOf([["ランチ", [["定食", "¥900"]]]]) });
  p[9] = [null, null, 35.73, 139.71];
  const { kv } = memKV();
  const local = localLunchStore(kv);
  const sc = new LunchScanner({ fetchPlace: async () => p, stores: { local }, nano: null, onUpdate: () => {} });
  await sc.scan([{ fid: "A", name: "A" }], new AbortController().signal);
  assert.deepEqual(sc.results.get("A")?.pos, { lat: 35.73, lng: 139.71 });
  const sc2 = new LunchScanner({ fetchPlace: async () => { throw new Error("should hit cache"); }, stores: { local }, nano: null, onUpdate: () => {} });
  await sc2.scan([{ fid: "A", name: "A" }], new AbortController().signal);
  assert.deepEqual(sc2.results.get("A")?.pos, { lat: 35.73, lng: 139.71 });
  assert.equal(sc2.results.get("A")?.from, "local");
});

test("gate: real 2026-10-30 Nano answers from 池袋 ランチ", () => {
  const input = lunchPrompt(extractFacts(mkPlace({})), [
    "池袋でイタリアンを楽しめる当店では、ランチからお酒を囲んだお集まりまで",
    "【池袋の和食ランチはここ！おかわり自由の炊き立てご飯が魅力の定食屋】",
  ], ["日替わりランチ900円でこのボリューム！", "定食系が充実していて、コスパもかなりいいです。ただし、お昼ど真ん中は行列"]);
  // marketing only → vague
  assert.equal(gate({ answer: "yes", quote: "ランチからお酒を囲んだお集まりまで" }, input, 1).downgraded, "vague");
  // concrete
  assert.equal(gate({ answer: "yes", quote: "日替わりランチ900円でこのボリューム！" }, input, 1).answer, "yes");
  assert.equal(gate({ answer: "yes", quote: "【池袋の和食ランチはここ！おかわり自由の炊き立てご飯が魅力の定食屋】" }, input, 1).answer, "yes");
  // spliced quote (not in input)
  assert.equal(gate({ answer: "yes", quote: "定食系が充実していて、コスパもかなりいいです。ランチどきは行列が出来ている" }, input, 1).downgraded, "quote-not-in-input");
  // no/unsure pass through
  assert.equal(gate({ answer: "no", quote: "x" }, input, 1).answer, "no");
});

test("concreteLunch keeps known true positives", () => {
  for (const q of ["【期間限定ランチ販売】鶏ちゃん焼定食", "ランチは豊富な本格パスタをメインに", "おすすめランチ が始まります", "Lunch Set On Weekdays"]) assert.equal(concreteLunch(q), true, q);
  for (const q of ["ランチやディナーに是非", "ランチのお店を探して", "こちらのランチがおすすめ"]) assert.equal(concreteLunch(q), false, q);
});

test("clusterLabels merges nearby markers into one label", async () => {
  const { clusterLabels } = await import("../lib/mapView");
  const { head, count } = clusterLabels([{ x: 0, y: 0 }, { x: 10, y: 12 }, { x: 200, y: 0 }, { x: 5, y: -20 }]);
  assert.deepEqual(head, [0, 0, 2, 0]);
  assert.equal(count.get(0), 3);
  assert.equal(count.get(2), 1);
});

test("tier A: ブランチ (brunch) secondary hours are not lunch", () => {
  const f = extractFacts(mkPlace({ hours: WEEK_NIGHT, more: [["ブランチ", null, null, [[day("金曜日", [[9], [17]])]]]] }));
  assert.equal(tierA(f), null);
});

test("tier A: all-day ランチ hours (= dinner hours) are not a lunch window", () => {
  const allDay = extractFacts(mkPlace({ more: [["ランチ", null, null, [[day("土曜日", [[12], [23, 15]])]]]] }));
  assert.equal(tierA(allDay), null);
  const real = extractFacts(mkPlace({ more: [["ランチ", null, null, [[day("土曜日", [[12], [23, 15]]), day("月曜日", [[11, 30], [14]])]]]] }));
  assert.deepEqual(tierA(real), { source: "hours", text: "ランチ 11:30–14:00" });
});

test("brunch spec: ブランチ menu/hours are brunch, not lunch; brunch gate needs a dish or price", async () => {
  const { BRUNCH } = await import("../lib/meals");
  const { concrete } = await import("../lib/nanoLunch");
  const f = extractFacts(mkPlace({ hours: [day("土曜日", [[9], [17]])], more: [["ブランチ", null, null, [[day("土曜日", [[9], [17]])]]]] }));
  assert.equal(tierA(f), null);
  assert.deepEqual(tierA(f, BRUNCH), { source: "hours", text: "ブランチ 9:00–17:00" });
  const g = extractFacts(mkPlace({ menu: menuOf([["BRUNCH", [["エッグベネディクト", "¥1,650"]]]]) }));
  assert.equal(ruleVerdict(g, BRUNCH).verdict, "menu");
  assert.equal(concrete(BRUNCH, "週末限定ブランチ：エッグベネディクトプレート 1,650円"), true);
  assert.equal(concrete(BRUNCH, "ブランチにもおすすめのお店です"), false);
  // dinner-only place cannot be a brunch place
  assert.equal(ruleVerdict(extractFacts(mkPlace({ hours: WEEK_NIGHT, desc: "週末ブランチプレート 1,500円" })), BRUNCH).verdict, "closed");
});

test("local store keeps lunch and brunch verdicts apart", async () => {
  const { kv } = memKV();
  const lunch = localLunchStore(kv, () => 1, "lunch"), brunch = localLunchStore(kv, () => 1, "brunch");
  await lunch.put([["a", { verdict: "menu", at: 1, v: LUNCH_VERSION }]]);
  assert.equal((await brunch.get(["a"])).size, 0);
  assert.equal((await lunch.get(["a"])).get("a")?.verdict, "menu");
});

test("scanner settles closed places from the search record; owner-hours places are fetched for their price", async () => {
  const fetched: string[] = [];
  const night = mkPlace({ fid: "N", hours: WEEK_NIGHT });
  const hours = mkPlace({ fid: "H", more: [["ランチ", null, null, [[day("金曜日", [[11, 30], [14]])]]]] });
  const detail = mkPlace({ fid: "H", more: [["ランチ", null, null, [[day("金曜日", [[11, 30], [14]])]]]], menu: menuOf([["ランチ", [["日替わり定食", "¥900"]]]]) });
  const sc = new LunchScanner({ fetchPlace: async (_n, fid) => { fetched.push(fid); return fid === "H" ? detail : mkPlace({ fid }); }, stores: { local: localLunchStore(memKV().kv) }, nano: null, onUpdate: () => {} });
  await sc.scan([{ fid: "N", name: "N", raw: night }, { fid: "H", name: "H", raw: hours }, { fid: "X", name: "X" }], new AbortController().signal);
  assert.deepEqual(fetched.sort(), ["H", "X"]);
  assert.equal(sc.results.get("N")?.verdict, "closed");
  assert.equal(sc.results.get("H")?.verdict, "menu");
  assert.deepEqual(sc.results.get("H")?.price, { yen: 900, item: "日替わり定食", source: "menu", items: 1 });
  assert.equal(sc.stats.quick, 1);
});

test("scanner cacheOnly restores cached verdicts without fetching", async () => {
  const { kv } = memKV();
  const local = localLunchStore(kv);
  await local.put([["A", { verdict: "menu", at: Date.now(), v: LUNCH_VERSION }]]);
  let fetched = 0;
  const sc = new LunchScanner({ fetchPlace: async () => { fetched++; return mkPlace({}); }, stores: { local }, nano: null, onUpdate: () => {} });
  await sc.scan([{ fid: "A", name: "A" }, { fid: "B", name: "B" }], new AbortController().signal, { cacheOnly: true });
  assert.equal(fetched, 0);
  assert.deepEqual(sc.list.map((r) => [r.fid, r.verdict]), [["A", "menu"]]);
});

test("tier A: an all-day [Lunch/Dinner] label is not a lunch menu", () => {
  const f = extractFacts(mkPlace({ menu: menuOf([["■…Food Menu…■", [["[Lunch/Dinner] Neapolitan Spaghetti", "¥1,400"]]]]) }));
  assert.equal(tierA(f), null);
  assert.ok(tierA(extractFacts(mkPlace({ menu: menuOf([["ランチ・ディナー共通", [["カレー", "¥900"]]], ["平日ランチ", [["カレー", "¥900"]]]]) }))));
});

test("tier A: kids' meals and daytime banquets are not a lunch menu", () => {
  const kids = extractFacts(mkPlace({ menu: menuOf([["キッズ", [["おこさまランチ(ジュース付)", "¥690"]]]]) }));
  assert.equal(tierA(kids), null);
  const party = extractFacts(mkPlace({ menu: menuOf([["コース", [["『昼限定宴会コース』全7品3時間飲み放題付き", "¥3,000"]]]]) }));
  assert.equal(tierA(party), null);
  assert.ok(tierA(extractFacts(mkPlace({ menu: menuOf([["プレート", [["おとなさまランチ", "¥3,000"]]]]) }))));
});
