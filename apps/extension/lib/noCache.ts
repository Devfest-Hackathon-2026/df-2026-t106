/*
 * Dev-mode switch 「キャッシュなし」: while it is on — and dev mode is on too — 問地圖, the place-page
 * answers and 「このお店で頼むなら」 read and write no cache (this browser's or the shared one) and judge
 * every place again; a new question also starts over in the open page. Turning it on clears this
 * browser's cache (lib popup). With dev mode off the switch is hidden and does nothing.
 */
export const NO_CACHE_KEY = "noCache";

type Reader = { get(k: string[]): Promise<Record<string, unknown>> };
export const noCacheOn = async (kv: Reader = browser.storage.local) => {
  const v = await kv.get([NO_CACHE_KEY, "devMode"]);
  return v[NO_CACHE_KEY] === true && v.devMode === true;
};

/**
 * Cached data, never settings: per-place answers and dishes (keys end in a place id, any version),
 * the last 問地圖 set (QuestionFinder SAVE_KEY) and entries of the old language ID.
 */
export const isCacheKey = (k: string) => /:0x[0-9a-f]+:0x[0-9a-f]+$/.test(k) || k === "ask:lastSet" || k.startsWith("lang:v");

type Store = { get(k: null): Promise<Record<string, unknown>>; remove(k: string[]): Promise<void> };
/** Removes every cache key from storage.local; returns how many went. */
export async function clearLocalCache(kv: Store = browser.storage.local) {
  const keys = Object.keys(await kv.get(null)).filter(isCacheKey);
  if (keys.length) await kv.remove(keys);
  return keys.length;
}
