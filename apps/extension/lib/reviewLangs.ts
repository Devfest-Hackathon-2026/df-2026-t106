import { CHART_OTHER, CHART_SLOTS, type PieDatum } from "@gmap/ui";
import type { TapReview } from "./reviewTap";

/*
 * Which languages a place's reviews are written in (「お店の今」, 基本機能). Maps' own payload names
 * the original language of every review with text (TapReview.lang), so nothing is guessed: this
 * replaced the old Nano language ID (2026-10-30). Rating-only reviews have no language and are left
 * out. Regional variants count as one language (zh-Hant / zh-Hans / zh → zh).
 */

/** "zh-Hant" → "zh", "pt-BR" → "pt". */
export const baseLang = (code: string) => code.trim().toLowerCase().split(/[-_]/)[0];

export type LangSlice = PieDatum & { avg: number };
export type LangShare = {
  total: number;        // reviews with a language
  slices: LangSlice[];  // largest first, "other" last
  foreign: number;      // share not written in Japanese, 0–1
};

// Colors follow the language, never its rank (DESIGN.md §5b): ja / en / zh / ko own slots 0–3; any
// other language takes a free slot (4, 5) on first appearance and keeps it while reviews stream in.
// With no free slot left it folds into "other" — never a 7th hue.
const FIXED_SLOT: Record<string, number> = { ja: 0, en: 1, zh: 2, ko: 3 };
function slotColor(l: string, colorOf: Map<string, string>): string | null {
  const known = colorOf.get(l);
  if (known) return known;
  const fixed = FIXED_SLOT[l];
  const used = new Set(colorOf.values());
  const color = fixed != null ? CHART_SLOTS[fixed] : CHART_SLOTS.slice(4).find((c) => !used.has(c));
  if (!color) return null;
  colorOf.set(l, color);
  return color;
}

/**
 * Every language with at least `minShare` of the reviews gets its own slice (largest first); the
 * rest folds into "other". Small shares are kept on purpose: for a 池袋 store Japanese is ~87%, and
 * the 2–5% in Chinese or Korean is the point for visitors. `nameOf` names a code in the UI language
 * (lib/i18n langName) and is also asked for "other". Keep one `colorOf` map per run.
 */
export function reviewLanguages(
  reviews: Pick<TapReview, "lang" | "stars">[],
  nameOf: (code: string) => string,
  colorOf = new Map<string, string>(),
  minShare = 0.02,
): LangShare {
  const by = new Map<string, { n: number; stars: number }>();
  let total = 0;
  for (const r of reviews) {
    const l = r.lang ? baseLang(r.lang) : "";
    if (!l) continue;
    const b = by.get(l) ?? { n: 0, stars: 0 };
    b.n++; b.stars += r.stars; total++;
    by.set(l, b);
  }
  const sorted = [...by].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1));
  const slices: LangSlice[] = [];
  const rest = { n: 0, stars: 0 };
  for (const [l, b] of sorted) {
    const color = b.n / total >= minShare ? slotColor(l, colorOf) : null;
    if (color) slices.push({ key: l, label: nameOf(l), value: b.n, color, avg: b.stars / b.n });
    else { rest.n += b.n; rest.stars += b.stars; }
  }
  if (rest.n) slices.push({ key: "other", label: nameOf("other"), value: rest.n, color: CHART_OTHER, avg: rest.stars / rest.n });
  return { total, slices, foreign: total ? (total - (by.get("ja")?.n ?? 0)) / total : 0 };
}
