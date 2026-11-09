import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockedError, createGate, GATE } from "../lib/mapsGate";
import { cameraOf, collectRound, movedFrom, ROUND_MAX_NEW, spreadPick } from "../lib/areaSearch";
import { parseSearch } from "../lib/mapsData";

const res = (url: string, status = 200, body = "ok") => ({ url, status, text: async () => body }) as unknown as Response;

test("gate: never more than GATE.concurrency in flight, starts spaced by minGap", async () => {
  // fake clock: time only moves when the gate sleeps, so total sleep = enforced spacing
  let t = 0, slept = 0, inFlight = 0, peak = 0;
  const gate = createGate({
    now: () => t,
    sleep: async (ms) => { t += ms; slept += ms; },
    fetch: async (u) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return res(u); },
  });
  const n = 9;
  await Promise.all(Array.from({ length: n }, (_, i) => gate.text(`/maps/${i}`)));
  assert.ok(peak <= GATE.concurrency, `peak ${peak}`);
  assert.ok(slept >= (n - 1) * GATE.minGapMs - 1e-9, `slept ${slept}`);
});

test("gate: /sorry or 429 blocks every later request for the cool-down", async () => {
  let t = 1000, calls = 0;
  let blockedAt = 0;
  const gate = createGate({
    now: () => t, sleep: async () => {},
    fetch: async (u) => { calls++; return calls === 2 ? res("https://www.google.com/sorry/index?continue=x", 200) : res(u); },
    onBlocked: (until) => { blockedAt = until; },
  });
  assert.equal(await gate.text("/a"), "ok");
  await assert.rejects(gate.text("/b"), BlockedError);
  assert.equal(blockedAt, t + GATE.coolDownMs);
  await assert.rejects(gate.text("/c"), BlockedError);
  assert.equal(calls, 2, "no request is sent while blocked");
  t += GATE.coolDownMs + 1;
  assert.equal(await gate.text("/d"), "ok");
  const g429 = createGate({ now: () => 0, sleep: async () => {}, fetch: async (u) => res(u, 429) });
  await assert.rejects(g429.text("/x"), BlockedError);
});

test("area helpers: camera string, moved detection", () => {
  assert.equal(cameraOf("https://www.google.com/maps/search/x/@35.7282,139.7128,17z/data=!3m1"), "@35.7282,139.7128,17z");
  assert.equal(cameraOf("/maps/@35.7,139.7,800m/data"), null);
  const a = { lat: 35.7282, lng: 139.7128, zoom: 17 };
  assert.equal(movedFrom(a, { ...a, zoom: 16 }), true);
  assert.equal(movedFrom(a, { ...a, lng: a.lng + 0.0005 }), false); // ~93 px at z17
  assert.equal(movedFrom(a, { ...a, lng: a.lng + 0.005 }), true); // ~470 px
});

test("collectRound dedupes across queries and caps places that need a fetch", async () => {
  const fake = async (q: string) => Array.from({ length: 80 }, (_, i) => ({ fid: `${q === "B" ? i + 10 : i}`, name: `${q}${i}` }));
  const seen = new Set(["0"]);
  const out = await collectRound("@1,2,17z", ["A", "B"], seen, new AbortController().signal, undefined, fake as any);
  assert.equal(out.length, ROUND_MAX_NEW);
  assert.equal(new Set(out.map((p) => p.fid)).size, out.length);
  assert.equal(out.some((p) => p.fid === "0"), false);
  assert.equal(seen.has("89"), false, "capped places are not marked seen, so a later round can pick them up");
});

test("collectRound: search records decide closed places for free and sort nearest first", async () => {
  const rec = (lat: number, lng: number, open: [number[], number[]]) => {
    const p: any[] = new Array(260).fill(null);
    p[9] = [null, null, lat, lng];
    p[203] = [[["月曜日", 1, [2026, 11, 2], [["x", open]], 0, 1]]];
    return p;
  };
  const night = Array.from({ length: 70 }, (_, i) => ({ fid: `n${i}`, name: `n${i}`, raw: rec(35.7 + i * 5e-5, 139.7, [[17], [23]]) }));
  const lunch = [{ fid: "far", name: "far", raw: rec(35.704, 139.704, [[11], [22]]) }, { fid: "near", name: "near", raw: rec(35.7001, 139.7, [[11], [22]]) }];
  const far = { fid: "km", name: "km", raw: rec(35.75, 139.75, [[11], [22]]) }; // ~7 km away: off screen
  const out = await collectRound("@35.7,139.7,17z", ["X"], new Set(), new AbortController().signal, undefined, (async () => [...night, ...lunch, far]) as any);
  assert.equal(out.length, 72, "70 dinner-only places do not use the fetch budget; off-screen places are dropped");
  const order = out.map((p) => p.fid);
  assert.ok(order.indexOf("near") < order.indexOf("far"));
});

test("spreadPick: a dense centre square does not take every slot", () => {
  const center = { lat: 35.7295, lng: 139.7109, zoom: 17 };
  // 100 places within ~20 m of the centre, then one in each of 8 squares ~250–350 m out
  const dense = Array.from({ length: 100 }, (_, i) => ({ id: `d${i}`, lat: 35.7295 + i * 1e-6, lng: 139.7109 }));
  const ring = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, lat: 35.7295 + Math.sin(i * Math.PI / 4) * 0.003, lng: 139.7109 + Math.cos(i * Math.PI / 4) * 0.003 }));
  const { picked, rest } = spreadPick([...dense, ...ring], (p) => p, center, 20, { w: 1920, h: 945 });
  assert.equal(picked.length, 20);
  assert.equal(rest.length, 88);
  assert.equal(picked.filter((p) => p.id.startsWith("r")).length, 8, "every outer square gets a turn");
  assert.deepEqual(picked.filter((p) => p.id.startsWith("d")).map((p) => p.id), dense.slice(0, 12).map((p) => p.id), "nearest first inside a square");
  const off = { id: "off", lat: 35.7295 + 0.006, lng: 139.7109 }; // ~670 m north: outside a 945 px tall window
  assert.equal(spreadPick([off, ...dense], (p) => p, center, 100, { w: 1920, h: 945 }).picked.includes(off), false);
});

test("collectRound: places over the cap wait in `pending` and come first next round; cached ones are free", async () => {
  const many = Array.from({ length: ROUND_MAX_NEW + 15 }, (_, i) => ({ fid: `p${i}`, name: `p${i}` }));
  const pending: any[] = [], seen = new Set<string>();
  const known = async (fids: string[]) => new Set(fids.filter((f) => f === "p70"));
  const out = await collectRound("@1,2,17z", ["A"], seen, new AbortController().signal, undefined, (async () => many) as any, undefined, undefined, undefined, { pending, known });
  assert.equal(out.length, ROUND_MAX_NEW + 1, "p70 has a cached verdict and does not use the cap");
  assert.equal(pending.length, 14);
  assert.equal(seen.has("p74"), true, "waiting places stay seen: the same query is not run again");
  const next = await collectRound("@1,2,17z", [], seen, new AbortController().signal, undefined, (async () => []) as any, undefined, undefined, undefined, { pending });
  assert.deepEqual(next.map((p) => p.fid).sort(), many.slice(ROUND_MAX_NEW).map((p) => p.fid).filter((f) => f !== "p70").sort());
  assert.equal(pending.length, 0);
});

test("withPageSize rewrites the pb page size", async () => {
  const { withPageSize } = await import("../lib/mapsData");
  assert.equal(withPageSize("/search?tbm=map&pb=!1m4%217i20%2132i1", 40), "/search?tbm=map&pb=!1m4%217i40%2132i1");
  assert.equal(withPageSize("/search?pb=!7i20!32i1", 60), "/search?pb=!7i60!32i1");
  assert.equal(withPageSize("/search?pb=%217i20%2132i1", 100, 100), "/search?pb=%217i100%218i100%2132i1");
});

test("parseSearch reads [64][i][1] place records", () => {
  const place = new Array(60).fill(null);
  place[10] = "0x1:0x2"; place[11] = "鳥良商店"; place[13] = ["居酒屋"];
  const json = new Array(70).fill(null);
  json[64] = [[null, place], [null, new Array(60).fill(null)]];
  assert.deepEqual(parseSearch(")]}'\n" + JSON.stringify(json) + '/*""*/').map(({ raw, ...p }) => p), [{ fid: "0x1:0x2", name: "鳥良商店", category: "居酒屋" }]);
});

test("gate: rolling budget pauses after windowMax starts, then continues", async () => {
  let t = 0;
  const gate = createGate({ now: () => t, sleep: async (ms) => { t += Math.max(0, ms); }, fetch: async (u) => res(u) });
  for (let i = 0; i < GATE.windowMax; i++) await gate.text("/r");
  const before = t;
  await gate.text("/r");
  assert.ok(t >= GATE.windowMs, `waited until the first start left the window (t=${t}, before=${before})`);
});

test("withAccount keeps authuser on every Maps URL", async () => {
  const { withAccount } = await import("../lib/account");
  const page = "https://www.google.com/maps/search/x/@35.7,139.7,17z?authuser=1&hl=zh-TW";
  assert.equal(withAccount("/maps/place/A/data=!4m2!3m1!1s0x1:0x2", page), "/maps/place/A/data=!4m2!3m1!1s0x1:0x2?authuser=1");
  assert.equal(withAccount("/maps/search/q/@1,2,17z?hl=ja", page), "/maps/search/q/@1,2,17z?hl=ja&authuser=1");
  assert.equal(withAccount("/x?authuser=0", page), "/x?authuser=0", "explicit authuser wins");
  assert.equal(withAccount("/x", "https://www.google.com/maps/@1,2,3z"), "/x", "no account in page → unchanged");
});
