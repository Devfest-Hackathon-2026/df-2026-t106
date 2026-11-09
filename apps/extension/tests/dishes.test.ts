import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanItem, reviewTopics, topDishes } from "../lib/dishes";
import { PLACE } from "../lib/mapsData";

/* Topic/menu pairs seen on 20 Ikebukuro places, 2026-10-31. */
const row = (name: string, price: string, sec = "メニュー") => ({ sec, name, price });
const topic = (label: string, count: number) => ({ label, count });

test("reviewTopics reads label and count from p[153]", () => {
  const p: unknown[] = new Array(260).fill(null);
  p[PLACE.topics] = [[[["/m/069544"], "定食", null, [null, null, null, null, 38, 0, 38]], [["/m/07sbflb"], "チキンカツ", null, [null, null, null, null, 27, 0, 90]]]];
  assert.deepEqual(reviewTopics(p as any[]), [topic("定食", 38), topic("チキンカツ", 27)]);
  assert.deepEqual(reviewTopics(new Array(260).fill(null)), []);
});

test("cleanItem strips decoration and trailing English", () => {
  assert.equal(cleanItem("【自家製】ホルモン餃子〈6個〉"), "ホルモン餃子");
  assert.equal(cleanItem("ハヤシオムライス Hashed Beef Omelette"), "ハヤシオムライス");
  assert.equal(cleanItem("★メディアで取材多数！夢の超BIGナン"), "メディアで取材多数 夢の超BIGナン");
});

test("plainest matching item wins; non-dish topics drop out because nothing on the menu matches", () => {
  const menu = [
    row("★メディアで取材多数！夢の超BIGナン", "￥4,000"), row("プレーンナン", "￥400"), row("チーズナン", "￥600"),
    row("ハイダラーバード式ダムビリヤニ", "￥1,100"), row("◆TOMラッシー", "￥570"), row("ナンプラー炒め", "￥900"),
  ];
  const got = topDishes([topic("ナン", 307), topic("ビリヤニ", 94), topic("雰囲気", 60), topic("ラッシー", 49), topic("学生証", 8)], menu);
  assert.deepEqual(got.map((d) => [d.topic, d.item, d.yen]), [["ナン", "プレーンナン", 400], ["ビリヤニ", "ハイダラーバード式ダムビリヤニ", 1100], ["ラッシー", "TOMラッシー", 570]]);
  assert.equal(got[0].variants, 3, "the 超BIG, plain and cheese naan — not ナンプラー");
});

test("short katakana topics must not match inside a longer word; long ones may", () => {
  const menu = [row("タンドリーチキン", "￥900"), row("ハヤシオムライス Hashed", "￥1,290"), row("バターコンソメスープ", "￥300")];
  const got = topDishes([topic("タン", 40), topic("ハヤシ", 46), topic("コンソメ", 45)], menu);
  assert.deepEqual(got.map((d) => d.item), ["ハヤシオムライス", "バターコンソメスープ"]);
});

test("generic and descriptive topics are skipped; too few mentions skipped; max 3", () => {
  const menu = [row("ジューシーステーキ 300g", "￥2,070"), row("ジンギスカンステーキ", "￥2,040"), row("唐揚定食", "￥900"), row("ミスジステーキ", "￥2,500"), row("カンガルー肉ステーキ", "￥2,800")];
  const got = topDishes([topic("ジューシー", 38), topic("定食", 30), topic("カンガルー肉", 43), topic("ミスジ", 33), topic("ジンギスカン", 29), topic("唐揚", 2)], menu);
  assert.deepEqual(got.map((d) => d.topic), ["カンガルー肉", "ミスジ", "ジンギスカン"]);
});

test("side portions are picked last (UCHOUTEN メンチカツ)", () => {
  const menu = [row("ミニメンチカツ", "￥500"), row("黒毛和牛のメンチカツ デミグラスソース", "￥1,100"), row("黒毛和牛のハンバーグとミニメンチカツ", "￥1,650")];
  assert.deepEqual(topDishes([topic("メンチカツ", 139)], menu).map((d) => [d.item, d.yen]), [["黒毛和牛のメンチカツ デミグラスソース", 1100]]);
});

test("a word on most of the menu is not a dish", () => {
  const menu = ["黒毛和牛ハンバーグ", "黒毛和牛メンチカツ", "黒毛和牛ステーキ", "黒毛和牛カレー", "サラダ"].map((n) => row(n, "￥1,000"));
  assert.deepEqual(topDishes([topic("黒毛和牛", 127)], menu), []);
});

test("condiment topics are not dishes (鳥良 live: ポン酢 7, タルタル 5)", () => {
  const menu = [row("手羽先唐揚（甘口・中辛・大辛）", "￥75"), row("おろしポン酢", "￥169"), row("タルタルソース", "￥169")];
  assert.deepEqual(topDishes([topic("手羽先", 18), topic("ポン酢", 7), topic("タルタル", 5)], menu).map((d) => d.item), ["手羽先唐揚"]);
});
