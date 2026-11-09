import { test } from "node:test";
import assert from "node:assert/strict";
import { clearLocalCache, isCacheKey, noCacheOn } from "../lib/noCache";
import { gatedStore, localLunchStore, LUNCH_VERSION } from "../lib/lunchStore";

const FID = "0x60188d681355b373:0x984160981caefe27";

function memKV(init: Record<string, unknown>) {
  const m: Record<string, unknown> = { ...init };
  return {
    m,
    async get(k: string | string[] | null) {
      if (k == null) return { ...m };
      return Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in m).map((x) => [x, m[x]]));
    },
    async set(o: Record<string, unknown>) { Object.assign(m, o); },
    async remove(ks: string[]) { for (const k of ks) delete m[k]; },
  };
}

test("cache keys: answers, dishes, last set and old language entries — never settings", () => {
  for (const k of [`lunch:${LUNCH_VERSION}:${FID}`, `outlet:r1:${FID}`, `dishes:d2:${FID}`, "ask:lastSet", "lang:v3:ChZDSUhN"]) assert.ok(isCacheKey(k), k);
  for (const k of ["advanced", "devMode", "noCache", "uiLang", "layersOn", "dishesOpen", "shareLunch"]) assert.ok(!isCacheKey(k), k);
});

test("clearLocalCache removes only cache keys and counts them", async () => {
  const kv = memKV({ [`lunch:${LUNCH_VERSION}:${FID}`]: 1, [`dishes:d2:${FID}`]: 2, "ask:lastSet": 3, advanced: true, devMode: true, uiLang: "ja" });
  assert.equal(await clearLocalCache(kv), 3);
  assert.deepEqual(Object.keys(kv.m).sort(), ["advanced", "devMode", "uiLang"]);
  assert.equal(await clearLocalCache(kv), 0);
});

test("noCacheOn needs dev mode too", async () => {
  assert.equal(await noCacheOn(memKV({ noCache: true, devMode: true })), true);
  assert.equal(await noCacheOn(memKV({ noCache: true })), false);
  assert.equal(await noCacheOn(memKV({ devMode: true })), false);
});

test("gatedStore: while off it reads nothing and writes nothing; back on it is the real store", async () => {
  const kv = memKV({});
  let off = false;
  const s = gatedStore(localLunchStore(kv), () => off);
  await s.put([[FID, { verdict: "menu", at: Date.now(), v: LUNCH_VERSION }]]);
  assert.equal((await s.get([FID])).size, 1);
  off = true;
  assert.equal((await s.get([FID])).size, 0);
  await s.put([["0x1:0x2", { verdict: "menu", at: Date.now(), v: LUNCH_VERSION }]]);
  assert.equal(Object.keys(kv.m).length, 1);
  off = false;
  assert.equal((await s.get([FID])).size, 1);
});
