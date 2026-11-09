import type { TapReview } from "./reviewTap";

/*
 * Store health from the passive review payload: how the place is doing NOW versus before, plus
 * warning signs. Pure functions; rules measured on fixtures/direction2-meta (35 stores, 6,950
 * reviews, scripts/d2-meta-rules.py). Model verdicts come from services/classify.
 */

export const WARNINGS = ["price", "surprise_charge", "quality_decline", "hygiene", "service"] as const;
export type Warning = (typeof WARNINGS)[number];
export type Category = Warning | "improvement" | "staff_change";
export const CATEGORIES: Category[] = [...WARNINGS, "improvement", "staff_change"];

export type Verdict = { p: Record<string, number>; labels: string[]; stance: number | null };

const DAY = 86400e3;
export const WINDOW_DAYS = 730;   // "newest" sorts by last edit, so old reviews edited recently arrive too: analyse by publish date
// Display thresholds above the heads' own (80%-recall) cut-offs where precision was low: staff_change is an
// attribute, improvement is positive and its head over-fires on ordinary praise (CV precision 0.55).
const MIN_P: Partial<Record<Category, number>> = { staff_change: 0.6, improvement: 0.5 };
const inWindow = (reviews: TapReview[], asOf: number, days: number) => reviews.filter((r) => r.publishedAt >= asOf - days * DAY && r.publishedAt <= asOf + DAY);

export type Avg = { avg: number | null; n: number };
const avg = (xs: number[]): Avg => ({ avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length });
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** "￥1,000～2,000", "¥1,000–2,000", "E:JPY_1000_TO_2000", "￥10,000 以上" → a yen estimate (bucket midpoint). */
export function priceYen(label: string | null | undefined): number | null {
  if (!label) return null;
  const nums = (label.replace(/,/g, "").match(/\d+/g) ?? []).map(Number).filter((n) => n > 0);
  if (!nums.length) return null;
  if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
  return /以上|PLUS|OVER|\+|–$|～$|-$/.test(label) ? nums[0] * 1.25 : nums[0];
}

/** A reviewer price bucket: 1,000 yen wide, the top one open ("10,000+"). `lo` 0 = under 1,000. */
export type PriceBand = { lo: number; hi: number | null };

/** The bucket a priceYen estimate (a bucket midpoint, or 1.25× an open top bucket) came from. */
export function priceBand(yen: number | null): PriceBand | null {
  if (yen == null) return null;
  if (yen >= 10_000) return { lo: 10_000, hi: null };
  const lo = Math.floor(yen / 1000) * 1000;
  return { lo, hi: lo + 1000 };
}

/** now vs before, compared bucket to bucket (the median is always a bucket midpoint). */
export function bandMove(now: number | null, before: number | null): "up" | "down" | "same" | null {
  const a = priceBand(now), b = priceBand(before);
  if (!a || !b) return null;
  return a.lo > b.lo ? "up" : a.lo < b.lo ? "down" : "same";
}

export const quarterKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`; };
/** First and end (exclusive) instant of a "2026-Q3" key, local time. */
export function quarterSpan(key: string): { from: number; to: number } {
  const y = Number(key.slice(0, 4)), q = Number(key.slice(6));
  return { from: new Date(y, (q - 1) * 3, 1).getTime(), to: new Date(y, q * 3, 1).getTime() };
}

export const monthKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}`; };
/** Calendar months from the month of `from` through the month of `to`, oldest first, as monthKey values. */
export function monthKeys(from: number, to: number): string[] {
  const out: string[] = [];
  const d = new Date(from); d.setDate(1); d.setHours(0, 0, 0, 0);
  for (let i = 0; d.getTime() <= to && i < 600; i++) { out.push(monthKey(d.getTime())); d.setMonth(d.getMonth() + 1); }
  return out;
}

/**
 * The review timeline of the panel: every calendar month of the window ending at `asOf` (oldest first),
 * with the stars of the reviews published in it and how many judged warning signs fall in it (`warnAts`
 * = their publish times). Reviews outside the window are left out, as in `health`.
 */
export function timelineMonths(reviews: Pick<TapReview, "publishedAt" | "stars">[], warnAts: number[], asOf: number, windowDays = WINDOW_DAYS) {
  const from = asOf - windowDays * DAY;
  const keys = monthKeys(from, asOf);
  const at = new Map(keys.map((k, i) => [k, i]));
  const months = keys.map(() => ({ stars: [] as number[], warn: 0 }));
  for (const r of reviews) {
    if (r.publishedAt < from || r.publishedAt > asOf + DAY) continue;
    const i = at.get(monthKey(r.publishedAt));
    if (i != null) months[i].stars.push(r.stars);
  }
  for (const w of warnAts) {
    const i = at.get(monthKey(w));
    if (i != null) months[i].warn++;
  }
  return { keys, months, from };
}

export type Period = { from: number; to: number; days: number };

/**
 * "Now" = the most recent 90 days, widened to 180 / 365 days when fewer than `minNow` reviews fall
 * inside, so quiet stores still get a readable comparison.
 */
export function nowPeriod(reviews: TapReview[], asOf: number, minNow = 10, readTo?: number | null): Period {
  for (const days of [90, 180, 365]) {
    const from = asOf - days * DAY;
    // still loading newest first (`readTo` given): a window the reading has not got through yet is not
    // "quiet", only unread — keep it instead of widening (0 loaded reviews used to show 直近 365 日)
    const unread = readTo !== undefined && (readTo == null || readTo >= from);
    if (unread || reviews.filter((r) => r.publishedAt >= from).length >= minNow || days === 365) return { from, to: asOf, days };
  }
  return { from: asOf - 365 * DAY, to: asOf, days: 365 };
}

export type RatingHealth = {
  now: Avg; before: Avg; all: Avg;
  delta: number | null;                       // now − before
  byQuarter: { key: string; avg: number; n: number }[];
};

export function ratingHealth(reviews: TapReview[], now: Period): RatingHealth {
  const inNow = reviews.filter((r) => r.publishedAt >= now.from);
  const before = reviews.filter((r) => r.publishedAt < now.from);
  const q = new Map<string, number[]>();
  for (const r of reviews) (q.get(quarterKey(r.publishedAt)) ?? q.set(quarterKey(r.publishedAt), []).get(quarterKey(r.publishedAt))!).push(r.stars);
  const a = avg(inNow.map((r) => r.stars)), b = avg(before.map((r) => r.stars));
  return {
    now: a, before: b, all: avg(reviews.map((r) => r.stars)),
    delta: a.avg != null && b.avg != null ? a.avg - b.avg : null,
    byQuarter: [...q].sort(([x], [y]) => (x < y ? -1 : 1)).map(([key, xs]) => ({ key, ...avg(xs) as { avg: number; n: number } })),
  };
}

export type AspectHealth = Record<"food" | "service" | "atmosphere", { now: Avg; before: Avg }>;

export function aspectHealth(reviews: TapReview[], now: Period): AspectHealth {
  const pick = (k: "food" | "service" | "atmosphere") => ({
    now: avg(reviews.filter((r) => r.publishedAt >= now.from && r[k] != null).map((r) => r[k]!)),
    before: avg(reviews.filter((r) => r.publishedAt < now.from && r[k] != null).map((r) => r[k]!)),
  });
  return { food: pick("food"), service: pick("service"), atmosphere: pick("atmosphere") };
}

export type PriceHealth = {
  now: { median: number | null; n: number }; before: { median: number | null; n: number };
  byQuarter: { key: string; median: number; n: number }[];
};

/** Reviewer-reported price per person (41% of reviews carry it). Buckets are 1,000 yen wide, so only big moves show. */
export function priceHealth(reviews: TapReview[], now: Period): PriceHealth {
  const yen = (r: TapReview) => priceYen(r.pricePerPerson ?? r.pricePerPersonLabel);
  const withPrice = reviews.map((r) => ({ r, y: yen(r) })).filter((x): x is { r: TapReview; y: number } => x.y != null);
  const part = (f: (r: TapReview) => boolean) => { const xs = withPrice.filter((x) => f(x.r)).map((x) => x.y); return { median: median(xs), n: xs.length }; };
  const q = new Map<string, number[]>();
  for (const x of withPrice) (q.get(quarterKey(x.r.publishedAt)) ?? q.set(quarterKey(x.r.publishedAt), []).get(quarterKey(x.r.publishedAt))!).push(x.y);
  return {
    now: part((r) => r.publishedAt >= now.from), before: part((r) => r.publishedAt < now.from),
    byQuarter: [...q].sort(([x], [y]) => (x < y ? -1 : 1)).map(([key, xs]) => ({ key, median: median(xs)!, n: xs.length })),
  };
}

export type BurstHealth = {
  flagged: boolean;
  enough: boolean;            // false when the loaded span is too short to know the usual rate
  peak: { from: number; to: number; n: number };
  usualPer30d: number;
  ratio: number;
  newbieShare: number;        // reviewers with ≤ 2 reviews inside the peak
  fiveStarShare: number;      // 5★ inside the peak
  maxPerDay: number;
};

/** The three thresholds of the burst rule (the panel draws them as ticks on each meter). */
export const BURST = { minPeak: 30, minRatio: 2.5, minNewbie: 0.35 } as const;

/**
 * Review-burst rule (no language model): the densest 30 days hold ≥ 30 reviews, ≥ 2.5× the store's
 * usual 30-day rate inside the window, and ≥ 35% of them come from accounts with ≤ 2 reviews (the
 * strongest signal: suspicious stores ≥ 52%, organic ones ≤ 16%). On the 35 labelled stores it
 * fired on 7, all judged suspicious, and on none of the organic ones (tests/health.test.ts).
 */
export function burstHealth(reviews: TapReview[], asOf = Date.now(), windowDays = WINDOW_DAYS): BurstHealth {
  const rs = inWindow(reviews, asOf, windowDays).sort((a, b) => a.publishedAt - b.publishedAt);
  const empty: BurstHealth = { flagged: false, enough: false, peak: { from: 0, to: 0, n: 0 }, usualPer30d: 0, ratio: 0, newbieShare: 0, fiveStarShare: 0, maxPerDay: 0 };
  if (rs.length < 10) return empty;
  const spanDays = Math.max(1, (rs[rs.length - 1].publishedAt - rs[0].publishedAt) / DAY);
  let best = 0, bi = 0, bj = 0, j = 0;
  for (let i = 0; i < rs.length; i++) {
    while (rs[i].publishedAt - rs[j].publishedAt > 30 * DAY) j++;
    if (i - j + 1 > best) { best = i - j + 1; bi = j; bj = i; }
  }
  const peak = rs.slice(bi, bj + 1);
  const rest = rs.length - peak.length;
  const restDays = Math.max(1, spanDays - 30);
  const usual = (rest / restDays) * 30;
  const ratio = best / Math.max(usual, 0.5);
  const share = (f: (r: TapReview) => boolean) => (peak.length ? peak.filter(f).length / peak.length : 0);
  const days = new Map<string, number>();
  for (const r of rs) { const k = new Date(r.publishedAt).toISOString().slice(0, 10); days.set(k, (days.get(k) ?? 0) + 1); }
  const newbieShare = share((r) => (r.reviewer.reviews ?? 0) <= 2);
  const enough = spanDays >= 60;
  return {
    flagged: enough && best >= BURST.minPeak && ratio >= BURST.minRatio && newbieShare >= BURST.minNewbie,
    enough,
    peak: { from: peak[0].publishedAt, to: peak[peak.length - 1].publishedAt, n: best },
    usualPer30d: usual, ratio, newbieShare,
    fiveStarShare: share((r) => r.stars === 5),
    maxPerDay: Math.max(...days.values()),
  };
}

export type ReplyHealth = {
  n: number; rate: number;                 // replies / reviews
  canned: number;                          // share of replies whose text repeats another reply
  mismatched: number;                      // ≤ 2★ reviews thanked for a "high rating"
  lowStarReplied: number; lowStar: number; // reply coverage on ≤ 2★
  medianDelayDays: number | null;
};

export const normReply = (t: string) => t.replace(/\s+/g, "").replace(/[0-9０-９]+/g, "0");
export const HIGH_RATING_THANKS = /高評価|高い評価|星5|★5|5つ星|high rating|5 stars|five stars|5-star|高分|五星/i;

export function replyHealth(reviews: TapReview[]): ReplyHealth {
  const replied = reviews.filter((r) => r.ownerReply);
  const counts = new Map<string, number>();
  for (const r of replied) { const k = normReply(r.ownerReply!.text); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const dup = replied.filter((r) => (counts.get(normReply(r.ownerReply!.text)) ?? 0) > 1).length;
  const low = reviews.filter((r) => r.stars <= 2);
  const lowReplied = low.filter((r) => r.ownerReply);
  const delays = replied.map((r) => (r.ownerReply!.at - r.publishedAt) / DAY).filter((d) => d >= 0);
  return {
    n: replied.length, rate: reviews.length ? replied.length / reviews.length : 0,
    canned: replied.length ? dup / replied.length : 0,
    mismatched: lowReplied.filter((r) => HIGH_RATING_THANKS.test(r.ownerReply!.text)).length,
    lowStarReplied: lowReplied.length, lowStar: low.length,
    medianDelayDays: median(delays),
  };
}

export type WarningItem = { id: string; at: number; stars: number; snippet: string; stance: number | null; p: number; lang: string | null };
export type WarningHealth = Record<Category, { count: number; recent: number; items: WarningItem[] }>;

/** Groups model verdicts by category, newest first; `recent` counts those inside the "now" period. */
export function warningHealth(reviews: TapReview[], verdicts: Map<string, Verdict>, now: Period): WarningHealth {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, { count: 0, recent: 0, items: [] as WarningItem[] }])) as unknown as WarningHealth;
  for (const r of [...reviews].sort((a, b) => b.publishedAt - a.publishedAt)) {
    const v = verdicts.get(r.id);
    if (!v || !r.text) continue;
    for (const c of CATEGORIES) {
      const p = v.p[c] ?? 0;
      const on = MIN_P[c] != null ? p >= MIN_P[c]! : v.labels.includes(c);
      if (!on) continue;
      const g = out[c];
      g.count++;
      if (r.publishedAt >= now.from) g.recent++;
      g.items.push({ id: r.id, at: r.publishedAt, stars: r.stars, snippet: r.text.replace(/\s+/g, " ").slice(0, 120), stance: c === "price" ? v.stance : null, p, lang: r.lang });
    }
  }
  return out;
}

export type Health = {
  n: number; withText: number; asOf: number; span: { from: number; to: number } | null; now: Period;
  rating: RatingHealth; aspects: AspectHealth; price: PriceHealth; burst: BurstHealth; replies: ReplyHealth; warnings: WarningHealth;
  classified: number;          // reviews with a verdict
};

/** Owner-reply problems worth a flag: no reply on low stars, mostly repeated text, thanks for a "high rating" on 1–2★. */
export function replyFlags(r: ReplyHealth) {
  return {
    lowUnanswered: r.lowStar >= 3 && r.lowStarReplied === 0,
    canned: r.n >= 5 && r.canned >= 0.5,
    mismatched: r.mismatched > 0,
  };
}

/** Rating change (stars) the verdict calls a drop or a rise. */
export const VERDICT_DELTA = 0.3;
const MIN_COMPARE = 5;

export type VerdictKind = "burst" | "down" | "up" | "warn" | "steady" | "few";
export type VerdictLevel = "alert" | "caution" | "good" | "none";

/**
 * The one-line answer on top of the panel. A burst outranks everything (the ratings themselves are
 * suspect); then a drop of ≥ 0.3★ now vs before; then ≥ 2 recent warning signs; then a rise; else steady.
 * Fewer than 5 reviews on either side → not enough to compare.
 */
export function verdictOf(h: Health): { kind: VerdictKind; level: VerdictLevel; recent: number } {
  const recent = WARNINGS.reduce((n, c) => n + h.warnings[c].recent, 0);
  if (h.burst.flagged) return { kind: "burst", level: "alert", recent };
  const d = h.rating.delta;
  if (d == null || h.rating.now.n < MIN_COMPARE || h.rating.before.n < MIN_COMPARE) return { kind: "few", level: "none", recent };
  if (d <= -VERDICT_DELTA) return { kind: "down", level: "alert", recent };
  if (recent >= 2) return { kind: "warn", level: "caution", recent };
  if (d >= VERDICT_DELTA) return { kind: "up", level: recent ? "caution" : "good", recent };
  return { kind: "steady", level: recent ? "caution" : "good", recent };
}

/**
 * Everything is computed on reviews published within `windowDays` of `asOf` (default 24 months).
 * `readTo`: pass it while reviews are still loading newest first (how far back reading has got, null
 * before the first sorted page); leave it out once loading is over.
 */
export function health(all: TapReview[], verdicts: Map<string, Verdict>, asOf = Date.now(), windowDays = WINDOW_DAYS, readTo?: number | null): Health {
  const reviews = inWindow(all, asOf, windowDays);
  const now = nowPeriod(reviews, asOf, 10, readTo);
  const ts = reviews.map((r) => r.publishedAt);
  return {
    n: reviews.length, withText: reviews.filter((r) => r.text).length, asOf, span: ts.length ? { from: Math.min(...ts), to: Math.max(...ts) } : null, now,
    rating: ratingHealth(reviews, now), aspects: aspectHealth(reviews, now), price: priceHealth(reviews, now),
    burst: burstHealth(reviews, asOf, windowDays), replies: replyHealth(reviews), warnings: warningHealth(reviews, verdicts, now),
    classified: reviews.filter((r) => verdicts.has(r.id)).length,
  };
}
