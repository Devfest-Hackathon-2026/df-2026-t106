import { isFinal, type LunchResult } from "./lunchScan";
import type { FoundPlace } from "./mapsData";
import { QUESTIONS, type QuestionId } from "./questions";

/** A yes: sure (menu) or likely. The name is historical (lunch was the first question). */
export const hasLunch = (r: LunchResult) => r.verdict === "menu" || r.verdict === "likely";

/** One place across the selected questions. verdict: menu = all sure, likely = all yes, none = some no, pending = still checking. */
export type AskRow = LunchResult & { parts: [QuestionId, LunchResult | undefined][] };

/**
 * The selected questions are an intersection: a place matches only when every question says yes.
 * Places no question has looked at yet are left out.
 */
export function combine(pool: FoundPlace[], active: QuestionId[], result: (id: QuestionId, fid: string) => LunchResult | undefined): AskRow[] {
  const rows: AskRow[] = [];
  for (const p of pool) {
    const parts = active.map((id) => [id, result(id, p.fid)] as [QuestionId, LunchResult | undefined]);
    const rs = parts.map(([, r]) => r);
    if (!rs.length || rs.every((r) => !r)) continue;
    const busy = rs.some((r) => r && !isFinal(r.verdict));
    const yes = rs.every((r) => r && hasLunch(r));
    const verdict: LunchResult["verdict"] = yes ? (rs.every((r) => r!.verdict === "menu") ? "menu" : "likely") : busy ? "judging" : "none";
    const lunch = parts.find(([id]) => QUESTIONS[id].kind === "meal")?.[1];
    const quoted = rs.find((r) => r?.evidence && (r.evidence.source === "review" || r.evidence.source === "owner"));
    rows.push({ fid: p.fid, name: p.name, verdict, pos: rs.find((r) => r?.pos)?.pos, price: lunch?.price, evidence: quoted?.evidence, parts });
  }
  return rows;
}

