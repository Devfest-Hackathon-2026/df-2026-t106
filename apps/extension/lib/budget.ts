/*
 * The lunch budget a sentence names: 「1000円以下の和食ランチ」 → 1000, so the panel's budget filter is set
 * without a second click. Plain rules on the sentence (Gemini Nano is not asked; it only picks templates).
 * Only upper bounds count: an amount followed by 以上 / から / 〜 / 台, or after "over" / "from", is skipped.
 * The result is a price filter on the lunch template, so the panel reads it only when lunch is selected.
 */

/** The budget toggle's fixed choices (yen); a budget named in the sentence is added when it is not one of them. */
export const BUDGET_PRESETS = [800, 1000, 1500] as const;
const MIN = 100, MAX = 30_000;

const UNIT = String.raw`(?:円|えん|日圓|日円|日元|日幣|yen|jpy)`;
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;
const AMOUNT: [RegExp, (m: RegExpExecArray) => number][] = [
  // 1000円, 1,000 yen, 1000日圓
  [new RegExp(String.raw`${NUM}\s*${UNIT}`, "g"), (m) => Number(m[1].replace(/,/g, ""))],
  // ¥1000, jpy 1000
  [new RegExp(String.raw`(?:¥|jpy)\s*${NUM}`, "g"), (m) => Number(m[1].replace(/,/g, ""))],
  // 千円, 1千円, 1.5千円, 千5百円
  [new RegExp(String.raw`(\d+(?:\.\d+)?)?千(?:(\d)百)?${UNIT}`, "g"), (m) => Math.round(Number(m[1] ?? 1) * 1000 + Number(m[2] ?? 0) * 100)],
];
/** Right after the amount: a lower bound, a range start or a price band (1000円台 = 1,000–1,999). */
const LOWER_AFTER = /^\s*(?:以上|超|より上|から|台|~|〜|-|–|to\b|or more|and up|\+)/;
/** Right before the amount: a lower bound. */
const LOWER_BEFORE = /(?:over|above|more than|at least|from|超過|超)\s*$/;

/** The upper price bound the sentence names (yen), or null. */
export function budgetFromText(text: string): number | null {
  const s = text.normalize("NFKC").toLowerCase();
  const found: { at: number; yen: number }[] = [];
  for (const [re, value] of AMOUNT) {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const end = m.index + m[0].length;
      if (LOWER_AFTER.test(s.slice(end, end + 8)) || LOWER_BEFORE.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
      const yen = value(m);
      if (yen >= MIN && yen <= MAX) found.push({ at: m.index, yen });
    }
  }
  if (!found.length) return null;
  return found.sort((a, b) => a.at - b.at)[0].yen;
}

/** The toggle's choices: the presets, plus the sentence's own budget when it is not one of them. */
export const budgetChoices = (asked: number | null) =>
  [...new Set<number>([...BUDGET_PRESETS, ...(asked ? [asked] : [])])].sort((a, b) => a - b);
