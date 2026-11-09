import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bandMove, burstHealth, health, monthKeys, nowPeriod, priceBand, priceYen, quarterSpan, ratingHealth, replyFlags, replyHealth, timelineMonths, verdictOf, warningHealth, type Verdict } from "../lib/health";
import { parseReview, parseReviewPayload, reviewPayloads, type TapReview } from "../lib/reviewTap";

/* fixtures/direction2-meta: 35 stores scraped 2026-11-06 through the passive payload (no reviewer identity). */
const DIR = join(process.cwd(), "fixtures/direction2-meta");
type Meta = { store: string; burst_suspect: boolean | null; scrapedAt: string; reviews: any[] };
const stores: Meta[] = readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

function fromMeta(m: any): TapReview {
  return {
    id: m.reviewId, cid: null, publishedAt: Date.parse(m.publishedAt), editedAt: Date.parse(m.lastEditedAt), stars: m.stars,
    text: m.hasText ? "x".repeat(m.textLength ?? 1) : null, lang: m.lang ?? null, translation: null, photos: m.photos ?? 0,
    reviewer: { reviews: m.reviewer?.reviewCount ?? null, photos: m.reviewer?.photoCount ?? null, localGuide: !!m.reviewer?.localGuide },
    food: m.food ?? null, service: m.service ?? null, atmosphere: m.atmosphere ?? null,
    pricePerPerson: null, pricePerPersonLabel: m.pricePerPerson ?? null, mealType: m.mealType ?? null,
    ownerReply: m.ownerReply ? { text: m.ownerReply.text, at: Date.parse(m.ownerReply.at) } : null,
  };
}
const byName = (s: string) => stores.find((m) => m.store.includes(s))!;

test("fixtures load: 35 stores, every review has an exact publish time", () => {
  assert.equal(stores.length, 35);
  for (const m of stores) for (const r of m.reviews) assert.ok(Number.isFinite(Date.parse(r.publishedAt)), m.store);
});

test("burst rule: fires on every store labelled suspicious and on no organic store", () => {
  for (const m of stores) {
    const b = burstHealth(m.reviews.map(fromMeta), Date.parse(m.scrapedAt));
    if (m.burst_suspect === true) assert.ok(b.flagged, `${m.store}: peak ${b.peak.n} ratio ${b.ratio.toFixed(1)} newbie ${b.newbieShare.toFixed(2)}`);
    if (m.burst_suspect === false) assert.ok(!b.flagged, `${m.store}: peak ${b.peak.n} ratio ${b.ratio.toFixed(1)} newbie ${b.newbieShare.toFixed(2)}`);
  }
  const fired = stores.filter((m) => burstHealth(m.reviews.map(fromMeta), Date.parse(m.scrapedAt)).flagged).map((m) => m.store);
  assert.equal(fired.length, 7, fired.join(", "));
});

test("burst rule: too short a span cannot fire; fewer than 10 reviews is empty", () => {
  const m = byName("とりいちず 新宿");
  const rs = m.reviews.map(fromMeta).sort((a, b) => b.publishedAt - a.publishedAt);
  const last20days = rs.filter((r) => r.publishedAt > rs[0].publishedAt - 20 * 86400e3);
  assert.ok(last20days.length >= 30);
  const b = burstHealth(last20days, rs[0].publishedAt);
  assert.equal(b.enough, false);
  assert.equal(b.flagged, false);
  assert.equal(burstHealth(rs.slice(0, 5), rs[0].publishedAt).peak.n, 0);
  // reviews published before the window (edited recently, so "newest" still lists them) are ignored
  const old = { ...rs[0], id: "old", publishedAt: rs[0].publishedAt - 5 * 365 * 86400e3 };
  assert.equal(burstHealth([...rs, old], rs[0].publishedAt).peak.n, burstHealth(rs, rs[0].publishedAt).peak.n);
  assert.equal(health([...rs, old], new Map(), rs[0].publishedAt).n, rs.length);
});

test("owner replies: canned share, mismatched thanks on low stars, delay", () => {
  const koro = replyHealth(byName("呼炉凪来").reviews.map(fromMeta));
  assert.ok(koro.canned > 0.7, `canned ${koro.canned}`);
  const tori = replyHealth(byName("とりいちず 新宿").reviews.map(fromMeta));
  assert.ok(tori.mismatched >= 3, `mismatched ${tori.mismatched}`);
  assert.ok(tori.medianDelayDays != null && tori.medianDelayDays >= 0);
  const organic = replyHealth(byName("しんぱち").reviews.map(fromMeta));
  assert.ok(organic.canned < 0.3, `organic canned ${organic.canned}`);
});

test("price per person: labels in both UI formats and codes parse to yen", () => {
  assert.equal(priceYen("￥1,000～2,000"), 1500);
  assert.equal(priceYen("¥1,000–2,000"), 1500);
  assert.equal(priceYen("E:JPY_1000_TO_2000"), 1500);
  assert.equal(priceYen("￥1～1,000"), 500.5);
  assert.equal(priceYen("￥10,000 以上"), 12500);
  assert.equal(priceYen("E:JPY_10000_PLUS"), 12500);
  assert.equal(priceYen(null), null);
  assert.equal(priceYen("時価"), null);
});

test("now period widens from 90 to 180 / 365 days for quiet stores", () => {
  const busy = byName("皇綱家").reviews.map(fromMeta);
  const asOf = Date.parse(byName("皇綱家").scrapedAt);
  assert.equal(nowPeriod(busy, asOf).days, 90);
  const quiet = busy.filter((r) => r.publishedAt < asOf - 170 * 86400e3);
  assert.equal(nowPeriod(quiet, asOf).days, 365);
  assert.equal(nowPeriod([], asOf).days, 365);
});

test("rating: now vs before, quarters ascending, delta", () => {
  const m = byName("武蔵家");
  const rs = m.reviews.map(fromMeta);
  const asOf = Date.parse(m.scrapedAt);
  const h = ratingHealth(rs, nowPeriod(rs, asOf));
  assert.equal(h.now.n + h.before.n, rs.length);
  assert.ok(h.all.avg! > 1 && h.all.avg! <= 5);
  assert.ok(h.byQuarter.length >= 2);
  for (let i = 1; i < h.byQuarter.length; i++) assert.ok(h.byQuarter[i - 1].key < h.byQuarter[i].key);
  assert.equal(h.byQuarter.reduce((a, q) => a + q.n, 0), rs.length);
  assert.ok(Math.abs(h.delta! - (h.now.avg! - h.before.avg!)) < 1e-9);
});

test("warnings: labels group by category newest first, staff_change needs p ≥ 0.6, stance only on price", () => {
  const m = byName("武蔵家");
  const rs = m.reviews.map(fromMeta).filter((r) => r.text).slice(0, 6);
  const v = new Map<string, Verdict>();
  v.set(rs[0].id, { p: { price: 0.9, staff_change: 0.2 }, labels: ["price"], stance: 0.8 });
  v.set(rs[1].id, { p: { price: 0.1, hygiene: 0.95, staff_change: 0.7 }, labels: ["hygiene", "staff_change"], stance: null });
  v.set(rs[2].id, { p: { staff_change: 0.5 }, labels: ["staff_change"], stance: null });
  const now = { from: rs[1].publishedAt, to: Date.parse(m.scrapedAt), days: 90 };
  const w = warningHealth(rs, v, now);
  assert.equal(w.price.count, 1);
  assert.equal(w.price.items[0].stance, 0.8);
  assert.equal(w.hygiene.count, 1);
  assert.equal(w.hygiene.items[0].stance, null);
  assert.equal(w.staff_change.count, 1, "p 0.5 is below the attribute threshold");
  assert.equal(w.price.recent + w.hygiene.recent, 2);
  assert.equal(w.service.count, 0);
  const all = health(rs, v, now.to);
  assert.equal(all.classified, 3);
  assert.equal(all.n, 6);
});

/* Synthetic qv9Egd record laid out like the real payload (paths from fixtures/direction2-research.json, partA). */
function record(over: Partial<{ id: string; text: string | null; reply: string | null }> = {}) {
  const r: any[] = [];
  r[0] = over.id ?? "rid1";
  r[1] = []; r[1][0] = "0x0:0x984160981caefe27"; r[1][2] = 1793393986481693; r[1][3] = 1793394120547046;
  r[1][4] = []; r[1][4][5] = ["Name Hidden", null, null, "profile-id", null, 7, 3, null, [true, 4], null, ["ローカルガイド · クチコミ 7 件"]];
  r[2] = []; r[2][0] = [4]; r[2][2] = [{}, {}]; r[2][14] = ["ja"];
  r[2][15] = [[over.text === undefined ? "味は普通。値上げした。" : over.text], ["Average taste. Prices went up."]];
  const food = []; food[0] = ["GUIDED_DINING_FOOD_ASPECT"]; food[11] = [4];
  const service = []; service[0] = ["GUIDED_DINING_SERVICE_ASPECT"]; service[11] = [5];
  const price = []; price[0] = ["GUIDED_DINING_PRICE_PER_PERSON"]; price[2] = [[[["E:JPY_1000_TO_2000"], "￥1,000～2,000"]]];
  const meal = []; meal[0] = ["GUIDED_DINING_MEAL_TYPE"]; meal[2] = [[[["E:LUNCH"], "ランチ"]]];
  r[2][6] = [food, service, price, meal];
  r[3] = []; r[3][1] = 1793500000000000; r[3][14] = [[over.reply === undefined ? "ご来店ありがとうございます" : over.reply]];
  return r;
}

test("payload parser: fields, units, no reviewer identity; owner-reply slot without text is null", () => {
  const p = parseReview(record())!;
  assert.equal(p.id, "rid1");
  assert.equal(p.cid, "984160981caefe27");
  assert.equal(p.publishedAt, 1793393986482);
  assert.equal(p.editedAt, 1793394120547);
  assert.equal(p.stars, 4);
  assert.equal(p.text, "味は普通。値上げした。");
  assert.equal(p.translation, "Average taste. Prices went up.");
  assert.equal(p.lang, "ja");
  assert.equal(p.photos, 2);
  assert.deepEqual(p.reviewer, { reviews: 7, photos: 3, localGuide: true });
  assert.equal(p.food, 4); assert.equal(p.service, 5); assert.equal(p.atmosphere, null);
  assert.equal(p.pricePerPerson, "E:JPY_1000_TO_2000"); assert.equal(p.pricePerPersonLabel, "￥1,000～2,000");
  assert.equal(p.mealType, "E:LUNCH");
  assert.deepEqual(p.ownerReply, { text: "ご来店ありがとうございます", at: 1793500000000 });
  assert.ok(!JSON.stringify(p).includes("profile-id") && !JSON.stringify(p).includes("Name Hidden"));
  assert.equal(parseReview(record({ reply: null }))!.ownerReply, null);
  assert.equal(parseReview(record({ text: null }))!.text, null);
  assert.equal(parseReview(["only-id"]), null);
});

test("batchexecute body: XSSI prefix, length-prefixed chunks, only qv9Egd entries, next-page token", () => {
  const inner = JSON.stringify([null, "NEXT_TOKEN", [[record({ id: "a" })], [record({ id: "b" })]]]);
  const chunk = JSON.stringify([["wrb.fr", "qv9Egd", inner, null, null, null, "generic"]]);
  const other = JSON.stringify([["wrb.fr", "other", "[]", null, null, null, "generic"], ["di", 12]]);
  const body = `)]}'\n\n${chunk.length}\n${chunk}\n${other.length}\n${other}\n`;
  const payloads = reviewPayloads(body);
  assert.equal(payloads.length, 1);
  const { reviews, nextPage } = parseReviewPayload(payloads[0]);
  assert.deepEqual(reviews.map((r) => r.id), ["a", "b"]);
  assert.equal(nextPage, true);
  assert.equal(parseReviewPayload(JSON.stringify([null, "", []])).nextPage, false);
  assert.deepEqual(reviewPayloads("garbage"), []);
});

test("price bands: 1,000-yen buckets from priceYen midpoints, open top bucket, bucket-to-bucket moves", () => {
  assert.deepEqual(priceBand(priceYen("￥1～1,000")), { lo: 0, hi: 1000 });
  assert.deepEqual(priceBand(priceYen("￥1,000～2,000")), { lo: 1000, hi: 2000 });
  assert.deepEqual(priceBand(priceYen("¥3,000–4,000")), { lo: 3000, hi: 4000 });
  assert.deepEqual(priceBand(priceYen("￥10,000 以上")), { lo: 10000, hi: null });
  assert.equal(priceBand(null), null);
  assert.equal(bandMove(1500, 500.5), "up");
  assert.equal(bandMove(1500, 2500), "down");
  assert.equal(bandMove(1500, 1500), "same");
  assert.equal(bandMove(null, 1500), null);
});

test("calendar helpers: months and quarter spans in local time", () => {
  const ms = monthKeys(new Date(2025, 3, 15).getTime(), new Date(2026, 9, 3).getTime());
  assert.equal(ms.length, 19);
  assert.equal(ms[0], "2025-4");
  assert.equal(ms[18], "2026-10");
  const q = quarterSpan("2026-Q3");
  assert.equal(q.from, new Date(2026, 6, 1).getTime());
  assert.equal(q.to, new Date(2026, 9, 1).getTime());
});

test("verdict: burst outranks a drop; a drop of 0.3★ or more is 'down'; a rise is 'up'; small moves are steady", () => {
  const v = (s: string) => { const m = byName(s); return verdictOf(health(m.reviews.map(fromMeta), new Map(), Date.parse(m.scrapedAt))); };
  assert.equal(v("呼炉凪来").kind, "burst");     // 333 reviews in 30 days, then 3.90 vs 4.75
  assert.equal(v("呼炉凪来").level, "alert");
  assert.equal(v("大戸屋").kind, "down");         // 3.21 vs 3.80
  assert.equal(v("武蔵家").kind, "up");           // 4.43 vs 3.40
  assert.equal(v("しんぱち").kind, "steady");     // 3.39 vs 3.46
  assert.equal(v("しんぱち").level, "good");
});

test("owner-reply flags: canned replies, low stars left unanswered, thanks for a high rating on 1–2★", () => {
  const f = (s: string) => replyFlags(replyHealth(byName(s).reviews.map(fromMeta)));
  assert.equal(f("呼炉凪来").canned, true);
  assert.equal(f("大戸屋").lowUnanswered, true);
  assert.equal(f("大戸屋").canned, false);
  assert.equal(f("とりいちず 新宿").mismatched, true);
  assert.equal(f("しんぱち").canned, false);
});

test("timeline: one column per calendar month of the window, every review in window counted once, warnings by month", () => {
  const m = byName("大戸屋");
  const asOf = Date.parse(m.scrapedAt);
  const rs = m.reviews.map(fromMeta);
  const warnAts = rs.slice(0, 3).map((r) => r.publishedAt);
  const tl = timelineMonths(rs, warnAts, asOf);
  assert.ok(tl.keys.length === 25 || tl.keys.length === 26, `months ${tl.keys.length}`);
  assert.equal(tl.months.reduce((n, x) => n + x.stars.length, 0), health(rs, new Map(), asOf).n);
  assert.equal(tl.months.reduce((n, x) => n + x.warn, 0), 3);
  assert.ok(tl.months.every((x) => x.stars.every((s) => s >= 1 && s <= 5)));
  // a review older than the window does not appear
  const old = { ...rs[0], publishedAt: asOf - 800 * 86400e3 };
  assert.equal(timelineMonths([old], [], asOf).months.reduce((n, x) => n + x.stars.length, 0), 0);
});

test("now period while loading: an unread window is not widened; once read through, quiet stores still widen", () => {
  const m = byName("皇綱家");
  const asOf = Date.parse(m.scrapedAt);
  const rs = m.reviews.map(fromMeta);
  const DAY = 86400e3;
  assert.equal(nowPeriod([], asOf, 10, null).days, 90);                       // nothing read yet
  assert.equal(nowPeriod([], asOf).days, 365);                                // done with nothing: widened as before
  const few = rs.filter((r) => r.publishedAt >= asOf - 60 * DAY).slice(0, 3); // 3 recent reviews only
  assert.equal(nowPeriod(few, asOf, 10, asOf - 60 * DAY).days, 90);          // read 60 days back: 90-day window still unread
  assert.equal(nowPeriod(few, asOf, 10, asOf - 120 * DAY).days, 180);        // read past 90 days, too few: widen to 180 (not read yet)
  assert.equal(nowPeriod(few, asOf, 10, asOf - 400 * DAY).days, 365);        // read through everything: same as the final rule
  assert.equal(health(rs, new Map(), asOf, undefined, null).now.days, 90);
});
