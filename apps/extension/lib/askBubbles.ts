import { distance } from "./areaSearch";
import { hasLunch, type AskRow } from "./askCombine";
import { isFinal } from "./lunchScan";
import type { FoundPlace, LatLng } from "./mapsData";

/*
 * 問地圖 on the map: every place the search found is drawn while the questions are judged, so the map
 * itself shows the work (design canvas 2026-11-04):
 *   candidate  found, not judged yet (or skipped for now)   hollow dashed dot
 *   judging    a question is reading it (Nano ~3 s)          dot in a dashed yellow ring
 *   sure       every question says yes from Maps' own data   green ring
 *   likely     every question yes, one only from Nano         yellow ring
 *   no         some question says no                         fades out
 * Matches are numbered once judging ends (assignRanks), so the numbers never reshuffle.
 */
export type BubbleState = "candidate" | "judging" | "sure" | "likely" | "no";
export type Bubble = { fid: string; name: string; pos: LatLng; state: BubbleState; row?: AskRow };

/**
 * One place's state across the selected questions. Differs from the combined verdict (askCombine) where
 * that would say "none" too early: a question that has not looked at the place yet (lunch only scans the
 * places that pass the others) or skipped it for now (Nano cap) leaves the place a candidate.
 */
export function bubbleState(row?: AskRow): BubbleState {
  if (!row) return "candidate";
  const rs = row.parts.map(([, r]) => r);
  if (rs.some((r) => r && isFinal(r.verdict) && !hasLunch(r) && !r.skipped)) return "no";
  if (rs.some((r) => r && !isFinal(r.verdict))) return "judging";
  if (rs.some((r) => !r || r.skipped)) return "candidate";
  return rs.every((r) => r!.verdict === "menu") ? "sure" : "likely";
}

/** Every pool place that has a position: from its search record, else from a cached verdict. */
export function bubblesFor(pool: FoundPlace[], rows: AskRow[], posOf: (p: FoundPlace) => LatLng | null | undefined): Bubble[] {
  const byFid = new Map(rows.map((r) => [r.fid, r]));
  const out: Bubble[] = [];
  for (const p of pool) {
    const row = byFid.get(p.fid);
    const pos = posOf(p) ?? row?.pos;
    if (pos) out.push({ fid: p.fid, name: p.name, pos, state: bubbleState(row), row });
  }
  return out;
}

export const isMatch = (s: BubbleState) => s === "sure" || s === "likely";

/**
 * Rank numbers for the matches: numbers already handed out stay; new matches are appended, sure before
 * likely, then nearest to `center` (the searched area's centre, not the live camera). A place that stops
 * matching keeps its number out of the way (others are not renumbered).
 */
export function assignRanks(prev: ReadonlyMap<string, number>, bubbles: Bubble[], center: LatLng): Map<string, number> {
  const out = new Map(prev);
  let next = Math.max(0, ...out.values()) + 1;
  const fresh = bubbles.filter((b) => isMatch(b.state) && !out.has(b.fid))
    .map((b) => ({ b, sure: b.state === "sure" ? 0 : 1, d: distance(b.pos, center) }))
    .sort((x, y) => x.sure - y.sure || x.d - y.d);
  for (const { b } of fresh) out.set(b.fid, next++);
  return out;
}
