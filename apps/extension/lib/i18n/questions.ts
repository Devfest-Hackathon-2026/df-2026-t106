import type { QuestionId, TypeId } from "../questions";
import type { UiLang } from "./lang";

/*
 * The words each question template shows, per UI language. The specs in questions.ts / meals.ts only
 * hold matching data; this is the only place their copy lives.
 *   label   short word on map labels and list chips (一人 / ランチ)
 *   chip    condition chip text in the panel
 *   title   list / answer title
 *   labels  verdict words: menu = sure yes, likely = weak yes, none = no, closed = not open
 */
export type VerdictLabels = { menu: string; likely: string; none: string; closed: string };
export type QText = { label: string; chip: string; title: string; labels: VerdictLabels };

type Own = Omit<QText, "chip" | "title"> & { chip?: string; title?: string };
const own = (s: Own): QText => ({ chip: s.label, title: s.label, ...s });

/** Place types: the verdict words follow from the type's name. */
type VenueWords = (label: string) => VerdictLabels;
const venues = (names: Record<TypeId, string>, words: VenueWords): Record<TypeId, QText> =>
  Object.fromEntries(Object.entries(names).map(([id, label]) => [id, { label, chip: label, title: label, labels: words(label) }])) as Record<TypeId, QText>;

const JA: Record<QuestionId, QText> = {
  solo: own({ label: "一人", chip: "おひとり様", title: "一人でも入りやすいお店", labels: { menu: "一人OK", likely: "カウンター席あり", none: "一人向きではない", closed: "営業していない" } }),
  work: own({ label: "作業", chip: "長居・作業", title: "長居して作業できるお店", labels: { menu: "長居OK", likely: "作業できそう", none: "長居向きではない", closed: "営業していない" } }),
  outlet: own({ label: "電源", chip: "電源・充電", title: "電源があって充電できるお店", labels: { menu: "電源あり", likely: "クチコミで電源あり", none: "クチコミで電源なし", closed: "営業していない" } }),
  tea: own({ label: "お茶", chip: "午後のお茶", title: "午後にお茶とスイーツを楽しめるお店", labels: { menu: "午後のお茶OK", likely: "デザートあり", none: "お茶向きではない", closed: "午後は営業していない" } }),
  chat: own({ label: "おしゃべり", chip: "友達とおしゃべり", title: "友達とゆっくり話せるお店", labels: { menu: "おしゃべり向き", likely: "話せそう", none: "会話向きではない", closed: "営業していない" } }),
  date: own({ label: "デート", title: "デートに向いているお店", labels: { menu: "デート向き", likely: "雰囲気が良い", none: "デート向きではない", closed: "営業していない" } }),
  vegetarian: own({ label: "ベジ", chip: "ベジタリアン", title: "ベジタリアンでも満足できるお店", labels: { menu: "ベジメニューあり", likely: "ベジ対応かも", none: "ベジメニューなし", closed: "営業していない" } }),
  cashless: own({ label: "キャッシュレス", title: "現金なしで払えるお店", labels: { menu: "キャッシュレスOK", likely: "使えるかも", none: "現金のみ", closed: "営業していない" } }),
  lunch: own({ label: "ランチ", chip: "ランチメニュー", title: "ランチメニューがあるお店", labels: { menu: "ランチメニューあり", likely: "ランチありそう", none: "ランチなし", closed: "昼は営業していない" } }),
  brunch: own({ label: "ブランチ", title: "ブランチメニューがあるお店", labels: { menu: "ブランチメニューあり", likely: "ブランチありそう", none: "ブランチなし", closed: "午前は営業していない" } }),
  quiet: own({ label: "静か", title: "静かなお店", labels: { menu: "静か", likely: "落ち着く", none: "静かではない", closed: "営業していない" } }),
  mood: own({ label: "雰囲気", chip: "雰囲気が良い", title: "雰囲気の良いお店", labels: { menu: "雰囲気が良い", likely: "雰囲気良さそう", none: "雰囲気は普通", closed: "営業していない" } }),
  lively: own({ label: "にぎやか", title: "にぎやかで活気のあるお店", labels: { menu: "にぎやか", likely: "静かではない", none: "落ち着いている", closed: "営業していない" } }),
  view: own({ label: "景色", chip: "夜景・眺め", title: "景色が楽しめるお店", labels: { menu: "眺めが良い", likely: "クチコミで景色が良い", none: "景色なし", closed: "営業していない" } }),
  private_room: own({ label: "個室", title: "個室があるお店", labels: { menu: "個室あり", likely: "クチコミで個室あり", none: "個室なし", closed: "営業していない" } }),
  late_night: own({ label: "深夜", chip: "深夜営業", title: "深夜も開いているお店", labels: { menu: "深夜も食事可", likely: "遅くまで営業", none: "早めに閉店", closed: "営業していない" } }),
  upscale: own({ label: "高級", title: "高級感のあるお店", labels: { menu: "高級感あり", likely: "高級寄りかも", none: "高級ではない", closed: "営業していない" } }),
  casual: own({ label: "カジュアル", title: "気軽に入れるお店", labels: { menu: "カジュアル", likely: "カジュアルかも", none: "フォーマル寄り", closed: "営業していない" } }),
  ...venues(
    { cafe: "カフェ", izakaya: "居酒屋", bar: "バー", ramen: "ラーメン", sushi: "寿司", yakiniku: "焼肉", washoku: "和食", western: "洋食", chinese: "中華", asian: "アジア料理", sweets: "パン・スイーツ" },
    (l) => ({ menu: l, likely: l, none: `${l}ではない`, closed: "営業していない" }),
  ),
};

const ZH: Record<QuestionId, QText> = {
  solo: own({ label: "一個人", title: "一個人也自在的店", labels: { menu: "一人OK", likely: "有吧台座", none: "不適合一人", closed: "沒營業" } }),
  work: own({ label: "久坐工作", chip: "能久坐工作", title: "可以待久、能工作的店", labels: { menu: "可以久坐", likely: "可能可以", none: "不適合久坐", closed: "沒營業" } }),
  outlet: own({ label: "插座", chip: "插座／充電", title: "有插座可以充電的店", labels: { menu: "有插座", likely: "評論說有插座", none: "評論說沒有", closed: "沒營業" } }),
  tea: own({ label: "下午茶", title: "下午可以喝茶吃甜點的店", labels: { menu: "下午茶OK", likely: "有甜點", none: "沒有下午茶", closed: "下午沒營業" } }),
  chat: own({ label: "朋友聊天", title: "適合和朋友聊天的店", labels: { menu: "適合聊天", likely: "可能適合", none: "不適合聊天", closed: "沒營業" } }),
  date: own({ label: "約會", title: "適合約會的店", labels: { menu: "適合約會", likely: "氣氛不錯", none: "不適合約會", closed: "沒營業" } }),
  vegetarian: own({ label: "素食", title: "素食者也能吃飽的店", labels: { menu: "有素食菜單", likely: "可能有素食", none: "沒有素食", closed: "沒營業" } }),
  cashless: own({ label: "不用現金", title: "不用現金也能付的店", labels: { menu: "可無現金", likely: "可能可以", none: "只收現金", closed: "沒營業" } }),
  lunch: own({ label: "午餐", chip: "午餐菜單", title: "有午餐菜單的店", labels: { menu: "有午餐菜單", likely: "可能有午餐", none: "沒找到午餐", closed: "中午沒營業" } }),
  brunch: own({ label: "早午餐", title: "有早午餐菜單的店", labels: { menu: "有早午餐菜單", likely: "可能有早午餐", none: "沒找到早午餐", closed: "上午沒營業" } }),
  quiet: own({ label: "安靜", title: "安靜的店", labels: { menu: "安靜", likely: "落ち着く", none: "不安靜", closed: "沒營業" } }),
  mood: own({ label: "有氣氛", title: "有氣氛的店", labels: { menu: "很有氣氛", likely: "氣氛不錯", none: "氣氛普通", closed: "沒營業" } }),
  lively: own({ label: "熱鬧", title: "熱鬧有活力的店", labels: { menu: "很熱鬧", likely: "不算安靜", none: "比較安靜", closed: "沒營業" } }),
  view: own({ label: "夜景", title: "看得到景色的店", labels: { menu: "有景觀", likely: "評論說景色好", none: "沒有景觀", closed: "沒營業" } }),
  private_room: own({ label: "包廂", title: "有包廂的店", labels: { menu: "有包廂", likely: "評論說有包廂", none: "沒有包廂", closed: "沒營業" } }),
  late_night: own({ label: "深夜", title: "深夜還開著的店", labels: { menu: "深夜可用餐", likely: "開到很晚", none: "比較早關", closed: "沒營業" } }),
  upscale: own({ label: "高級", title: "高級感的店", labels: { menu: "高級感", likely: "可能偏高級", none: "不算高級", closed: "沒營業" } }),
  casual: own({ label: "隨性", title: "輕鬆隨性的店", labels: { menu: "輕鬆隨性", likely: "可能隨性", none: "比較正式", closed: "沒營業" } }),
  ...venues(
    { cafe: "咖啡廳", izakaya: "居酒屋", bar: "酒吧", ramen: "拉麵", sushi: "壽司", yakiniku: "燒肉", washoku: "和食", western: "西式", chinese: "中華", asian: "亞洲料理", sweets: "麵包甜點" },
    (l) => ({ menu: l, likely: l, none: `不是${l}`, closed: "沒營業" }),
  ),
};

/** English "not a …" needs an article per type. */
const EN_NOT: Record<TypeId, string> = {
  cafe: "Not a café", izakaya: "Not an izakaya", bar: "Not a bar", ramen: "Not a ramen shop", sushi: "Not a sushi place",
  yakiniku: "Not yakiniku", washoku: "Not Japanese food", western: "Not Western food", chinese: "Not Chinese food",
  asian: "Not Asian food", sweets: "Not a bakery or sweets shop",
};
const EN_TYPES: Record<TypeId, string> = {
  cafe: "Café", izakaya: "Izakaya", bar: "Bar", ramen: "Ramen", sushi: "Sushi", yakiniku: "Yakiniku", washoku: "Japanese",
  western: "Western", chinese: "Chinese", asian: "Asian", sweets: "Bakery & sweets",
};

const EN: Record<QuestionId, QText> = {
  solo: own({ label: "Solo", chip: "Solo-friendly", title: "Easy to visit alone", labels: { menu: "Solo OK", likely: "Counter seats", none: "Not for solo", closed: "Not open" } }),
  work: own({ label: "Work", chip: "Stay & work", title: "Stay long and work", labels: { menu: "Long stays OK", likely: "Maybe workable", none: "Not for long stays", closed: "Not open" } }),
  outlet: own({ label: "Outlets", chip: "Outlets / charging", title: "Outlets to charge your devices", labels: { menu: "Outlets", likely: "Reviews say outlets", none: "Reviews say none", closed: "Not open" } }),
  tea: own({ label: "Tea", chip: "Afternoon tea", title: "Tea and sweets in the afternoon", labels: { menu: "Afternoon tea OK", likely: "Has desserts", none: "No afternoon tea", closed: "Not open in the afternoon" } }),
  chat: own({ label: "Chat", chip: "Chat with friends", title: "Good for talking with friends", labels: { menu: "Good for chatting", likely: "Probably OK", none: "Not for chatting", closed: "Not open" } }),
  date: own({ label: "Date", title: "Good for a date", labels: { menu: "Date-worthy", likely: "Nice atmosphere", none: "Not for dates", closed: "Not open" } }),
  vegetarian: own({ label: "Veg", chip: "Vegetarian", title: "Vegetarians eat well here", labels: { menu: "Veg menu", likely: "Maybe veg options", none: "No veg menu", closed: "Not open" } }),
  cashless: own({ label: "Cashless", title: "Pay without cash", labels: { menu: "Cashless OK", likely: "Maybe cashless", none: "Cash only", closed: "Not open" } }),
  lunch: own({ label: "Lunch", chip: "Lunch menu", title: "Has a lunch menu", labels: { menu: "Lunch menu", likely: "Likely lunch", none: "No lunch found", closed: "Not open at noon" } }),
  brunch: own({ label: "Brunch", title: "Has a brunch menu", labels: { menu: "Brunch menu", likely: "Likely brunch", none: "No brunch found", closed: "Not open in the morning" } }),
  quiet: own({ label: "Quiet", title: "Quiet places", labels: { menu: "Quiet", likely: "Calm", none: "Not quiet", closed: "Not open" } }),
  mood: own({ label: "Atmosphere", chip: "Nice atmosphere", title: "Places with atmosphere", labels: { menu: "Great atmosphere", likely: "Nice atmosphere", none: "Plain atmosphere", closed: "Not open" } }),
  lively: own({ label: "Lively", title: "Lively places", labels: { menu: "Lively", likely: "Not quiet", none: "Rather quiet", closed: "Not open" } }),
  view: own({ label: "View", chip: "Night view", title: "Places with a view", labels: { menu: "Has a view", likely: "Reviews praise the view", none: "No view", closed: "Not open" } }),
  private_room: own({ label: "Private room", title: "Places with private rooms", labels: { menu: "Private rooms", likely: "Reviews mention rooms", none: "No private rooms", closed: "Not open" } }),
  late_night: own({ label: "Late night", title: "Open late at night", labels: { menu: "Late-night food", likely: "Open late", none: "Closes early", closed: "Not open" } }),
  upscale: own({ label: "Upscale", title: "Upscale places", labels: { menu: "Upscale", likely: "Maybe upscale", none: "Not upscale", closed: "Not open" } }),
  casual: own({ label: "Casual", title: "Casual places", labels: { menu: "Casual", likely: "Maybe casual", none: "Rather formal", closed: "Not open" } }),
  ...(Object.fromEntries(Object.entries(EN_TYPES).map(([id, label]) => [id, { label, chip: label, title: label, labels: { menu: label, likely: label, none: EN_NOT[id as TypeId], closed: "Not open" } }])) as Record<TypeId, QText>),
};

export const QTEXT: Record<UiLang, Record<QuestionId, QText>> = { ja: JA, zh: ZH, en: EN };
export const qText = (lang: UiLang, id: QuestionId): QText => QTEXT[lang][id];
