import { PLACE, type RawPlace } from "./mapsData";
import { parseYen, type MenuRow } from "./lunchPrice";

/*
 * "What to order here": Google's review topics (p[153], e.g. チキンカツ ×27) joined with the owner menu
 * (p[125]) by plain string match — no model. Measured 2026-10-31 on 20 Ikebukuro places: topics are
 * dishes (ビリヤニ 94, メンチカツ 139, もつ鍋 23) mixed with non-dishes (雰囲気, 地下, 箸, qrコード,
 * 池袋駅); non-dishes rarely match a menu item, so the join itself is the filter. 12–14/20 places get
 * at least one priced dish.
 */

export type Topic = { label: string; count: number };
export type Dish = { topic: string; mentions: number; item: string; yen: number | null; variants: number };

/** Topic rows look like [[kgId], label, null, [null×4, count, …], …]. */
export function reviewTopics(p: RawPlace): Topic[] {
  const rows = p[PLACE.topics]?.[0];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((t: any) => ({ label: t?.[1], count: t?.[3]?.[4] }))
    .filter((t: any): t is Topic => typeof t.label === "string" && typeof t.count === "number");
}

// words that match many items or describe rather than name a dish (ステーキロッヂ: ジューシー → ジューシーステーキ)
const GENERIC = /^(料理|前菜|メイン|定食|セット|コース|ランチ|ディナー|平日|季節|ご飯|ライス|メニュー|おすすめ|限定|単品|ドリンク|デザート|食べ放題|飲み放題|ジューシー|ボリューム|コスパ|プレート)$/;
const MIN_MENTIONS = 3;
// condiments reviewers mention but nobody orders as a dish (鳥良: ポン酢 ¥169, タルタルソース ¥169; ステーキロッヂ: わさび)
const CONDIMENT = /^(ソース|ポン酢|ぽん酢|タルタル|タレ|たれ|わさび|山葵|塩|醤油|マヨネーズ|マヨ|ドレッシング|薬味|からし|辛子|柚子胡椒|七味|ケチャップ)$/;
const SIDE = /ミニ|ハーフ|プチ|小盛|単品|追加|トッピング|サイド|half|mini|add/i;

/** Menu names carry decoration: "★メディアで取材多数！…", "【自家製】ホルモン餃子〈6個〉", "ハヤシオムライス Hashed…". */
export const cleanItem = (s: string) =>
  s.replace(/【[^】]*】|\[[^\]]*\]|〈[^〉]*〉|＜[^＞]*＞|<[^>]*>|（[^）]*）|\([^)]*\)/g, " ")
    .replace(/[★☆◆◇●○■□▶︎▷♪！!]/g, " ")
    .replace(/\s+[A-Za-z][A-Za-z\s&'.-]*$/, "") // trailing English translation
    .replace(/\s+/g, " ").trim();

const KATA = /[ァ-ヺ]/;
/**
 * Where `topic` occurs in `name`. "clean" = not glued to a longer katakana word: タン must not match
 * タンドリーチキン, ナン must not match ナンプラー. ハヤシ → ハヤシオムライス is a glued compound, used
 * only when nothing clean exists and the topic is at least 3 characters.
 */
function occurrence(name: string, topic: string): "clean" | "glued" | null {
  const i = name.toLowerCase().indexOf(topic.toLowerCase());
  if (i < 0) return null;
  const next = name[i + topic.length] ?? "";
  return KATA.test(topic.at(-1)!) && KATA.test(next) ? "glued" : "clean";
}

export function topDishes(topics: Topic[], rows: MenuRow[], max = 3): Dish[] {
  const out: Dish[] = [];
  const used = new Set<string>();
  for (const t of [...topics].sort((a, b) => b.count - a.count)) {
    if (out.length >= max) break;
    if (t.count < MIN_MENTIONS || t.label.length < 2 || GENERIC.test(t.label) || CONDIMENT.test(t.label)) continue;
    const all = rows.map((r) => ({ r, how: occurrence(r.name, t.label), name: cleanItem(r.name) })).filter((x) => x.how && x.name);
    const clean = all.filter((x) => x.how === "clean");
    const hits = clean.length ? clean : t.label.length >= 3 ? all : [];
    if (!hits.length) continue;
    if (hits.length > 3 && hits.length > rows.length * 0.4) continue; // a word on most of the menu is not a dish
    // the plainest version: named exactly the topic, else ending with it (the dish itself, not a side
    // of something else), then cheapest, then shortest — プレーンナン over 夢の超BIGナン
    // Side portions go last: UCHOUTEN's cheapest メンチカツ is the ¥500 ミニメンチカツ add-on.
    const tier = (n: string) => (SIDE.test(n) ? 3 : n === t.label ? 0 : n.endsWith(t.label) ? 1 : 2);
    const best = hits
      .map((x) => ({ ...x, yen: parseYen(x.r.price) }))
      .sort((a, b) => tier(a.name) - tier(b.name) || (a.yen ?? Infinity) - (b.yen ?? Infinity) || a.name.length - b.name.length)[0];
    if (used.has(best.name)) continue;
    used.add(best.name);
    out.push({ topic: t.label, mentions: t.count, item: best.name, yen: best.yen, variants: new Set(hits.map((x) => x.name)).size });
  }
  return out;
}
