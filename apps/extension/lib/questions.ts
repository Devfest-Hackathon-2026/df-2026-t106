import { BRUNCH, LUNCH, type MealSpec, type QuestionBase, type Shot } from "./meals";

/*
 * 問地圖: the question templates the panel can answer. Free text never becomes a judging prompt;
 * it is only mapped to one of these (nanoIntent.ts). Every template is answered from Maps' own data:
 *   attrs    the light search record's attribute list ([100], measured 2026-10-31: 77–113 per place,
 *            e.g. 一人での食事, デート, PayPay, 現金のみ) → deterministic, no detail fetch, no Nano
 *   category a Maps category + opening hours inside a time window (下午茶)
 *   snippet  the one review quote Maps attaches to a keyword search hit ([142]); a keyword gate, then
 *            Gemini Nano judges the polarity of that one sentence (電源あり vs 電源はありません)
 * Rule order per place: closed → attr yes → attr no → category → attr likely → snippet → unsure.
 * Research: fixtures/ask-maps-research.json. Each new template needs a harness run on real Maps text.
 */

/**
 * One attribute: id = suffix of /geo/type/establishment_poi/<id>, label = hl=ja text (fallback).
 * Ids verified 2026-10-31 on 20 池袋 カフェ records. Flag entries are [1, [[1|0]]]; enum/list twins of the
 * same label (wi_fi "無料 Wi-Fi あり", pay_credit_card_types_accepted) carry no flag and never match.
 */
export type AttrMatch = { id?: string; label: RegExp; not?: boolean }; // not: matches an explicit "no" (feels_quiet 0 → lively)

export type AskSpec = QuestionBase & {
  kind: "ask";
  /** a modifier (安靜, 有氣氛 …) narrows a purpose; shown in the second chip row */
  modifier?: boolean;
  attrs?: { yes?: AttrMatch[]; likely?: AttrMatch[]; no?: AttrMatch[] };
  /** a Maps category that answers the question when the place is open inside `window` */
  category?: RegExp;
  window?: [number, number];
  /** open past this minute of the day on some day (23:30 = 1410; ends after midnight are > 1440) → likely */
  lateAfter?: number;
  snippet?: { keyword: RegExp; nano: { system: string; shots: Shot[] } };
  /** a place type (咖啡廳, 拉麵 …): `category` is a hard requirement; `nouns` replace カフェ/レストラン in other questions' searches */
  venue?: { nouns: string[] };
};

export type QuestionSpec = MealSpec | AskSpec;

/**
 * Places that serve food or drinks, by Maps category (hl=ja). Keyword searches also return parks, schools
 * and shops (池袋 デート → 南池袋公園, 英語 メニュー → 英会話教室); those never answer a question.
 */
export const FOOD_PLACE = /レストラン|料理|食堂|カフェ|喫茶|居酒屋|バー|ダイニング|ビストロ|バル|酒場|ラーメン|寿司|鮨|焼肉|焼き鳥|焼鳥|串|うどん|そば|蕎麦|カレー|定食|ベーカリー|パン|ケーキ|スイーツ|甘味|パティスリー|ピザ|ハンバーガー|ステーキ|食べ放題|ビュッフェ|弁当|丼|天ぷら|とんかつ|お好み焼き|もんじゃ|鍋|しゃぶしゃぶ|すき焼き|餃子|中華|デザート|ティー|紅茶|コーヒー|珈琲|ワイン|ビール|ブルワリー|クレープ|ドーナツ|ジェラート|アイスクリーム|フード|グリル|オイスター|ベジタリアン|ヴィーガン|ビーガン/;

const a = (label: string, id?: string): AttrMatch => ({ id, label: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });

/** Later rounds: the lunch category rounds cover most restaurants and cafes on screen. */
const AREA_ROUNDS = LUNCH.rounds;

const SNIPPET_RULES = `Answer "yes" only if the review states it explicitly.
Answer "no" if the review says the opposite (not available, not allowed, too noisy, too crowded, rushed).
Answer "unsure" if the review does not say, or only mentions the word in another sense.
"quote" must be copied exactly from the review (max 60 characters).`;

const snippetSystem = (question: string) => `You judge ONE place in Japan from ONE customer review sentence.
Question: ${question}
${SNIPPET_RULES}`;

export const SOLO: AskSpec = {
  id: "solo", kind: "ask", tone: "blue",
  intentRe: /一人|1人|１人|ひとり|独り|おひとり|一個人|單人|自己一個|\bsolo\b|\balone\b|by myself/i,
  attrs: { yes: [a("一人での食事", "suitable_for_solo_dining")], likely: [a("カウンター席", "has_counter_seating")] },
  rounds: AREA_ROUNDS,
};

export const WORK: AskSpec = {
  id: "work", kind: "ask", tone: "red",
  intentRe: /作業|ノマド|長居|勉強|仕事|リモート|テレワーク|工作|讀書|唸書|寫報告|久坐|筆電|パソコン|\blaptop\b|\bstudy(?:ing)?\b|\bwork(?:ing)?\b/i,
  // Wi-Fi alone is not enough: harness 2026-10-31 had くら寿司 / はなまるうどん judged "yes" from "Wi-Fiがある"
  attrs: { yes: [a("ノートパソコンでの作業", "suitable_for_working_on_laptop")], likely: [a("静か", "feels_quiet")] },
  snippet: {
    keyword: /作業|ノマド|長居|勉強|パソコン|PC|仕事/,
    nano: {
      system: snippetSystem("Can a customer stay a long time here to work or study on a laptop (long stays welcome)? A mention of Wi-Fi alone is not enough."),
      shots: [
        ["Store: A\nReview: PC作業している人も多く、長居しやすい雰囲気です。", { answer: "yes", quote: "PC作業している人も多く、長居しやすい雰囲気です。" }],
        ["Store: B\nReview: 混雑時は90分制で、パソコン作業はご遠慮くださいとのこと。", { answer: "no", quote: "パソコン作業はご遠慮くださいとのこと。" }],
        ["Store: C\nReview: 勉強会の帰りに寄りました。ケーキが美味しい。", { answer: "unsure", quote: "勉強会の帰りに寄りました。" }],
        ["Store: D\nReview: 地下ですがWi-Fiが無料で使えるので仕事の連絡も安心。", { answer: "unsure", quote: "地下ですがWi-Fiが無料で使えるので仕事の連絡も安心。" }],
      ],
    },
  },
  rounds: [["作業 カフェ", "長居 カフェ", "勉強 カフェ"], ...AREA_ROUNDS],
};

export const OUTLET: AskSpec = {
  id: "outlet", kind: "ask", tone: "yellow",
  intentRe: /電源|コンセント|充電|插座|插頭|插電|\boutlets?\b|\bpower\b|\bcharging\b|\bcharger\b|\bcharge (?:my|a|the|phone|laptop)/i,
  snippet: {
    keyword: /電源|コンセント|充電/,
    nano: {
      // measured 2026-10-31 on 池袋 電源 カフェ: 8 yes with exact quotes, 11/11 non-keyword snippets unsure
      system: snippetSystem("Can a customer charge a phone or laptop here (power outlets / 電源 / コンセント available to customers)?"),
      shots: [
        ["Store: A\nReview: 全席電源があるのと、2階3階そして屋上まであるのはありがたい。", { answer: "yes", quote: "全席電源がある" }],
        ["Store: B\nReview: 電源はありません。長居する雰囲気ではなく回転重視です。", { answer: "no", quote: "電源はありません。" }],
        ["Store: C\nReview: 電源ドリルの音が外から聞こえてうるさかった。", { answer: "unsure", quote: "電源ドリルの音が外から聞こえてうるさかった。" }],
      ],
    },
  },
  rounds: [["電源 カフェ", "コンセント カフェ", "充電 カフェ"], ...AREA_ROUNDS],
};

export const TEA: AskSpec = {
  id: "tea", kind: "ask", tone: "green",
  intentRe: /下午茶|甜點|蛋糕|喝茶|アフタヌーンティー|お茶|ケーキ|スイーツ|甘い|\bafternoon tea\b|\bcakes?\b|\bdesserts?\b|\bsweets\b/i,
  category: /カフェ|喫茶|ケーキ|パンケーキ|甘味|紅茶|ティー|スイーツ|パティスリー|デザート/,
  window: [14 * 60, 17 * 60],
  attrs: { likely: [a("デザート", "serves_dessert"), a("デザートがおいしい", "serves_dessert_notable")] },
  snippet: {
    keyword: /アフタヌーンティー|ケーキ|スイーツ|パフェ|紅茶|タルト|パンケーキ/,
    nano: {
      system: snippetSystem("Is this a good place for afternoon tea: tea or coffee with cakes, parfaits or other sweets?"),
      shots: [
        ["Store: A\nReview: アフタヌーンティーのスコーンと紅茶が最高でした。", { answer: "yes", quote: "アフタヌーンティーのスコーンと紅茶が最高でした。" }],
        ["Store: B\nReview: 焼肉の後のデザートにパフェがあるのは嬉しい。", { answer: "unsure", quote: "焼肉の後のデザートにパフェがあるのは嬉しい。" }],
        ["Store: C\nReview: ケーキは売り切れで、もう扱っていないそうです。", { answer: "no", quote: "ケーキは売り切れで、もう扱っていないそうです。" }],
      ],
    },
  },
  rounds: [["アフタヌーンティー", "ケーキ カフェ", "喫茶店"], ...AREA_ROUNDS],
};

export const CHAT: AskSpec = {
  id: "chat", kind: "ask", tone: "blue",
  intentRe: /聊天|朋友|聚會|聚餐|閨蜜|女子会|おしゃべり|友達|仲間|飲み会|宴会|ゆっくり話|\bchat(?:ting)?\b|\bfriends?\b|\bcatch up\b|get-together/i,
  attrs: { yes: [a("グループ客", "suitable_for_groups")], likely: [a("個室", "has_private_dining_room"), a("大学生に人気", "popular_with_students")] },
  snippet: {
    keyword: /おしゃべり|女子会|友達|友人|会話|ゆっくり話|長居/,
    nano: {
      system: snippetSystem("Is this a good place to sit and talk with friends for a while (relaxed, conversation OK)?"),
      shots: [
        ["Store: A\nReview: 友達とおしゃべりしながらゆっくり過ごせました。", { answer: "yes", quote: "友達とおしゃべりしながらゆっくり過ごせました。" }],
        ["Store: B\nReview: 店内が狭くて会話は控えめにという雰囲気でした。", { answer: "no", quote: "店内が狭くて会話は控えめにという雰囲気でした。" }],
        ["Store: C\nReview: 友人に勧められて来ました。ラーメンが美味しい。", { answer: "unsure", quote: "友人に勧められて来ました。" }],
      ],
    },
  },
  rounds: [["女子会 カフェ", "おしゃべり カフェ", "ダイニングバー"], ...AREA_ROUNDS],
};

export const DATE: AskSpec = {
  id: "date", kind: "ask", tone: "red",
  intentRe: /約會|情侶|紀念日|浪漫|デート|記念日|ロマンチック|カップル|\bdate\b|\bromantic\b|\banniversary\b/i,
  attrs: { yes: [a("デート", "suitable_for_dates")], likely: [a("ロマンチック", "feels_romantic"), a("記念日", "suitable_for_special_occasions")] },
  snippet: {
    keyword: /デート|記念日|カップル|ロマンチック/,
    nano: {
      system: snippetSystem("Is this a good place for a date (nice atmosphere, suitable for couples)?"),
      shots: [
        ["Store: A\nReview: 夜景が綺麗でデートにぴったりのお店です。", { answer: "yes", quote: "夜景が綺麗でデートにぴったりのお店です。" }],
        ["Store: B\nReview: 騒がしいのでデートには向かないと思います。", { answer: "no", quote: "騒がしいのでデートには向かないと思います。" }],
        ["Store: C\nReview: デートの前に軽く腹ごしらえ。", { answer: "unsure", quote: "デートの前に軽く腹ごしらえ。" }],
      ],
    },
  },
  rounds: [["デート レストラン", "ワインバー", "ビストロ"], ...AREA_ROUNDS],
};

export const VEGETARIAN: AskSpec = {
  id: "vegetarian", kind: "ask", tone: "yellow",
  intentRe: /素食|蔬食|吃素|純素|不吃肉|ベジ|ヴィーガン|ビーガン|菜食|vegan|vegetarian|plant.based|no meat|don'?t eat meat/i,
  attrs: { yes: [a("ベジタリアンメニュー", "serves_vegetarian"), a("ビーガンメニュー", "serves_vegan")] },
  snippet: {
    keyword: /ベジ|ヴィーガン|ビーガン|菜食|vegan|vegetarian/i,
    nano: {
      system: snippetSystem("Can a vegetarian or vegan eat a full meal here (vegetarian/vegan main dishes)?"),
      shots: [
        ["Store: A\nReview: ヴィーガンメニューが充実していて、肉なしでも満足でした。", { answer: "yes", quote: "ヴィーガンメニューが充実していて" }],
        ["Store: B\nReview: ベジタリアン向けのメニューはないと言われました。", { answer: "no", quote: "ベジタリアン向けのメニューはないと言われました。" }],
        ["Store: C\nReview: ヴィーガンじゃない、俺が食っても普通に美味かった", { answer: "unsure", quote: "ヴィーガンじゃない、俺が食っても普通に美味かった" }],
      ],
    },
  },
  rounds: [["ベジタリアン", "ヴィーガン", "オーガニック"], ...AREA_ROUNDS],
};

export const CASHLESS: AskSpec = {
  id: "cashless", kind: "ask", tone: "green",
  intentRe: /現金|刷卡|信用卡|行動支付|電子支付|悠遊卡|paypay|suica|pasmo|交通系|クレジット|クレカ|キャッシュレス|電子マネー|カード|\bcash(?:less)?\b|\bcards?\b|apple pay|google pay/i,
  attrs: {
    yes: ([["クレジットカード", "pay_credit_card"], ["デビットカード", "pay_debit_card"], ["NFC モバイル決済", "pay_mobile_nfc"],
      ["PayPay", "pay_epayment_paypay"], ["d払い", "pay_epayment_dbarai"], ["楽天ペイ", "pay_epayment_rakuten_pay"],
      ["au PAY", "pay_epayment_aupay"], ["交通系 IC カード", "pay_epayment_transit_ic"]] as const).map(([l, id]) => a(l, id)),
    no: [a("現金のみ", "requires_cash_only")],
  },
  rounds: AREA_ROUNDS,
};

/*
 * Modifiers: "安靜的約會" = 約會 ∩ 安靜. Measured 2026-11-01 (compound_conditions in the research fixture):
 * attributes alone give date∩quiet 69 / date∩romantic 45 of 522 池袋 places; Maps' quote for "静か デート"
 * matches the modifier word (24/40), rarely both (4/40) → each condition is answered on its own, then intersected.
 * Each modifier's intentRe doubles as the cue gate: Nano may only add a modifier the sentence actually names.
 */
const mod = (s: Omit<AskSpec, "kind" | "modifier">): AskSpec => ({ kind: "ask", modifier: true, ...s });

export const QUIET = mod({
  id: "quiet", tone: "blue",
  intentRe: /安靜|安静|寧靜|靜謐|清靜|不吵|静か|静寂|落ち着|騒がしくない|\bquiet\b|\bcalm\b|\bpeaceful\b/i,
  attrs: { yes: [a("静か", "feels_quiet")], likely: [a("落ち着く", "feels_cozy")] },
  snippet: {
    keyword: /静か|落ち着|騒がしくな|うるさくな/,
    nano: {
      system: snippetSystem("Is this place quiet and calm (low noise, easy to talk or read)?"),
      shots: [
        ["Store: A\nReview: 店内は静かで落ち着いて読書できました。", { answer: "yes", quote: "店内は静かで落ち着いて読書できました。" }],
        ["Store: B\nReview: 落ち着いた雰囲気かと思いきや、団体客がいて騒がしかった。", { answer: "no", quote: "団体客がいて騒がしかった。" }],
        ["Store: C\nReview: 落ち着いたら また来ます。", { answer: "unsure", quote: "落ち着いたら また来ます。" }],
      ],
    },
  },
  rounds: [["静か カフェ", "静か レストラン"], ...AREA_ROUNDS],
});

export const MOOD = mod({
  id: "mood", tone: "red",
  intentRe: /氣氛|气氛|情調|浪漫|時尚|時髦|漂亮的店|雰囲気|おしゃれ|お洒落|オシャレ|ロマンチック|ムード|\batmospher|\bromantic\b|\bstylish\b|\bcozy\b/i,
  attrs: { yes: [a("ロマンチック", "feels_romantic")], likely: [a("今っぽい", "feels_hip"), a("記念日", "suitable_for_special_occasions")] },
  // bare 雰囲気 is in most Japanese reviews ("雰囲気も良い" for an old diner): harness 2026-11-01 had 218/303
  // keyword hits and Nano said yes to generic praise → only words that name a stylish / romantic mood
  // second run: おしゃれ also describes plating, gift boxes and drinks (おしゃれな盛り付け, 手土産, レモンサワー)
  // → おしゃれ counts only next to a word for the space; the quote gate uses the same pattern
  snippet: {
    keyword: /(?:店内|内装|空間|インテリア|照明|お店|店構え)[^。！\n]{0,12}(?:おしゃれ|お洒落|オシャレ)|(?:おしゃれ|お洒落|オシャレ)[^。！\n]{0,8}(?:店内|内装|空間|雰囲気|お店|カフェ|バー|インテリア)|ムード|ロマンチック|隠れ家|大人の雰囲気|洗練された(?:空間|店内|雰囲気)/,
    nano: {
      system: snippetSystem("Does this place have a stylish or romantic atmosphere (interior, lighting, hideaway feel)? Generic praise like 'nice atmosphere', stylish food plating, packaging or drinks do not count."),
      shots: [
        ["Store: A\nReview: 照明が暗めでおしゃれな雰囲気、特別な日にぴったり。", { answer: "yes", quote: "照明が暗めでおしゃれな雰囲気、特別な日にぴったり。" }],
        ["Store: B\nReview: 雰囲気は普通の食堂で、特におしゃれな店内ではない。", { answer: "no", quote: "雰囲気は普通の食堂で、特におしゃれな店内ではない。" }],
        ["Store: C\nReview: おしゃれな盛り付けのパスタと、おしゃれなお店の紙袋。", { answer: "unsure", quote: "おしゃれな盛り付けのパスタと、おしゃれなお店の紙袋。" }],
      ],
    },
  },
  rounds: [["おしゃれ レストラン", "隠れ家 レストラン"], ...AREA_ROUNDS],
});

export const LIVELY = mod({
  id: "lively", tone: "yellow",
  intentRe: /熱鬧|热闹|熱絡|嗨|喧鬧|にぎやか|賑やか|ワイワイ|わいわい|活気|盛り上が|\blively\b|\bbuzzing\b|\bvibrant\b/i,
  // an explicit "not quiet" (feels_quiet 0) is a weak yes
  attrs: { likely: [{ ...a("静か", "feels_quiet"), not: true }] },
  snippet: {
    keyword: /活気|にぎやか|賑やか|ワイワイ|わいわい|盛り上が/,
    nano: {
      system: snippetSystem("Is this place lively and energetic (busy, cheerful, loud is fine)?"),
      shots: [
        ["Store: A\nReview: 活気があって店員さんも元気、ワイワイ飲むのに最高。", { answer: "yes", quote: "活気があって店員さんも元気、ワイワイ飲むのに最高。" }],
        ["Store: B\nReview: 平日の夜は活気がなく、お客さんは私たちだけでした。", { answer: "no", quote: "平日の夜は活気がなく、お客さんは私たちだけでした。" }],
        ["Store: C\nReview: 商店街は賑やかですが、お店の場所は少し奥です。", { answer: "unsure", quote: "商店街は賑やかですが、お店の場所は少し奥です。" }],
      ],
    },
  },
  rounds: [["にぎやか 居酒屋", "活気 居酒屋"], ...AREA_ROUNDS],
});

export const VIEW = mod({
  id: "view", tone: "green",
  intentRe: /夜景|景色|景觀|景观|風景|看得到|眺め|眺望|展望|景観|(?<!レ)ビュー|\bviews?\b|\bskyline\b|\bscenic\b/i,
  attrs: { likely: [a("ルーフトップテラス")] },
  snippet: {
    keyword: /夜景|景色|眺め|眺望|展望|景観/,
    nano: {
      system: snippetSystem("Can customers enjoy a view (night view, city view, scenery) from inside this place?"),
      shots: [
        ["Store: A\nReview: 窓際の席から池袋の夜景が一望できます。", { answer: "yes", quote: "窓際の席から池袋の夜景が一望できます。" }],
        ["Store: B\nReview: 地下なので景色は見えませんが料理は美味しい。", { answer: "no", quote: "地下なので景色は見えませんが料理は美味しい。" }],
        ["Store: C\nReview: 夜景を見た帰りに寄りました。", { answer: "unsure", quote: "夜景を見た帰りに寄りました。" }],
      ],
    },
  },
  rounds: [["夜景 レストラン", "眺め カフェ"], ...AREA_ROUNDS],
});

export const PRIVATE_ROOM = mod({
  id: "private_room", tone: "blue",
  intentRe: /包廂|包厢|包間|包间|個室|半個室|private room|private dining/i,
  attrs: { yes: [a("個室", "has_private_dining_room")] },
  snippet: {
    keyword: /個室/,
    nano: {
      system: snippetSystem("Does this place have private rooms or private booths (個室) for customers?"),
      shots: [
        ["Store: A\nReview: 完全個室なので周りを気にせず話せました。", { answer: "yes", quote: "完全個室なので周りを気にせず話せました。" }],
        ["Store: B\nReview: 個室はなく、カウンターとテーブル席のみです。", { answer: "no", quote: "個室はなく、カウンターとテーブル席のみです。" }],
        ["Store: C\nReview: 個室を予約したかったけど電話がつながらなかった。", { answer: "unsure", quote: "個室を予約したかったけど電話がつながらなかった。" }],
      ],
    },
  },
  rounds: [["個室 居酒屋", "個室 レストラン"], ...AREA_ROUNDS],
});

export const LATE_NIGHT = mod({
  id: "late_night", tone: "red",
  intentRe: /深夜|半夜|宵夜|消夜|凌晨|晚上十一|晚上11|終電|夜遅|夜中|遅くまで|late night|late-night|midnight|after 11|open late/i,
  attrs: { yes: [a("深夜の食事可", "serves_late_night_food")] },
  lateAfter: 23 * 60 + 30,
  rounds: [["居酒屋", "ラーメン", "バー"], ...AREA_ROUNDS.slice(1)],
});

export const UPSCALE = mod({
  id: "upscale", tone: "yellow",
  intentRe: /高級|高级|奢華|精緻|上品|贅沢|特別な日|\bupscale\b|\bfancy\b|fine dining|\bluxur/i,
  attrs: { yes: [a("高級感あり", "feels_upscale")], likely: [a("ビジネスディナー", "suitable_for_business_dinner")] },
  // "高級" usually describes ingredients (高級寿司がお手頃, 高級部位の食べ放題, A5和牛): harness 2026-11-01 → only
  // words about the place itself, and a shot that ingredient grade is not an upscale place
  snippet: {
    keyword: /高級感|高級店|高級レストラン|上品な(?:空間|店内|雰囲気|お店)|接待|特別な日|格式/,
    nano: {
      system: snippetSystem("Is the PLACE itself upscale and high-end (elegant interior, fine dining, for special occasions or business dinners)? Expensive ingredients (高級寿司, A5和牛) alone do not count."),
      shots: [
        ["Store: A\nReview: 上品な空間で接待にも安心して使える高級店です。", { answer: "yes", quote: "上品な空間で接待にも安心して使える高級店です。" }],
        ["Store: B\nReview: 高級店ではないけれど、コスパ最高の大衆酒場。", { answer: "no", quote: "高級店ではないけれど、コスパ最高の大衆酒場。" }],
        ["Store: C\nReview: 高級部位が食べられる食べ放題コースが3,850円。接待には向かない賑やかさ。", { answer: "no", quote: "接待には向かない賑やかさ。" }],
      ],
    },
  },
  rounds: [["高級 レストラン", "接待 レストラン"], ...AREA_ROUNDS],
});

export const CASUAL = mod({
  id: "casual", tone: "green",
  intentRe: /隨性|随性|輕鬆|轻松|休閒|休闲|不拘束|カジュアル|気軽|気取らない|\bcasual\b|\brelaxed\b|laid.back/i,
  attrs: { yes: [a("カジュアル", "feels_casual")] },
  rounds: AREA_ROUNDS,
});

/*
 * Place types: "安靜的咖啡廳" = any ∩ 安靜 ∩ 咖啡廳. Answered from the Maps categories of the light record
 * (no fetch, no Nano). Regexes written from 2026-11-01 池袋 data (19 type searches, 2669 places, research
 * fixture place_types): a place has several categories (寿司店 + 和食店 + 居酒屋), so a type matches any of them.
 * バー results include ガールズバー and カフェ results コスプレカフェ / ネットカフェ → excluded.
 * At most one type is selected (two types would be an intersection nobody means).
 */
export type VenueSpec = AskSpec & { category: RegExp; venue: { nouns: string[] } };
const venue = (s: { id: string; tone: AskSpec["tone"]; intentRe: RegExp; category: RegExp; nouns: string[]; rounds: string[][] }): VenueSpec => ({
  kind: "ask", id: s.id, tone: s.tone, intentRe: s.intentRe, category: s.category, venue: { nouns: s.nouns }, rounds: s.rounds,
});

export const CAFE = venue({
  id: "cafe", tone: "blue",
  intentRe: /咖啡|カフェ|喫茶|コーヒー|珈琲|cafe|café|coffee/i,
  category: /(?<!コスプレ|猫|インターネット |ネット|漫画)カフェ(?!テリア)|(?<!漫画)喫茶|コーヒー/,
  nouns: ["カフェ"],
  rounds: [["カフェ", "喫茶店", "コーヒー"], ["カフェ ランチ", "純喫茶"]],
});

export const IZAKAYA = venue({
  id: "izakaya", tone: "red",
  intentRe: /居酒屋|いざかや|焼き?鳥|烤雞肉串|串燒|串焼|大衆酒場|izakaya|yakitori/i,
  category: /居酒屋|焼き鳥|焼鳥|串焼き|串揚げ|酒場|おでん/,
  nouns: ["居酒屋"],
  rounds: [["居酒屋", "焼き鳥", "大衆酒場"], ["串焼き", "海鮮 居酒屋"]],
});

export const BAR = venue({
  id: "bar", tone: "yellow",
  // 飲み会 is a party (朋友聊天), not a bar
  intentRe: /酒吧|酒館|小酌|調酒|雞尾酒|喝一杯|喝杯酒|喝酒|喝幾杯|一杯飲|飲みに行|飲み屋|(?<!ハン|ガールズ)バー(?!ガー|ベキュー)|パブ|\bbars?\b|\bpub\b|cocktail|\bdrinks\b|a drink/i,
  category: /(?<!ガールズ|ハン|コンセプト)バー(?!ガー|ベキュー)|パブ|ビアホール|ビアガーデン/,
  nouns: ["バー"],
  rounds: [["バー", "ワインバー", "カクテルバー"], ["ダイニングバー", "ビアバー"]],
});

export const RAMEN = venue({
  id: "ramen", tone: "green",
  // a bare 麵/麺 means ramen unless it is 烏龍麵 / 義大利麵 / 蕎麥麵 (those are 和食 / 西式); 麵包 is bread
  intentRe: /拉麵|拉面|沾麵|ラーメン|つけ麺|担々麺|油そば|まぜそば|ramen|noodle|(?<!烏龍|乌冬|義大利|意大利|蕎麥|蕎|そば|うどん)[麵麺](?!包)/i,
  category: /ラーメン|中華麺|つけ麺|担々麺|油そば|まぜそば/,
  nouns: ["ラーメン"],
  rounds: [["ラーメン", "つけ麺"], ["まぜそば", "担々麺"]],
});

export const SUSHI = venue({
  id: "sushi", tone: "blue",
  intentRe: /壽司|寿司|すし|鮨|sushi/i,
  category: /寿司|鮨|すし/,
  nouns: ["寿司"],
  rounds: [["寿司", "回転寿司"], ["海鮮丼"]],
});

export const YAKINIKU = venue({
  id: "yakiniku", tone: "red",
  intentRe: /燒肉|烤肉|焼肉|焼き肉|ホルモン|yakiniku|korean bbq|\bbbq\b/i,
  category: /焼肉|焼き肉|ホルモン/,
  nouns: ["焼肉"],
  rounds: [["焼肉", "ホルモン"], ["韓国焼肉"]],
});

// 定食 stays with 午餐 (lunch's intentRe): "午餐定食" must not narrow lunch to 和食店
export const WASHOKU = venue({
  id: "washoku", tone: "yellow",
  intentRe: /和食|日料|日本料理|日式料理|日本菜|烏龍麵|乌冬|うどん|蕎麥|蕎麦|天婦羅|天ぷら|豬排|とんかつ|丼飯|會席|懐石|割烹|料亭|japanese food|udon|soba|tempura|tonkatsu/i,
  category: /和食|日本料理|定食|うどん|蕎麦|(?<!中華|油|まぜ)そば|天ぷら|天丼|とんかつ|かつ丼|牛丼|会席|懐石|料亭|割烹|おばんざい|郷土料理|うなぎ|すき焼き|しゃぶしゃぶ|お好み焼き|もんじゃ|鉄板焼き/,
  nouns: ["和食"],
  rounds: [["和食", "定食", "うどん"], ["そば", "天ぷら", "とんかつ"]],
});

export const WESTERN = venue({
  id: "western", tone: "green",
  intentRe: /西式|西餐|洋食|義大利|意大利|義式|法式料理|法國菜|法式餐|イタリアン|フレンチ|ビストロ|披薩|ピザ|義大利麵|牛排|ステーキ|漢堡|ハンバーガー|italian|french|western|steak|burger|bistro|pizza|pasta/i,
  category: /イタリア|フランス料理|フレンチ|ビストロ|洋食|ピザ|パスタ|ステーキ|ハンバーガー|ハンバーグ|スペイン料理|トラットリア|ブラッスリー|グリル/,
  nouns: ["イタリアン", "フレンチ"],
  rounds: [["イタリアン", "フレンチ", "ビストロ"], ["洋食", "ステーキ", "ハンバーガー"]],
});

export const CHINESE = venue({
  id: "chinese", tone: "blue",
  intentRe: /中華|中菜|中式|中國菜|中国料理|四川|川菜|餃子|饺子|小籠包|點心|飲茶|火鍋|chinese|dim sum|dumpling/i,
  category: /中華(?!麺)|中国料理|四川|広東|上海料理|台湾料理|飲茶|点心|餃子|火鍋|小籠包/,
  nouns: ["中華"],
  rounds: [["中華料理", "四川料理", "餃子"], ["台湾料理", "飲茶"]],
});

export const ASIAN = venue({
  id: "asian", tone: "red",
  intentRe: /韓式|韓國料理|韓国料理|泰式|泰國菜|タイ料理|越南|ベトナム|印度|インド|咖哩|カレー|尼泊爾|ネパール|南洋|東南亞|異國料理|エスニック|korean|thai|vietnam|indian|curry|ethnic/i,
  category: /韓国|タイ料理|ベトナム|インド|ネパール|カレー|アジア|ビリヤニ|ハラル|エスニック|インドネシア|マレーシア|シンガポール|冷麺|ケバブ|トルコ料理/,
  nouns: ["韓国料理", "エスニック"],
  rounds: [["韓国料理", "タイ料理", "インド料理"], ["ベトナム料理", "カレー"]],
});

// cake/dessert words stay with 下午茶 (tea): "吃蛋糕" must not drop the cafes that serve cake
export const SWEETS = venue({
  id: "sweets", tone: "yellow",
  intentRe: /麵包|面包|甜點店|蛋糕店|可頌|パン屋|ベーカリー|ケーキ屋|洋菓子|パティスリー|bakery|bread|pastry|patisserie/i,
  category: /ベーカリー|パン屋|ベーグル|洋菓子|ケーキ屋|スイーツ|デザート|パティスリー|菓子店|ドーナツ|パンケーキ|クレープ|ジェラート|アイスクリーム|チョコレート|フルーツ パーラー|甘味/,
  nouns: ["スイーツ"],
  rounds: [["ベーカリー", "ケーキ", "パティスリー"], ["ドーナツ", "パンケーキ"]],
});

/** Chip order in the panel; tones rotate blue → red → yellow → green (DESIGN.md §2). */
export const CHIP_ORDER = ["solo", "work", "outlet", "tea", "chat", "date", "vegetarian", "cashless", "lunch"] as const;
/** Second chip row: modifiers that narrow any purpose. */
export const MODIFIER_ORDER = ["quiet", "mood", "lively", "view", "private_room", "late_night", "upscale", "casual"] as const;
export type ChipId = (typeof CHIP_ORDER)[number];
export type ModifierId = (typeof MODIFIER_ORDER)[number];
/** Third chip row: place types, one at a time. */
export const TYPE_ORDER = ["cafe", "izakaya", "bar", "ramen", "sushi", "yakiniku", "washoku", "western", "chinese", "asian", "sweets"] as const;
export type TypeId = (typeof TYPE_ORDER)[number];
export type QuestionId = ChipId | ModifierId | TypeId | "brunch";

export const QUESTIONS: Record<QuestionId, QuestionSpec> = {
  solo: SOLO, work: WORK, outlet: OUTLET, tea: TEA, chat: CHAT, date: DATE, vegetarian: VEGETARIAN, cashless: CASHLESS,
  lunch: LUNCH, brunch: BRUNCH,
  quiet: QUIET, mood: MOOD, lively: LIVELY, view: VIEW, private_room: PRIVATE_ROOM, late_night: LATE_NIGHT, upscale: UPSCALE, casual: CASUAL,
  cafe: CAFE, izakaya: IZAKAYA, bar: BAR, ramen: RAMEN, sushi: SUSHI, yakiniku: YAKINIKU, washoku: WASHOKU, western: WESTERN, chinese: CHINESE, asian: ASIAN, sweets: SWEETS,
};
export const isModifier = (id: QuestionId) => { const s = QUESTIONS[id]; return s.kind === "ask" && !!s.modifier; };
export const isVenue = (id: QuestionId) => (TYPE_ORDER as readonly string[]).includes(id);
/** A new selection keeps at most one place type: the last one added wins. */
export function oneVenue(ids: QuestionId[]): QuestionId[] {
  const last = ids.filter(isVenue).pop();
  return ids.filter((id) => !isVenue(id) || id === last);
}

/** Specs that may call Gemini Nano (meal tier B, review snippets). */
export const needsNano = (s: QuestionSpec) => s.kind === "meal" || !!s.snippet;
/** Ids whose Nano-judged verdicts are shared via Firestore — mirrored in firestore.rules (d.meal in [...]). */
export const SHARED_IDS = (Object.keys(QUESTIONS) as QuestionId[]).filter((id) => needsNano(QUESTIONS[id]));
export const isShareable = (id: string) => (SHARED_IDS as string[]).includes(id);
export const isQuestionId = (id: string): id is QuestionId => id in QUESTIONS;

const GENERIC = /^(?:(.+)\s)?(?:カフェ|レストラン|居酒屋)$/;
const venueOf = (specs: QuestionSpec[]) => specs.find((s): s is VenueSpec => s.kind === "ask" && !!s.venue);

/**
 * Another question's search, aimed at the selected place type:
 *   "静か カフェ" → "静か 居酒屋" (generic noun swapped)   "レストラン" → "居酒屋"
 *   "喫茶店" with 咖啡廳 → kept                           "ワインバー" with 拉麵 → dropped (names another type)
 *   "ベジタリアン" → "ベジタリアン ラーメン" (keyword gets the type's noun)
 */
export function aimQuery(q: string, type: VenueSpec): string[] {
  const g = q.match(GENERIC);
  // a bare 居酒屋/カフェ is itself a type name: kept or dropped below
  if (g && (g[1] || q === "レストラン")) return type.venue.nouns.map((n) => (g[1] ? `${g[1]} ${n}` : n));
  if (type.category.test(q)) return [q];
  if (TYPE_ORDER.some((id) => (QUESTIONS[id] as AskSpec).category!.test(q))) return [];
  return type.venue.nouns.slice(0, 1).map((n) => `${q} ${n}`);
}

/**
 * Maps queries for one click: the union of the active templates' round `round`, deduped, at most `max`.
 * With a place type selected, the other questions' searches are aimed at it and its own searches follow.
 */
export function roundQueries(specs: QuestionSpec[], round: number, max = 6): string[] {
  const type = venueOf(specs);
  if (type) return aimedRounds(specs, type, max)[round] ?? [];
  const out: string[] = [];
  for (const s of specs) for (const q of s.rounds[round] ?? []) if (!out.includes(q)) out.push(q);
  return out.slice(0, max);
}

/** Rounds aimed at a type: a query runs once, and rounds left empty (every query named another type) are skipped. */
function aimedRounds(specs: QuestionSpec[], type: VenueSpec, max: number): string[][] {
  const used = new Set<string>(), rounds: string[][] = [];
  const n = Math.max(0, ...specs.map((s) => s.rounds.length));
  for (let r = 0; r < n; r++) {
    const out: string[] = [];
    const add = (q: string) => { if (!used.has(q) && !out.includes(q)) out.push(q); };
    for (const s of specs) if (s !== type) for (const q of s.rounds[r] ?? []) for (const a of aimQuery(q, type)) add(a);
    for (const q of type.rounds[r] ?? []) add(q);
    const kept = out.slice(0, max);
    kept.forEach((q) => used.add(q));
    if (kept.length) rounds.push(kept);
  }
  return rounds;
}
export function roundCount(specs: QuestionSpec[]) {
  const type = venueOf(specs);
  return type ? aimedRounds(specs, type, 6).length : Math.max(0, ...specs.map((s) => s.rounds.length));
}
