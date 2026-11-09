import { test } from "node:test";
import assert from "node:assert/strict";
import { DICTS, htmlLang, qText, UI_LANGS } from "../lib/i18n";
import { QUESTIONS, type QuestionId } from "../lib/questions";
import { assignRanks, bubbleState, bubblesFor, type Bubble } from "../lib/askBubbles";
import type { AskRow } from "../lib/askCombine";

/** Every key path of a dictionary (functions and arrays count as leaves). */
const keys = (o: object, pre = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));

test("i18n: every UI language has the same keys, none empty", () => {
  const want = keys(DICTS.ja).sort();
  for (const l of UI_LANGS) {
    assert.deepEqual(keys(DICTS[l]).sort(), want, l);
    for (const k of keys(DICTS[l])) {
      const v = k.split(".").reduce((o: any, p) => o[p], DICTS[l]);
      if (typeof v === "string" && k !== "common.join" && k !== "review.sentenceSep") assert.ok(v.trim(), `${l} ${k}`);
    }
  }
});

test("i18n: every question has its words in every UI language", () => {
  for (const l of UI_LANGS) for (const id of Object.keys(QUESTIONS) as QuestionId[]) {
    const x = qText(l, id);
    for (const s of [x.label, x.chip, x.title, x.labels.menu, x.labels.likely, x.labels.none, x.labels.closed]) assert.ok(s?.trim(), `${l} ${id}`);
  }
  assert.equal(qText("ja", "solo").chip, "おひとり様");
  assert.equal(qText("zh", "cafe").labels.none, "不是咖啡廳");
  assert.equal(htmlLang("zh"), "zh-Hant");
});

const part = (verdict: any, extra: object = {}) => ({ fid: "f", name: "f", verdict, ...extra });
const row = (...parts: [QuestionId, any][]): AskRow => ({ fid: "f", name: "f", verdict: "none", parts });

test("bubbleState: candidate until judged, judging while a question reads it, no as soon as one says no", () => {
  assert.equal(bubbleState(undefined), "candidate");
  assert.equal(bubbleState(row(["solo", part("menu")], ["outlet", part("menu")])), "sure");
  assert.equal(bubbleState(row(["solo", part("menu")], ["outlet", part("likely")])), "likely");
  assert.equal(bubbleState(row(["solo", part("menu")], ["outlet", part("judging")])), "judging");
  assert.equal(bubbleState(row(["solo", part("pending")], ["outlet", undefined])), "judging");
  assert.equal(bubbleState(row(["solo", part("menu")], ["lunch", undefined])), "candidate", "lunch has not looked at it yet: not a no");
  assert.equal(bubbleState(row(["solo", part("menu")], ["outlet", part("unsure", { skipped: true })])), "candidate", "Nano skipped it for now");
  assert.equal(bubbleState(row(["solo", part("none")], ["outlet", part("judging")])), "no");
  assert.equal(bubbleState(row(["solo", part("closed")], ["outlet", part("menu")])), "no");
  assert.equal(bubbleState(row(["solo", part("unsure")], ["outlet", part("menu")])), "no");
});

test("bubblesFor: pool places with a position, from the search record or a cached verdict", () => {
  const rows = [{ ...row(["solo", part("menu")]), fid: "b", pos: { lat: 1, lng: 2 } }];
  const got = bubblesFor([{ fid: "a", name: "A" }, { fid: "b", name: "B" }, { fid: "c", name: "C" }], rows, (p) => (p.fid === "a" ? { lat: 3, lng: 4 } : null));
  assert.deepEqual(got.map((b) => [b.fid, b.state, b.pos.lat]), [["a", "candidate", 3], ["b", "sure", 1]]);
});

test("assignRanks: sure before likely, then nearest; existing numbers stay and new matches are appended", () => {
  const b = (fid: string, state: Bubble["state"], lat: number): Bubble => ({ fid, name: fid, pos: { lat, lng: 0 }, state });
  const c = { lat: 0, lng: 0 };
  const first = assignRanks(new Map(), [b("far", "sure", 0.01), b("near", "sure", 0.001), b("maybe", "likely", 0), b("x", "no", 0), b("y", "candidate", 0)], c);
  assert.deepEqual([...first], [["near", 1], ["far", 2], ["maybe", 3]]);
  const later = assignRanks(first, [b("far", "sure", 0.01), b("near", "no", 0.001), b("new", "sure", 0), b("maybe", "likely", 0)], c);
  assert.deepEqual([...later], [["near", 1], ["far", 2], ["maybe", 3], ["new", 4]], "no renumbering after 載入更多");
});

test("placeLabels: labels never overlap; the next side is tried, then the label is dropped", async () => {
  const { placeLabels, labelWidth } = await import("../lib/labelLayout");
  const bounds = { x: 0, y: 0, w: 1000, h: 800 };
  const it = (id: string, cx: number, cy: number) => ({ id, cx, cy, w: 120, h: 30 });
  const got = placeLabels([it("a", 500, 400), it("b", 520, 410), it("c", 500, 300)], bounds);
  assert.equal(got.get("a")?.side, "top");
  assert.equal(got.get("b")?.side, "bottom", "b's top spot overlaps a's label");
  const boxes = [...got.values()].filter(Boolean).map((p) => p!.box);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [p, q] = [boxes[i], boxes[j]];
    assert.ok(!(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h), `labels ${i} and ${j} overlap`);
  }
  assert.equal(placeLabels([it("edge", 30, 20)], bounds).get("edge")?.side, "right", "top-left corner: above and centred below leave the map");
  assert.equal(placeLabels([it("a", 500, 400), it("b", 500, 400)], { x: 430, y: 340, w: 140, h: 70 }).get("b"), null, "no free side: number only");
  assert.ok(labelWidth("マキャベリ 池袋東武店", true) > labelWidth("Bar", true));
  assert.equal(labelWidth("x".repeat(80), true), 168);
});
