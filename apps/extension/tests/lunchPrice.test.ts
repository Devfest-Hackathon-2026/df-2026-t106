import { test } from "node:test";
import assert from "node:assert/strict";
import { lunchPrice, menuLunchPrices, parseYen, postLunchPrices, priceIndex, textLunchPrices } from "../lib/lunchPrice";
import { extractFacts } from "../lib/lunch";
import { BRUNCH } from "../lib/meals";
import { PLACE } from "../lib/mapsData";

/* Samples are real lines from 40 Ikebukuro "ランチ" results, 2026-10-31. */

test("parseYen: yen sign, 円, full-width digits, dot as thousands separator", () => {
  assert.equal(parseYen("￥1,080"), 1080);
  assert.equal(parseYen("日替わりランチ1,100円"), 1100);
  assert.equal(parseYen("¥1.790（税込）"), 1790);
  assert.equal(parseYen("１２００円"), 1200);
  assert.equal(parseYen("¥ 2500"), 2500);
  assert.equal(parseYen("時価"), null);
});

test("menu: cheapest real meal in lunch sections; desserts, kids, drinks, toppings and huge courses dropped", () => {
  const rows = [
    { sec: "ランチ（土、日、祝日のみ営業）", name: "パスタコース", price: "￥2,000" },
    { sec: "ランチ（土、日、祝日のみ営業）", name: "ランチデザート2種盛", price: "￥500" },
    { sec: "ランチ（土、日、祝日のみ営業）", name: "ティラミス", price: "￥650" },
    { sec: "ランチメニュー", name: "ビリヤニセット", price: "￥920" },
    { sec: "◇ランチメニュー◇", name: "タッカルビ追加", price: "￥90" },
    { sec: "その他", name: "お子さまランチ", price: "￥715" },
    { sec: "ランチ限定", name: "食べ飲み放題", price: "￥2,580" },
    { sec: "FREEFLOW & PARTY", name: "LUNCH", price: "￥13,200" },
    { sec: "コース", name: "【LUNCH】Premium Course", price: "￥3,800" },
    { sec: "看板", name: "手羽先唐揚", price: "￥75" },
    { sec: "■…Food Menu…■", name: "[Lunch/Dinner] French Fries", price: "￥600" },
    { sec: "■…Food Menu…■", name: "Azabu Kougaiken Children's Lunch", price: "￥1,450" },
    { sec: "ランチメニュー", name: "本日のおすすめパスタ", price: "" },
  ];
  const got = menuLunchPrices(rows);
  assert.deepEqual(got.map((c) => c.yen).sort((a, b) => a - b), [920, 2000, 3800]);
});

test("text: price must sit next to the lunch word, in the same clause", () => {
  const yes = [
    ["日替わりランチ1,100円をいただきましたが自分には物足りなかったです。", 1100, "日替わりランチ"],
    ["▶︎ランチBコース ¥3,900/ 1人 ▶︎前菜2種", 3900, "ランチBコース"],
    ["¥2500のランチコースにしました！", 2500, "ランチコース"],
    ["ランチは1,100円前後と、非常にリーズナブルに定食を楽しめます。", 1100, "ランチ"],
    ["ランチ利用 このご時世で最安値730円", 730, "ランチ利用"],
    ["【期間限定ランチ販売】鶏ちゃん焼定食 ¥1,078 (2026-10-05〜11-30)", 1078, "鶏ちゃん焼定食"],
  ] as const;
  for (const [s, yen, item] of yes) assert.deepEqual(textLunchPrices([s]), [{ yen, item }], s);
  const no = [
    "スイーツがランチメニューに＋500円で食べられるのですが、これがどれもハズレなしで大満足でした。",
    "平日のランチは3000円台から種類もありますので",
    "キノコクリームソースオムライス：990円（税込） テイクアウトも可能です🥡 オムライス、ランチ、ディナー、グルメ",
    "ランチドリンク 300円",
  ];
  for (const s of no) assert.deepEqual(textLunchPrices([s]), [], s);
});

test("lunchPrice: menu beats owner text beats reviews; extractFacts reads section rows", () => {
  const p: unknown[] = new Array(260).fill(null);
  p[PLACE.name] = "店"; p[PLACE.fid] = "0x1:0x2";
  p[PLACE.menu] = [[[null, [[["ランチメニュー"], [[[["チキン南蛮定食", ""], ["￥1,050"]], [["唐揚定食", ""], ["￥980"]]]]], [["一品"], [[[["枝豆", ""], ["￥400"]]]]]]]]];
  p[PLACE.posts] = [[null, ["平日ランチ850円はじめました"]]];
  const f = extractFacts(p as any[]);
  assert.deepEqual(f.menuRows.map((r) => r.sec), ["ランチメニュー", "ランチメニュー", "一品"]);
  assert.deepEqual(lunchPrice(f), { yen: 980, item: "唐揚定食", source: "menu", items: 2 });
  assert.deepEqual(lunchPrice({ ...f, menuRows: [] }), { yen: 850, item: "平日ランチ", source: "owner", items: 1 });
  assert.equal(lunchPrice({ menuRows: [], ownerText: [], reviewText: ["夜に行きました"] }), null);
});

test("brunch uses its own word", () => {
  assert.deepEqual(textLunchPrices(["週末限定ブランチプレート 1,650円"], BRUNCH), [{ yen: 1650, item: "週末限定ブランチプレート" }]);
  assert.deepEqual(textLunchPrices(["週末限定ブランチプレート 1,650円"]), []);
});

test("priceIndex: median and middle half, null when too few places", () => {
  assert.equal(priceIndex([900, 1000, 1100]), null);
  assert.deepEqual(priceIndex([850, 920, 980, 1100, 1300, 3900]), { median: 1040, p25: 940, p75: 1250, n: 6 });
});

test("owner post about lunch: prices anywhere in it count; tax-included wins over 税抜 (鳥良 live post)", () => {
  const post = [
    "【期間限定ランチ販売】2026年10月5日（月）より、#岐阜名物「鶏ちゃん焼定食」販売開始！", "",
    "味噌ベースの特製ダレが絡む鶏肉とたっぷりキャべツ。", "", "【詳細情報】", "販売店舗：鳥良商店全店",
    "販売商品：「鶏ちゃん焼定食」税抜980円（税込1,078円）", "販売期間：2026年10月5日（月）～11月30日（月）迄予定",
  ].join("\n");
  assert.deepEqual(postLunchPrices([post]), [{ yen: 1078, item: "鶏ちゃん焼定食" }]);
  const late = [" です🐔", "", "5月14日（木）より おすすめランチ が始まります🍅", "トマトチーズチキン定食 1199円"].join("\n");
  assert.deepEqual(postLunchPrices([late]), [], "lunch is not in the opening line");
  const now = ["本日より おすすめランチ が始まります", "トマトチーズチキン定食 1199円", "ドリンク 300円"].join("\n");
  assert.deepEqual(postLunchPrices([now]), [{ yen: 1199, item: "トマトチーズチキン定食" }]);
  assert.deepEqual(postLunchPrices(["#限定ランチ #池袋グルメ 手羽先 75円"]), [], "out of range");
});

