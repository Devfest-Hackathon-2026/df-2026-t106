import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHART_OTHER, CHART_SLOTS } from "@gmap/ui";
import { baseLang, reviewLanguages } from "../lib/reviewLangs";
import { parseReview } from "../lib/reviewTap";

const name = (c: string) => c.toUpperCase();
const rv = (lang: string | null, stars = 4) => ({ lang, stars });
const many = (lang: string | null, n: number, stars = 4) => Array.from({ length: n }, () => rv(lang, stars));

test("baseLang: regional variants count as one language", () => {
  assert.deepEqual(["zh-Hant", "zh-Hans", "zh", "pt-BR", "EN", "en_US"].map(baseLang), ["zh", "zh", "zh", "pt", "en", "en"]);
});

test("languages: rating-only left out, zh merged, fixed colors, foreign share, stars per language", () => {
  const s = reviewLanguages([...many("ja", 10, 3), ...many("en", 3, 5), ...many("zh-Hant", 2), rv("zh-Hans"), rv("ko"), rv("fr"), ...many(null, 5)], name);
  assert.equal(s.total, 18);
  assert.deepEqual(s.slices.map((x) => [x.key, x.value]), [["ja", 10], ["en", 3], ["zh", 3], ["fr", 1], ["ko", 1]]);
  assert.deepEqual(s.slices.map((x) => x.color), [CHART_SLOTS[0], CHART_SLOTS[1], CHART_SLOTS[2], CHART_SLOTS[4], CHART_SLOTS[3]]);
  assert.equal(s.slices[0].avg, 3);
  assert.equal(s.slices[1].avg, 5);
  assert.equal(s.foreign, 8 / 18);
});

test("languages: small shares fold into other; a language keeps its color while reviews stream in", () => {
  const colorOf = new Map<string, string>();
  const a = reviewLanguages([...many("ja", 40), rv("de")], name, colorOf);
  assert.deepEqual(a.slices.map((x) => x.key), ["ja", "de"]);
  const deColor = a.slices[1].color;
  // later: de is now under 2% and joins other; fr and it arrive — fr takes the last free slot, it has none
  const b = reviewLanguages([...many("ja", 100), ...many("fr", 5), ...many("it", 4), rv("de")], name, colorOf);
  assert.deepEqual(b.slices.map((x) => [x.key, x.value]), [["ja", 100], ["fr", 5], ["other", 5]]);
  assert.notEqual(b.slices[1].color, deColor);
  assert.equal(b.slices.at(-1)!.color, CHART_OTHER);
  assert.equal(colorOf.get("de"), deColor);
});

test("languages on 35 real stores: slices add up, at most 6 hues + other, other last", () => {
  const DIR = join(process.cwd(), "fixtures/direction2-meta");
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
    const store = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    const reviews = store.reviews.map((r: any) => ("lang" in r ? r : parseReview(r))).filter(Boolean);
    const s = reviewLanguages(reviews, name);
    assert.equal(s.slices.reduce((n, x) => n + x.value, 0), s.total, f);
    const hues = s.slices.filter((x) => x.key !== "other").map((x) => x.color);
    assert.ok(hues.length <= CHART_SLOTS.length && new Set(hues).size === hues.length, f);
    assert.ok(s.slices.findIndex((x) => x.key === "other") in { [-1]: 1, [s.slices.length - 1]: 1 }, f);
    const sizes = s.slices.filter((x) => x.key !== "other").map((x) => x.value);
    assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), f); // largest first (one store has more zh than ja)
  }
});
