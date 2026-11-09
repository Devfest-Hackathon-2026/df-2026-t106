import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetChoices, budgetFromText } from "../lib/budget";

test("budget: the upper bound a sentence names (ja / zh / en, half- and full-width)", () => {
  const cases: [string, number | null][] = [
    ["1000円以下の和食ランチ", 1000],
    ["１０００円以下の和食ランチ", 1000],
    ["1,000円までのランチ", 1000],
    ["予算800円で定食", 800],
    ["千円以内でランチ", 1000],
    ["1千5百円以内のランチ", 1500],
    ["1.2千円のランチ", 1200],
    ["¥1200以内のお昼", 1200],
    ["￥１５００まで", 1500],
    ["1000日圓以內的午餐", 1000],
    ["午餐 800日元以下", 800],
    ["lunch under 1000 yen", 1000],
    ["cheap lunch under ¥1,500", 1500],
    ["lunch set for 900 JPY", 900],
  ];
  for (const [text, want] of cases) assert.equal(budgetFromText(text), want, text);
});

test("budget: lower bounds, ranges, price bands and other numbers", () => {
  const cases: [string, number | null][] = [
    ["和食ランチ", null],
    ["1000円以上のランチ", null],
    ["1000円からのランチ", null],
    ["1000円台のランチ", null],
    ["1000円〜1500円のランチ", 1500],
    ["1000円～1500円のランチ", 1500],
    ["lunch over 2000 yen", null],
    ["lunch from ¥1000 to ¥1500", 1500],
    ["12時に2人でランチ", null],
    ["10円ランチ", null],
    ["予算50000円", null],
  ];
  for (const [text, want] of cases) assert.equal(budgetFromText(text), want, text);
});

test("budget: the toggle keeps its presets and adds the sentence's own amount", () => {
  assert.deepEqual(budgetChoices(null), [800, 1000, 1500]);
  assert.deepEqual(budgetChoices(1000), [800, 1000, 1500]);
  assert.deepEqual(budgetChoices(1200), [800, 1000, 1200, 1500]);
  assert.deepEqual(budgetChoices(500), [500, 800, 1000, 1500]);
});
