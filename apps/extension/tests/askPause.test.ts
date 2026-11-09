import { test } from "node:test";
import assert from "node:assert/strict";
import { PLACE } from "../lib/mapsData";
import { QUIET } from "../lib/questions";
import { localLunchStore } from "../lib/lunchStore";
import { LunchScanner } from "../lib/lunchScan";
import { askHeld, askResumed, holdAsk, pausable } from "../lib/askPause";
import { openInPage } from "../lib/placeNav";
import type { Gate } from "../lib/mapsGate";

/* A light search record whose review quote needs Nano for 「静か」 (same layout as tests/ask.test.ts). */
function rec(fid: string) {
  const p: any[] = new Array(260).fill(null);
  p[PLACE.fid] = fid; p[PLACE.name] = fid; p[PLACE.categories] = ["カフェ"];
  p[PLACE.coords] = [null, null, 35.7, 139.7];
  p[PLACE.attrs] = [null, [["", []]]];
  p[PLACE.snippet] = [null, [[null, [[`"静かで落ち着く"`]]]]];
  return p;
}
const memKV = () => { const m = new Map<string, unknown>(); return { async get(k: string[]) { return Object.fromEntries(k.filter((x) => m.has(x)).map((x) => [x, m.get(x)])); }, async set(o: Record<string, unknown>) { for (const [k, v] of Object.entries(o)) m.set(k, v); } }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const place = (fid: string) => ({ fid, name: fid, raw: rec(fid) });
const places = (...fids: string[]) => fids.map(place);

/** A scanner whose Nano takes `ms` per place and honours its signal like LanguageModel.prompt. */
function scanner(asked: string[], opts: { ms?: number; cap?: number; paused?: boolean } = {}) {
  return new LunchScanner({
    fetchPlace: async () => { throw new Error("no fetch"); },
    stores: { local: localLunchStore(memKV(), () => 1, "quiet") },
    nano: { async judge(f: any, _o, _r, signal) { await sleep(opts.ms ?? 20); signal.throwIfAborted(); asked.push(f.fid); return { answer: "yes", quote: "静かで落ち着く", ms: 1 }; } },
    onUpdate: () => {}, meal: QUIET, nanoCap: opts.cap ?? 40,
    pause: opts.paused ? { held: askHeld, resumed: askResumed } : undefined,
  });
}

test("Nano queue: stopping a search drops its own judgments, the opened place's judgment still finishes", async () => {
  const asked: string[] = [];
  const sc = scanner(asked);
  const run = new AbortController(), own = new AbortController();
  const searching = sc.scan(places("p1", "p2", "p3", "p4", "p5"), run.signal);
  await sleep(5);
  const opened = sc.scan([place("opened")], own.signal);
  await sleep(30);
  run.abort();
  await Promise.all([searching, opened]);
  assert.equal(sc.results.get("opened")?.verdict, "likely");
  // nothing is left "judging": stopped places are dropped so a later scan picks them up
  assert.deepEqual([...sc.results.values()].filter((r) => r.verdict === "judging"), []);
  assert.ok(asked.length < 6, `stopped places were still judged: ${asked}`);
});

test("Nano queue: stop works even when the opened place started the queue (it used to run to the end)", async () => {
  const asked: string[] = [];
  const sc = scanner(asked);
  const own = new AbortController(), run = new AbortController();
  const opened = sc.scan([place("opened")], own.signal);
  await sleep(2);
  const searching = sc.scan(places("p1", "p2", "p3", "p4", "p5"), run.signal);
  await sleep(30);
  run.abort();
  const t0 = Date.now();
  await Promise.all([searching, opened]);
  assert.ok(Date.now() - t0 < 60, "the stopped search waited for the whole queue");
  assert.ok(asked.length <= 3, `judged after stop: ${asked}`);
  assert.equal(sc.results.get("opened")?.verdict, "likely");
});

test("Nano queue: the place the user opened is judged first and outside the per-round cap", async () => {
  const asked: string[] = [];
  const sc = scanner(asked, { cap: 2 });
  const signal = new AbortController().signal;
  const searching = sc.scan(places("p1", "p2", "p3"), signal);
  await sleep(2);
  await Promise.all([searching, sc.scan([place("opened")], signal, { urgent: true })]);
  assert.equal(asked[1], "opened"); // p1 was already being judged; the opened place comes right after
  assert.equal(sc.results.get("p3")?.skipped, true); // cap 2: p1, p2
  assert.equal(sc.results.get("opened")?.verdict, "likely");
  // a place already waiting in the queue moves to the front when the user opens it
  const asked2: string[] = [];
  const sc2 = scanner(asked2);
  const s2 = sc2.scan(places("a", "b", "c", "d"), signal);
  await sleep(2);
  await Promise.all([s2, sc2.scan([place("d")], signal, { urgent: true })]);
  assert.deepEqual(asked2, ["a", "d", "b", "c"]);
});

test("pause: no Nano judgment starts while 「お店の今」 holds 問地圖; judging resumes after release", async () => {
  const asked: string[] = [];
  const sc = scanner(asked, { paused: true });
  const release = holdAsk();
  const done = sc.scan(places("p1", "p2"), new AbortController().signal);
  await sleep(60);
  assert.deepEqual(asked, []);
  assert.equal(sc.results.get("p1")?.verdict, "judging");
  release();
  release(); // twice is harmless
  await done;
  assert.deepEqual(asked, ["p1", "p2"]);
  assert.equal(askHeld(), false);
});

test("pause: a stopped scan does not wait for the hold to end", async () => {
  const sc = scanner([], { paused: true });
  const release = holdAsk();
  const run = new AbortController();
  const done = sc.scan(places("p1"), run.signal);
  await sleep(10);
  run.abort();
  await done;
  assert.equal(sc.results.has("p1"), false);
  release();
});

test("pausable gate: requests wait for the hold, stop on abort, and the plain gate never waits", async () => {
  const urls: string[] = [];
  const gate: Gate = { blockedUntil: 0, waitingUntil: 0, block() {}, async text(u) { urls.push(u); return "ok"; } };
  const g = pausable(gate);
  const release = holdAsk();
  const held = g.text("/a");
  const ac = new AbortController();
  const stopped = g.text("/b", ac.signal);
  await gate.text("/direct");
  await sleep(10);
  assert.deepEqual(urls, ["/direct"]);
  ac.abort();
  await assert.rejects(stopped);
  release();
  assert.equal(await held, "ok");
  assert.deepEqual(urls, ["/direct", "/a"]);
});

/* A stand-in for Maps' router: on popstate it records the place twice, like the measured page (push, then replace). */
function fakeMaps(mode: "push" | "replace-then-push" | "none") {
  const entries: string[] = ["/maps/search/x/@1,2,17z"];
  let index = 0;
  class FakeHistory {
    get length() { return entries.length; }
    pushState(_s: unknown, _t: string, u?: string | URL | null) { entries.splice(index + 1); entries.push(String(u)); index++; }
    replaceState(_s: unknown, _t: string, u?: string | URL | null) { entries[index] = String(u); }
  }
  const history = new FakeHistory() as unknown as History;
  const win = {
    history,
    location: { origin: "https://www.google.com" } as Location,
    addEventListener() {}, postMessage() {},
    PopStateEvent: class { constructor(public type: string) {} } as unknown as typeof PopStateEvent,
    dispatchEvent(e: Event) {
      if (mode === "none") return true;
      const at = entries[index];
      const full = at.replace("!4m2!3m1", "!4m6!3m5") + "!16s";
      setTimeout(() => (mode === "push" ? history.pushState({}, "", full) : history.replaceState({}, "", at)), 5);
      if (mode === "replace-then-push") setTimeout(() => history.pushState({}, "", full), 15);
      return !!e;
    },
  };
  return { win, entries, history };
}

test("placeNav: Maps' own history calls for the place fold into one entry, so Back returns to the list", async () => {
  for (const mode of ["push", "replace-then-push"] as const) {
    const { win, entries, history } = fakeMaps(mode);
    const replies: boolean[] = [];
    openInPage(win, "/maps/place/A/@1,2,17z/data=!4m2!3m1!1s0x1:0x2", "0x1:0x2", (ok) => replies.push(ok), 40);
    await sleep(60);
    assert.equal(entries.length, 2, mode);
    assert.equal(entries[0], "/maps/search/x/@1,2,17z");
    assert.match(entries[1], /!16s$/);
    assert.equal(replies[0], true);
    // the wrapper is gone again: the page's later navigation pushes as usual
    assert.equal(Object.prototype.hasOwnProperty.call(history, "pushState"), false);
  }
  const { win } = fakeMaps("none");
  const replies: boolean[] = [];
  openInPage(win, "/maps/place/A/data=!4m2!3m1!1s0x1:0x2", "0x1:0x2", (ok) => replies.push(ok), 20);
  await sleep(40);
  assert.deepEqual(replies, [false]);
});
