/*
 * Google Maps' own place JSON — the same request the Maps UI makes when a place opens.
 * We never build the opaque `pb` parameter ourselves: the place HTML embeds the data request
 * as <link rel=preload href="/maps/preview/place?...">, so we fetch the page and follow that link.
 * Field indexes measured 2026-10-30 (see fixtures/lunch-research-ikebukuro.json).
 */

import { mapsGate, type Gate } from "./mapsGate";

export type RawPlace = any[];

/** Indexes into the place array. Keep every Maps-internal position here so a format change is a one-file fix. */
export const PLACE = {
  website: 7, coords: 9, fid: 10, name: 11, categories: 13, attrs: 100, moreHours: 118,
  posts: 122, menu: 125, snippet: 142, topics: 153, description: 154, reviews: 175, hours: 203,
} as const;

const XSSI = /^\)\]\}'\s*/;
export const parseMapsJson = (text: string): unknown => JSON.parse(text.replace(XSSI, ""));

export function walk(node: unknown, visit: (arr: any[]) => void) {
  if (!Array.isArray(node)) return;
  visit(node);
  for (const c of node) walk(c, visit);
}

/** The place record is the first array with >100 slots and a name string at [11]. */
export function findPlace(json: unknown): RawPlace | null {
  let found: RawPlace | null = null;
  walk(json, (n) => { if (!found && n.length > 100 && typeof n[PLACE.name] === "string") found = n; });
  return found;
}

export type LatLng = { lat: number; lng: number };
const isLatLng = (a: unknown): a is [unknown, unknown, number, number] =>
  Array.isArray(a) && typeof a[2] === "number" && typeof a[3] === "number" && Math.abs(a[2]) <= 90 && Math.abs(a[3]) <= 180;

/** Coordinates live at [9] as [null, null, lat, lng] (same shape as in search results); fall back to the first such quad. */
export function coordsOf(p: RawPlace): LatLng | null {
  let q: unknown = p[PLACE.coords];
  if (!isLatLng(q)) { q = null; walk(p, (n) => { if (!q && n.length === 4 && n[0] == null && n[1] == null && isLatLng(n)) q = n; }); }
  return isLatLng(q) ? { lat: q[2], lng: q[3] } : null;
}

export function preloadHref(html: string, path: string): string | null {
  const esc = path.replace(/[/?.]/g, "\\$&");
  const m = html.match(new RegExp(`href="(${esc}\\?[^"]+)"`));
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

/** Fetches one place's full record by feature id (0x…:0x…). `hl=ja` keeps labels in the store's language. */
export async function fetchPlace(name: string, fid: string, signal?: AbortSignal, gate: Gate = mapsGate): Promise<RawPlace> {
  const page = `/maps/place/${encodeURIComponent(name || "x")}/data=!4m2!3m1!1s${fid}?hl=ja`;
  const href = preloadHref(await gate.text(page, signal), "/maps/preview/place");
  if (!href) throw new Error("place data link not found");
  const place = findPlace(parseMapsJson(await gate.text(href, signal)));
  if (!place) throw new Error("place record not found");
  return place;
}

/**
 * The opened place is needed by several cards (lunch chip, what-to-order); share one fetch per place.
 * Failed fetches are forgotten so a later try can succeed. Keeps the last 20 places.
 */
const recent = new Map<string, Promise<RawPlace>>();
export function fetchPlaceShared(name: string, fid: string, signal?: AbortSignal): Promise<RawPlace> {
  let p = recent.get(fid);
  if (!p) {
    p = fetchPlace(name, fid, signal);
    p.catch(() => recent.delete(fid));
    recent.set(fid, p);
    if (recent.size > 20) recent.delete(recent.keys().next().value!);
  }
  return p;
}

/**
 * A search hit; `raw` is the light search record (hours, secondary hours, coords, attributes — no menu/posts).
 * `snippets`: every review quote Maps attached to this place across the keyword searches that found it
 * ([142] is per query, so 電源 カフェ and Wi-Fi カフェ can give the same place different quotes).
 */
export type FoundPlace = { fid: string; name: string; category?: string; raw?: RawPlace; snippets?: string[] };

/** The review quote Maps picked for this search hit: [142][1][0][1][0][0], wrapped in "…" (search records only). */
export function snippetOf(p: RawPlace): string | null {
  const s = p?.[PLACE.snippet]?.[1]?.[0]?.[1]?.[0]?.[0];
  return typeof s === "string" && s.trim() ? s.trim().replace(/^["“「]|["”」]$/g, "").trim() : null;
}

/** Search results JSON: entries at [64][i][1]; trailing junk after the JSON is stripped. */
export function parseSearch(text: string): FoundPlace[] {
  const json = parseMapsJson(text.replace(/\/\*""\*\/\s*$/, "")) as any[];
  const out: FoundPlace[] = [];
  for (const e of Array.isArray(json?.[64]) ? json[64] : []) {
    const p = Array.isArray(e) ? e.find((x: unknown) => Array.isArray(x) && x.length > 50) : null;
    if (p && typeof p[PLACE.fid] === "string" && typeof p[PLACE.name] === "string")
      out.push({ fid: p[PLACE.fid], name: p[PLACE.name], category: Array.isArray(p[PLACE.categories]) ? p[PLACE.categories][0] : undefined, raw: p });
  }
  return out;
}

/**
 * One Maps search for `query` around a camera (`@lat,lng,zoomz`). The opaque pb carries the page size as
 * `!7i20`; `!7i<n>!8i<offset>` pages through results (measured: 100 per page works).
 * Measured 2026-10-31 around 鳥良商店 (3.6★, z17): not in 居酒屋 top 100, #113 on page 2; page 2 still
 * has a 376 m median distance, page 3 a 3.9 km one — so 2 pages of 100, then keep what is on screen.
 * Cost: 1 page HTML + 1 request per results page.
 */
export const SEARCH_PAGE = 100, SEARCH_PAGES = 2;
export const withPageSize = (href: string, count: number, offset = 0) =>
  href.replace(/(%21|!)7i20(?=%21|!|&|$)/, (_m, bang: string) => `${bang}7i${count}${offset ? `${bang}8i${offset}` : ""}`);

/**
 * The /search link of one camera, reused for every query there (only `q` differs; pb carries no query
 * text). Measured 2026-11-01, 池袋: the swapped link returns 99/100 of the same places and saves the
 * 220 KB page HTML per query.
 */
const searchTemplates = new Map<string, string>();
export function withQuery(href: string, query: string) {
  const u = new URL(href, "https://www.google.com");
  u.searchParams.set("q", query);
  return `${u.pathname}?${u.searchParams.toString()}`;
}

/**
 * Results pages are 3–4 MB each (~2.5 s). Measured 2026-11-01 for 6 queries x 2 pages: one after another
 * 32.5 s; in parallel (the gate still allows 4 at once) 8.1 s, first page after 2.8 s. So both pages are
 * requested together and `onPage` hands each page over as soon as it lands.
 */
export async function searchAt(query: string, camera: string, signal?: AbortSignal, gate: Gate = mapsGate,
  count = SEARCH_PAGE, pages = SEARCH_PAGES, onPage?: (page: FoundPlace[]) => void): Promise<FoundPlace[]> {
  let tpl = searchTemplates.get(camera);
  if (!tpl) {
    const html = await gate.text(`/maps/search/${encodeURIComponent(query)}/${camera}?hl=ja`, signal);
    tpl = preloadHref(html, "/search") ?? undefined;
    if (!tpl) throw new Error("search data link not found");
    searchTemplates.set(camera, tpl);
    if (searchTemplates.size > 20) searchTemplates.delete(searchTemplates.keys().next().value!);
  }
  const href = withQuery(tpl, query);
  const all = await Promise.all(Array.from({ length: pages }, async (_, i) => {
    const page = parseSearch(await gate.text(withPageSize(href, count, i * count), signal));
    onPage?.(page);
    return page;
  }));
  return all.flat();
}
