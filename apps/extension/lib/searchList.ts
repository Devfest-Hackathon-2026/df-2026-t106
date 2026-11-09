import { withAccount } from "./account";
import type { LatLng } from "./mapsData";
import { parseView, worldPx, type View } from "./mapView";
import { requestOpen } from "./placeNav";

/* The Maps search-results list (left panel) — what the user is looking at, so the scan stays user-sized. */

export const isSearchPage = () => location.pathname.startsWith("/maps/search/");

export type ListedPlace = { fid: string; name: string };

const FID_RE = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/gi;
/**
 * The feature id of the place a Maps URL shows. Opening a place from another place's page keeps the
 * previous one in a nested data block (…!1m9!3m8!1s<previous>…!3m7!1s<current>…), so the current
 * place is the LAST id, not the first.
 */
export const fidFromHref = (href: string) => [...href.matchAll(FID_RE)].pop()?.[1] ?? null;

/** Result cards are <a class="hfpxzc" aria-label=name href=".../data=…!1s<fid>…">; ads use the same markup. */
export function listedPlaces(root: ParentNode = document): ListedPlace[] {
  const seen = new Set<string>();
  const out: ListedPlace[] = [];
  for (const a of root.querySelectorAll<HTMLAnchorElement>("a.hfpxzc")) {
    const fid = fidFromHref(a.href);
    const name = a.getAttribute("aria-label")?.trim();
    if (!fid || !name || seen.has(fid)) continue;
    seen.add(fid); out.push({ fid, name });
  }
  return out;
}

export function openListed(fid: string) {
  const a = [...document.querySelectorAll<HTMLAnchorElement>("a.hfpxzc")].find((x) => fidFromHref(x.href) === fid);
  a?.click();
  return !!a;
}

/** Set right before our own full page load; the next page load restores the results once. */
export const KEEP_RESULTS_KEY = "gmap-ask-keep";

const placeUrl = (fid: string, name: string, cam: string) =>
  withAccount(`/maps/place/${encodeURIComponent(name)}/${cam ? `${cam}/` : ""}data=!4m2!3m1!1s${fid}`);

/** Is `pos` inside the window at this camera (the URL centre taken as the window centre)? */
function onScreen(pos: LatLng, view: View) {
  const p = worldPx(pos, view.zoom), c = worldPx(view, view.zoom);
  return Math.abs(p.x - c.x) < innerWidth / 2 && Math.abs(p.y - c.y) < innerHeight / 2;
}

/**
 * Opens a place without leaving the page when possible:
 *  1. its card in the left list → click it (Maps' own SPA navigation);
 *  2. otherwise Maps' router opens it in place (lib/placeNav.ts). The camera stays where it is when the
 *     place is on screen (like clicking a pin), else it centres on the place;
 *  3. only if Maps did not route: a full page load (the panel restores its results once, see QuestionFinder).
 * Every URL keeps the signed-in account (authuser).
 */
export async function openPlace(fid: string, name: string, pos?: LatLng | null) {
  if (openListed(fid)) return;
  const view = parseView(location.pathname);
  const here = location.pathname.match(/@[^/]+/)?.[0] ?? "";
  const cam = pos && view && !onScreen(pos, view) ? `@${pos.lat},${pos.lng},${view.zoom}z` : here;
  const r = await requestOpen(fid, placeUrl(fid, name, cam));
  if (r === "opened") return;
  // page load: the camera goes to the place itself (passing the current camera kept the map where it was)
  const zoom = view?.zoom ?? 17;
  const url = placeUrl(fid, name, pos ? `@${pos.lat},${pos.lng},${Math.max(16, Math.round(zoom))}z` : "");
  try { sessionStorage.setItem(KEEP_RESULTS_KEY, String(Date.now())); } catch { /* storage blocked */ }
  // "failed" already pushed the place URL: replace that entry so Back still leads to the list
  if (r === "failed") location.replace(url); else location.assign(url);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Maps shows an "end of list" line once every result is loaded. */
export const listEnded = () => !!document.querySelector('div[role="feed"] .HlvSq');

/** Scrolls the results feed so Maps appends its next page. Resolves to how many new places appeared (0 = end of list). */
export async function loadMoreListed(signal?: AbortSignal, timeoutMs = 8000): Promise<number> {
  const feed = document.querySelector<HTMLElement>('div[role="feed"]');
  if (!feed) return 0;
  const before = listedPlaces().length;
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs && !signal?.aborted) {
    feed.scrollTop = feed.scrollHeight;
    await sleep(600);
    const n = listedPlaces().length;
    if (n > before) { await sleep(400); return listedPlaces().length - before; }
    if (feed.querySelector(".HlvSq")) return 0; // "end of list" marker
  }
  return 0;
}
