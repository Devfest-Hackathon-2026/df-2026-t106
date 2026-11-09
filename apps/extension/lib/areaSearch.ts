import { searchAt, snippetOf, type FoundPlace, type LatLng } from "./mapsData";
import { extractFacts, quickVerdict } from "./lunch";
import type { Gate } from "./mapsGate";
import { parseView, worldPx, type View } from "./mapView";
import { LUNCH } from "./meals";
import type { QuestionSpec } from "./questions";

/*
 * "找午餐" searches the current map area itself instead of relying on the user's list:
 * Maps' レストラン category leaves out most 居酒屋 / カフェ that serve ランチ (鳥良 never shows
 * under 餐廳, 72 results deep). Measured 2026-10-30 around 南池袋 (z17), places found ONLY by that
 * query: 居酒屋 16/20, カフェ 7/20, 定食 12/20, 中華 14/20, 焼肉 18/20, レストラン 5/20.
 * Rounds keep each click small (rate limit: see mapsGate) — "載入更多" runs the next round.
 */
export const LUNCH_ROUNDS: string[][] = LUNCH.rounds; // per-meal rounds live in meals.ts
export const ROUND_MAX_NEW = 60;

/** `@lat,lng,zoomz` from a Maps URL (null for satellite/3D `…m` views). */
export function cameraOf(href: string): string | null {
  const v = parseView(href);
  return v ? `@${v.lat},${v.lng},${v.zoom}z` : null;
}

/** The map moved enough that "this area" means something else: a zoom step, or >300 px of pan. */
export function movedFrom(a: View, b: View) {
  if (Math.abs(a.zoom - b.zoom) >= 1) return true;
  const p = worldPx(a, a.zoom), q = worldPx(b, a.zoom);
  return Math.hypot(p.x - q.x, p.y - q.y) > 300;
}

/** Metres between two points (equirectangular; fine at city scale). */
export const distance = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111_000, (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180));

/**
 * Runs one round of queries and returns new places nearest the camera first. Places the light search
 * record shows closed at meal time (or with a cached verdict) cost no extra request, so only the ones
 * needing a detail fetch (everything else, incl. owner-set lunch hours: the menu and its prices are only
 * in the detail) count toward ROUND_MAX_NEW, picked spread over the screen (spreadPick).
 */
/** Rough radius (m) of what is on screen: half the larger window side at this zoom (Web Mercator). */
export function screenRadiusM(view: View, px = typeof innerWidth === "number" ? Math.max(innerWidth, innerHeight) : 1500) {
  const mPerPx = (156_543.03 * Math.cos((view.lat * Math.PI) / 180)) / 2 ** view.zoom;
  return (px / 2) * mPerPx;
}

/**
 * `snips` (optional, owned by the caller across rounds): every review quote Maps attached to a place, from
 * every query that found it — including places already seen — so a 問地圖 question can use a quote from
 * any search. The same array is set as `snippets` on the place, so later rounds update it in place.
 */
/**
 * Up to `n` places spread over the screen instead of the n nearest. Measured 2026-11-05 at 池袋駅 (z17):
 * 509 on-screen places, 300 of them within 239 m (東武 / ルミネ / 西武 floors), so the nearest 60 reached
 * only 169 m and every ring sat on the station. Places go into CELL_PX squares around the camera (input
 * order kept inside a square, so nearest first); squares take turns, nearest square first. Places inside
 * the window come before the rest of the search circle. Places without a position share the centre square.
 */
export const CELL_PX = 240;
export function spreadPick<T>(items: T[], posOf: (t: T) => LatLng | null, center: View, n: number,
  win = typeof innerWidth === "number" ? { w: innerWidth, h: innerHeight } : null): { picked: T[]; rest: T[] } {
  if (items.length <= n) return { picked: items, rest: [] };
  const c = worldPx(center, center.zoom);
  const cells = new Map<string, { d: number; items: T[] }>();
  const off: T[] = [];
  for (const t of items) {
    const pos = posOf(t);
    const p = pos ? worldPx(pos, center.zoom) : c;
    const dx = p.x - c.x, dy = p.y - c.y;
    if (win && (Math.abs(dx) > win.w / 2 || Math.abs(dy) > win.h / 2)) { off.push(t); continue; }
    const k = `${Math.floor(dx / CELL_PX + 0.5)},${Math.floor(dy / CELL_PX + 0.5)}`;
    const cell = cells.get(k) ?? { d: Math.hypot(dx, dy), items: [] };
    cell.items.push(t);
    cells.set(k, cell);
  }
  const order = [...cells.values()].sort((a, b) => a.d - b.d).map((x) => x.items);
  const picked: T[] = [];
  for (let i = 0; picked.length < n && order.some((x) => x.length > i); i++)
    for (const x of order) if (x.length > i && picked.length < n) picked.push(x[i]);
  const took = new Set(picked);
  for (const t of off) if (picked.length < n) { picked.push(t); took.add(t); }
  return { picked, rest: items.filter((t) => !took.has(t)) };
}

export type RoundOpts = {
  /** owned by the caller across rounds: found places the fetch cap left out; the next round judges them first */
  pending?: FoundPlace[];
  /** fids that already have a cached verdict (no request needed, so they don't use the cap) */
  known?: (fids: string[]) => Promise<Set<string>>;
};

/**
 * Queries run in parallel (mapsGate limits concurrency). `onFound`: new on-screen places of each results
 * page as soon as it arrives, nearest first — questions (kind "ask") start judging while the rest loads.
 */
export async function collectRound(camera: string, queries: string[], seen: Set<string>, signal: AbortSignal, gate?: Gate,
  search: typeof searchAt = searchAt, meal: QuestionSpec = LUNCH, snips?: Map<string, string[]>,
  onFound?: (places: FoundPlace[]) => void, opts: RoundOpts = {}): Promise<FoundPlace[]> {
  const center = parseView(`/${camera}`);
  const posOf = (p: FoundPlace) => (p.raw ? extractFacts(p.raw).pos : null);
  const dist = (p: FoundPlace) => { const q = posOf(p); return center && q ? distance(q, center) : 0; };
  // page 2 reaches kilometres away: keep what is on screen, nearest first
  const radius = center ? screenRadiusM(center) : Infinity;
  const found: FoundPlace[] = [];
  const take = (page: FoundPlace[]) => {
    const fresh: FoundPlace[] = [];
    for (const p of page) {
      const s = snips && p.raw ? snippetOf(p.raw) : null;
      if (snips && s) {
        const list = snips.get(p.fid) ?? [];
        if (!list.includes(s)) list.push(s);
        snips.set(p.fid, list);
      }
      if (snips?.has(p.fid)) p.snippets = snips.get(p.fid);
      if (seen.has(p.fid) || dist(p) > radius) continue;
      seen.add(p.fid); found.push(p); fresh.push(p);
    }
    if (fresh.length && meal.kind === "ask") onFound?.(fresh.sort((a, b) => dist(a) - dist(b)));
  };
  // test doubles return the whole list without calling onPage: take() is idempotent for both paths
  await Promise.all(queries.map(async (q) => take(await search(q, camera, signal, gate, undefined, undefined, take))));
  const near = found.sort((a, b) => dist(a) - dist(b));
  // questions are answered from the search record: no detail fetch, no budget
  if (meal.kind === "ask") return near;
  const free: FoundPlace[] = [];
  let fetch: FoundPlace[] = [];
  // places a cap left out in an earlier round come first (they are nearer: rounds go outward)
  for (const p of [...(opts.pending?.splice(0) ?? []), ...near]) {
    if (p.raw && quickVerdict(extractFacts(p.raw), meal)?.verdict === "closed") free.push(p); else fetch.push(p);
  }
  if (opts.known && fetch.length > ROUND_MAX_NEW) {
    const known = await opts.known(fetch.map((p) => p.fid));
    free.push(...fetch.filter((p) => known.has(p.fid)));
    fetch = fetch.filter((p) => !known.has(p.fid));
  }
  const { picked, rest } = center ? spreadPick(fetch, posOf, center, ROUND_MAX_NEW) : { picked: fetch.slice(0, ROUND_MAX_NEW), rest: fetch.slice(ROUND_MAX_NEW) };
  if (opts.pending) opts.pending.push(...rest);
  else for (const p of rest) seen.delete(p.fid); // left for a later round / search
  return [...free, ...picked].sort((a, b) => dist(a) - dist(b));
}
