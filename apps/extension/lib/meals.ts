/*
 * One pipeline, several meals. Everything meal-specific lives here: what counts as a mention,
 * which hours make sense, what a concrete menu line looks like (Nano gate 2), which Maps
 * categories to search, and the Nano prompt.
 */

export type MealId = "lunch" | "brunch";
export type Shot = [string, { answer: "yes" | "no" | "unsure"; quote: string }];
export type Tone = "blue" | "red" | "yellow" | "green";

/** What every question template has, meal or not (see questions.ts for the non-meal ones). UI words: lib/i18n/questions.ts. */
export type QuestionBase = {
  id: string;
  tone: Tone;               // chip tone (rotation blue → red → yellow → green)
  intentRe: RegExp;         // free text → this template when Nano is unavailable
  rounds: string[][];       // Maps searches, one round per click
};

export type MealSpec = QuestionBase & {
  id: MealId;
  kind: "meal";
  re: RegExp;               // a mention of the meal
  window: [number, number]; // the place must be open at some point inside this (minutes)
  hoursEndBy: number;       // owner-set meal hours count only if some day's window ends by this
  menuWord: RegExp;         // "ランチセット", "日替わりランチ" … (gate 2)
  dish: RegExp;             // a dish or a price next to the mention (gate 2)
  nano: { system: string; shots: Shot[] };
};

/** "[Lunch/Dinner] French Fries", "ランチ・ディナー共通": served all day, not a meal-specific menu (麻布笄軒). */
export const ALL_DAY = /(?:lunch|ランチ|brunch|ブランチ)\s*[/／・&＆、,]\s*(?:dinner|ディナー)|(?:dinner|ディナー)\s*[/／・&＆、,]\s*(?:lunch|ランチ|brunch|ブランチ)/i;
/** A meal-specific mention: the meal word, but not an all-day "lunch/dinner" label. */
/** Kids' meals and daytime banquets carry the meal word but are not a meal menu (びっくりドンキー, 京の里久). */
export const NOT_MEAL_MENU = /お子様|お子さま|おこさま|キッズ|子供|子ども|children|child|kids|宴会|飲み放題|貸切/i;
export const namesMeal = (meal: { re: RegExp }, s: string) => meal.re.test(s) && !ALL_DAY.test(s) && !NOT_MEAL_MENU.test(s);

const PRICE = /[0-9０-９][0-9０-９,]*\s*円|[¥￥]\s*[0-9]/;
const re = (...parts: (RegExp | string)[]) => new RegExp(parts.map((p) => (typeof p === "string" ? p : p.source)).join("|"));

// ランチ but not アランチーニ / フランチャコルタ / ブランチ / ランチャー
const LUNCH_MENTION = /(?<![ァ-ヺー])ランチ(?!ャ)|\blunch\b|午餐|午間|お昼|昼(?:定食|膳|メニュー|ご飯|限定|営業)/i;

/*
 * Rounds measured 2026-10-31 (z17, 20 results/query, tier-A lunch places among the NEW ones):
 *              新宿三丁目  恵比寿
 *   レストラン      8        9      居酒屋 2 / 3   カフェ 6 / 3
 *   定食            4        8      中華   4 / 5   焼肉   6 / 3
 *   ビストロ        6        6      カレー 5 / 7   イタリアン – / 7
 *   喫茶店          3        2      和食   – / 3   ラーメン – / 0 (dropped: same menu all day)
 */
export const LUNCH: MealSpec = {
  id: "lunch",
  kind: "meal",
  tone: "blue",
  intentRe: /ランチ|\blunch\b|午餐|午飯|午間|お昼|昼食|昼(?:ご飯|ごはん|飯|定食)|定食|便當|弁当/i,
  re: LUNCH_MENTION,
  window: [11 * 60, 14 * 60],
  // 博多酒場 よかよい。 sets ランチ = ディナー = 12:00–23:15 with no lunch menu
  hoursEndBy: 17 * 60,
  menuWord: /ランチ(?:メニュー|セット|定食|コース|プレート|限定|販売|膳|ボックス)|(?:日替わり|限定|おすすめ|平日)ランチ|lunch\s*(?:menu|set|special|plate)|午餐套餐|午間套餐/i,
  dish: re(PRICE, /定食|セット|パスタ|ピザ|丼|カレー|ハンバーグ|オムライス|プレート|膳|そば|うどん|ビビンバ|サラダ|スープ/),
  rounds: [
    ["レストラン", "居酒屋", "カフェ"],
    ["定食", "中華料理", "焼肉"],
    ["イタリアン", "カレー", "ビストロ"],
    ["喫茶店", "和食"],
  ],
  nano: {
    system: `You decide whether a Japanese restaurant offers a DEDICATED LUNCH MENU: lunch sets, ランチ定食, 日替わりランチ, lunch-only dishes or lunch prices.
Answer "yes" only if the evidence shows such lunch dishes/sets/prices.
Answer "no" if lunch appears only as an SEO hashtag or keyword list, a party/貸切 price, daytime drinking (昼飲み, lunch drinks), or as a time of day when the same regular menu is served (e.g. ramen shops saying ランチ帯も営業).
Answer "unsure" if the evidence is too weak.
"quote" must be copied exactly from the evidence (max 60 characters).`,
    // few-shot pairs for the measured failure modes (marketing copy, 昼飲み, ramen)
    shots: [
      ["Store: A\nOwner text: 当店では、ランチからお食事をお楽しみいただけるほか、飲み放題もご用意しております。", { answer: "unsure", quote: "ランチからお食事をお楽しみいただける" }],
      ["Store: B\nOwner text: 平日ランチ1,200円（サラダ・ドリンク付き）。パスタランチは2種類から選べます。", { answer: "yes", quote: "平日ランチ1,200円（サラダ・ドリンク付き）" }],
      ["Store: C\nOwner text: 土日祝は昼飲みもできますので、お友達とのランチやお昼からの飲み会にもぜひ！", { answer: "no", quote: "土日祝は昼飲みもできます" }],
      ["Store: D\nCategory: ラーメン屋\nOwner text: ランチ帯もディナー帯も元気に営業中！", { answer: "no", quote: "ランチ帯もディナー帯も元気に営業中" }],
    ],
  },
};

export const BRUNCH: MealSpec = {
  id: "brunch",
  kind: "meal",
  tone: "blue",
  intentRe: /ブランチ|\bbrunch\b|早午餐/i,
  re: /ブランチ|\bbrunch\b|早午餐/i,
  window: [9 * 60, 13 * 60],
  hoursEndBy: 17 * 60, // e.g. 水産市場 ブランチ 9:00–17:00
  menuWord: /ブランチ(?:メニュー|セット|プレート|コース|限定)|(?:週末|休日|土日|週末限定)ブランチ|brunch\s*(?:menu|set|plate)/i,
  dish: re(PRICE, /パンケーキ|エッグ|ベネディクト|トースト|プレート|セット|ワッフル|サンド|オムレツ|ベーコン|サラダ|グラノーラ/),
  rounds: [
    ["ブランチ", "カフェ", "ベーカリー"],
    ["パンケーキ", "ビストロ", "ホテル レストラン"],
  ],
  nano: {
    system: `You decide whether a restaurant in Japan offers a DEDICATED BRUNCH MENU: brunch plates, エッグベネディクト, パンケーキ sets, brunch-only dishes or brunch prices (often weekends).
Answer "yes" only if the evidence shows such brunch dishes/sets/prices.
Answer "no" if brunch appears only as an SEO hashtag or keyword list, or the word ブランチ means a branch office.
Answer "unsure" if the evidence is too weak.
"quote" must be copied exactly from the evidence (max 60 characters).`,
    shots: [
      ["Store: A\nOwner text: 週末限定ブランチ：エッグベネディクトプレート 1,650円（ドリンク付き）", { answer: "yes", quote: "週末限定ブランチ：エッグベネディクトプレート 1,650円" }],
      ["Store: B\nOwner text: #ブランチ #カフェ巡り #東京グルメ", { answer: "no", quote: "#ブランチ #カフェ巡り" }],
      ["Store: C\nOwner text: ブランチにもおすすめのお店です。", { answer: "unsure", quote: "ブランチにもおすすめのお店です" }],
    ],
  },
};

export const MEALS: Record<MealId, MealSpec> = { lunch: LUNCH, brunch: BRUNCH };
