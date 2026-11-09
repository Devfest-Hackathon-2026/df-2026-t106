/*
 * Keep the user's Google account on every Maps URL we open or fetch. A bare `/maps/place/…`
 * falls back to authuser=0 — on 2026-10-31 clicking a row switched the user's signed-in Gmail.
 */
const KEEP = ["authuser"] as const;

/** Copies `authuser` from `from` (default: the current page) onto `url` unless it already has one. */
export function withAccount(url: string, from?: string): string {
  const base = from ?? (typeof location !== "undefined" ? location.href : "");
  if (!base) return url;
  const cur = new URL(base);
  const u = new URL(url, cur.origin);
  for (const k of KEEP) { const v = cur.searchParams.get(k); if (v && !u.searchParams.has(k)) u.searchParams.set(k, v); }
  // keep relative URLs relative (same origin), absolute ones absolute
  return /^https?:/.test(url) ? u.href : u.pathname + u.search + u.hash;
}

/** storage.local: the `authuser` of the last Maps page the content script ran on (absent = default account). */
export const MAPS_ACCOUNT_KEY = "mapsAuthuser";

/** Content script: remember this page's account, so the popup opens Maps in the same one. */
export function rememberAccount(href = location.href) {
  const v = new URL(href).searchParams.get("authuser");
  return v ? browser.storage.local.set({ [MAPS_ACCOUNT_KEY]: v }) : browser.storage.local.remove(MAPS_ACCOUNT_KEY);
}

/** The Maps home page in the given account. */
export function mapsHome(authuser?: string | null): string {
  return authuser ? `https://www.google.com/maps/?authuser=${encodeURIComponent(authuser)}` : "https://www.google.com/maps/";
}
