import type { LunchResult } from "@/lib/lunchScan";
import type { QuestionId } from "@/lib/questions";
import type { T } from "@/lib/i18n/useT";

/** One question's answer for one place, in the UI language (list rows, stickers, the map hover card). */
export function partLabel({ t, q }: T, id: QuestionId, r?: LunchResult): string {
  if (!r) return t.verdict.notChecked;
  const v = r.verdict;
  return v === "menu" || v === "likely" || v === "none" || v === "closed" ? q(id).labels[v] : t.verdict[v];
}

export const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
