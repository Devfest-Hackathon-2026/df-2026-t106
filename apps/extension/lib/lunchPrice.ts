import type { LunchFacts } from "./lunch";
import { LUNCH, namesMeal, type MealSpec } from "./meals";

/*
 * The cheapest real meal on a place's lunch menu, from TEXT only (menu photos are a separate,
 * on-demand path and never feed the area index). Measured 2026-10-31 on 40 Ikebukuro "ランチ" results:
 *  - 17/40 have a lunch section or lunch-named items in the owner menu (p[125]): ¥900–1,700 mains,
 *    plus noise — desserts, お子さまランチ, 食べ飲み放題, ¥90 toppings, ¥5,800+ courses.
 *  - posts / reviews: usable only when the price sits right next to the lunch word
 *    ("日替わりランチ1,100円", "ランチBコース ¥3,900", "¥2500のランチコース"); otherwise add-ons
 *    ("ランチメニューに＋500円"), ranges ("3000円台から") and SEO lists with other dishes' prices.
 * Priority: menu > owner text > reviews (reviews can be old).
 */

export type PriceSource = "menu" | "owner" | "review";
export type LunchPrice = { yen: number; item: string; source: PriceSource; items: number };
export type MenuRow = { sec: string; name: string; price: string };

export const MEAL_YEN = { min: 500, max: 10_000 };
const NOT_MEAL = /デザート|スイーツ|ティラミス|ケーキ|パフェ|アイス|ドリンク|コーヒー|珈琲|紅茶|ジュース|ビール|ワイン|酒|飲み放題|お子様|お子さま|おこさま|キッズ|子供|children|child|大盛|追加|トッピング|単品|テイクアウト|弁当|dessert|drink|coffee|kids/i;
const NUM = "[0-9０-９]{1,3}(?:[,，.][0-9０-９]{3})+|[0-9０-９]+";
const YEN_SRC = `[¥￥]\\s*(${NUM})|(${NUM})\\s*円`;
const YEN = new RegExp(YEN_SRC, "g"); // only for matchAll (it copies lastIndex, so never exec() this one)
const YEN1 = new RegExp(YEN_SRC);

const half = (s: string) => s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

/** "￥1,080" / "1,100円" / "¥1.790" / "１２００円" → number; the first price in the string. */
export function parseYen(s: string): number | null {
  const m = YEN1.exec(s);
  if (!m) return null;
  const n = Number(half(m[1] ?? m[2]).replace(/[,，.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const inRange = (n: number | null): n is number => n != null && n >= MEAL_YEN.min && n <= MEAL_YEN.max;
const pick = (c: { yen: number; item: string }[], source: PriceSource): LunchPrice | null => {
  if (!c.length) return null;
  const best = c.reduce((a, b) => (b.yen < a.yen ? b : a));
  // the sentence and the post rule can both find the same line
  return { ...best, source, items: new Set(c.map((x) => `${x.yen}|${x.item}`)).size };
};

/** Items in a lunch section, or lunch-named items anywhere; not desserts/drinks/kids/add-ons. */
export function menuLunchPrices(rows: MenuRow[], meal: MealSpec = LUNCH) {
  return rows
    .filter((r) => (namesMeal(meal, r.sec) || namesMeal(meal, r.name)) && !NOT_MEAL.test(r.name) && !NOT_MEAL.test(r.sec))
    .map((r) => ({ yen: parseYen(r.price), item: r.name.trim() }))
    .filter((c): c is { yen: number; item: string } => inRange(c.yen));
}

const GAP_MAX = 16; // 鳥良: "ランチ販売】鶏ちゃん焼定食 ¥1,078" is 13
const BEFORE_BAD = /[+＋]\s*$/;
const AFTER_BAD = /^\s*(?:台|から|〜|～|~|以上|引|割|OFF|off|お得|追加|プラス)/;
const WORD = /[ぁ-んァ-ヶー一-龠々A-Za-zＡ-Ｚａ-ｚ]/; // no digits: "ランチ1,100円" stops at the price

/** A short label for the meal around the mention: "日替わりランチ", "ランチBコース". */
function label(text: string, from: number, to: number) {
  let s = from, e = to;
  while (s > 0 && WORD.test(text[s - 1]) && to - s < 16) s--;
  // forward: no hiragana, so "ランチコースにしました" stops at "ランチコース"
  while (e < text.length && WORD.test(text[e]) && !/[ぁ-ん]/.test(text[e]) && e - s < 16) e++;
  return text.slice(s, e).replace(/^[のはでにを]+/, "");
}

/** Prices in free text that sit within a few characters of the meal word, same clause. */
export function textLunchPrices(texts: string[], meal: MealSpec = LUNCH) {
  const out: { yen: number; item: string }[] = [];
  const mention = new RegExp(meal.re.source, meal.re.flags.replace("g", "") + "g");
  for (const raw of texts) {
    const t = raw.replace(/\s+/g, " ");
    const words = [...t.matchAll(mention)];
    if (!words.length) continue;
    for (const p of t.matchAll(YEN)) {
      const ps = p.index!, pe = ps + p[0].length;
      if (BEFORE_BAD.test(t.slice(Math.max(0, ps - 2), ps)) || AFTER_BAD.test(t.slice(pe, pe + 4))) continue;
      const yen = parseYen(p[0]);
      if (!inRange(yen)) continue;
      const w = words.find((m) => {
        const ws = m.index!, we = ws + m[0].length;
        const gap = we <= ps ? t.slice(we, ps) : pe <= ws ? t.slice(pe, ws) : null;
        return gap != null && gap.length <= GAP_MAX && !/[。、！!？?,，]/.test(gap) && !NOT_MEAL.test(gap);
      });
      if (!w) continue;
      const ws = w.index!, we = ws + w[0].length;
      // "【期間限定ランチ販売】鶏ちゃん焼定食 ¥1,078": the dish is what follows the closing bracket
      const dish = we <= ps ? t.slice(we, ps).split(/[】」』]/).slice(1).pop()?.trim() : undefined;
      out.push({ yen, item: dish || label(t, ws, we) || w[0] });
    }
  }
  return out;
}

/**
 * Owner posts whose opening line is about the meal ("【期間限定ランチ販売】…", "本日より おすすめランチ…"):
 * the price may come many lines later (鳥良: 販売商品：「鶏ちゃん焼定食」税抜980円（税込1,078円）), so
 * every price in such a post counts. Pre-tax prices are skipped when the tax-included one follows.
 */
export function postLunchPrices(texts: string[], meal: MealSpec = LUNCH) {
  const out: { yen: number; item: string }[] = [];
  for (const raw of texts) {
    const head = raw.trim().split("\n")[0].slice(0, 40);
    if (!namesMeal(meal, head)) continue;
    const t = raw.replace(/\s+/g, " ");
    for (const p of t.matchAll(YEN)) {
      const ps = p.index!, pe = ps + p[0].length;
      const before = t.slice(Math.max(0, ps - 30), ps);
      if (BEFORE_BAD.test(before) || /税抜\s*$/.test(before) || AFTER_BAD.test(t.slice(pe, pe + 4))) continue;
      const yen = parseYen(p[0]);
      if (!inRange(yen)) continue;
      // label: the last 「name」 just before the price, else the word run right before it
      const quoted = [...before.matchAll(/「([^「」]{2,24})」/g)].pop()?.[1];
      let s = ps;
      while (s > 0 && t[s - 1] === " ") s--;
      const e = s;
      while (s > 0 && WORD.test(t[s - 1]) && e - s < 16) s--;
      const item = quoted ?? t.slice(s, e);
      if (!item || NOT_MEAL.test(item)) continue;
      out.push({ yen, item });
    }
  }
  return out;
}

export function lunchPrice(f: Pick<LunchFacts, "menuRows" | "ownerText" | "reviewText">, meal: MealSpec = LUNCH): LunchPrice | null {
  return pick(menuLunchPrices(f.menuRows, meal), "menu")
    ?? pick([...textLunchPrices(f.ownerText, meal), ...postLunchPrices(f.ownerText, meal)], "owner")
    ?? pick(textLunchPrices(f.reviewText, meal), "review");
}

/** Median of the places' cheapest lunch, plus the middle half (rounded to ¥10). Null below `minN`. */
export function priceIndex(yens: number[], minN = 5) {
  if (yens.length < minN) return null;
  const s = [...yens].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (s.length - 1) * p, lo = Math.floor(i);
    return Math.round((s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)) / 10) * 10;
  };
  return { median: q(0.5), p25: q(0.25), p75: q(0.75), n: s.length };
}
