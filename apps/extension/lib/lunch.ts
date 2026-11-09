import { coordsOf, PLACE, snippetOf, walk, type LatLng, type RawPlace } from "./mapsData";
import { LUNCH, namesMeal, type MealSpec } from "./meals";
import { FOOD_PLACE, type AskSpec, type AttrMatch, type QuestionSpec } from "./questions";
import type { MenuRow } from "./lunchPrice";

/*
 * "Has a dedicated lunch menu" from Maps data only (no Places API, no third-party sites).
 * Measured on 113 Ikebukuro places (fixtures/lunch-research-ikebukuro.json):
 *   tier A  menu section/item or owner-set "ランチ" hours → 24/24 correct, deterministic
 *   tier B  only owner posts / description / featured reviews mention lunch → noisy
 *           (SEO hashtags, 昼飲み, ランチ貸切, ramen "ランチ帯も営業") → Gemini Nano decides
 * The serves_lunch attribute ("ランチメニューあり") is set on 78/113 incl. dinner-only izakaya — ignored.
 */

// ランチ but not アランチーニ / フランチャコルタ / ブランチ / ランチャー (spec in meals.ts; brunch reuses this file)
export const LUNCH_RE = LUNCH.re;

export type Range = [number, number]; // minutes from midnight; end may exceed 1440
export type DayHours = { day: string; ranges: Range[] };
export type LunchFacts = {
  fid: string; name: string; categories: string[]; pos: LatLng | null;
  hours: DayHours[]; moreHours: { type: string; days: DayHours[] }[];
  menuSections: string[]; menuItems: string[]; menuRows: MenuRow[];
  ownerText: string[]; reviewText: string[];
  /** Maps attributes ([100]); yes = null when the entry carries no 0/1 flag */
  attrs: PlaceAttr[];
  /** review quotes Maps attached to search hits ([142], search records only) */
  snippets: string[];
};

export type PlaceAttr = { id: string; label: string; yes: boolean | null };

/**
 * Attribute entries look like ['/geo/type/establishment_poi/serves_lunch', 'ランチ', [1, [[1|0, …]]], …]
 * (hl=ja labels; 1 = yes, 0 = no). Kept by id, first occurrence wins.
 */
export function parseAttrs(node: unknown): PlaceAttr[] {
  const out = new Map<string, PlaceAttr>();
  walk(node, (n) => {
    if (typeof n[0] !== "string" || !n[0].startsWith("/geo/type/") || typeof n[1] !== "string") return;
    const id = n[0].slice(n[0].lastIndexOf("/") + 1);
    const flag = n[2]?.[1]?.[0]?.[0];
    if (!out.has(id)) out.set(id, { id, label: n[1], yes: flag === 1 ? true : flag === 0 ? false : null });
  });
  return [...out.values()];
}
export const matchAttr = (m: AttrMatch, a: PlaceAttr) => (m.id ? a.id === m.id : false) || m.label.test(a.label);

const strings = (n: unknown): string[] => {
  const out: string[] = [];
  walk(n, (a) => a.forEach((c) => typeof c === "string" && out.push(c)));
  return out;
};

// Maps drops zero fields: "0時00分" is [] and "0時30分" is [null, 30] (live 2026-10-31: 15/36 izakaya "11時00分～0時00分")
const toMin = (t: unknown) => (Array.isArray(t) ? ((t[0] as number) ?? 0) * 60 + ((t[1] as number) ?? 0) : null);

/** Day rows look like [dayName, n, [y,m,d], [[label, [[h,m],[h,m]]], …], …]; closed days have no time pair. */
export function parseDays(rows: unknown): DayHours[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(Array.isArray).map((d) => {
    const ranges: Range[] = [];
    for (const seg of Array.isArray(d[3]) ? d[3] : []) {
      const s = toMin(seg?.[1]?.[0]), e = toMin(seg?.[1]?.[1]);
      if (s == null || e == null) continue;
      ranges.push([s, e <= s ? e + 1440 : e]);
    }
    return { day: String(d[0] ?? ""), ranges };
  });
}

const isItem = (n: any[]) => Array.isArray(n[0]) && typeof n[0][0] === "string" && Array.isArray(n[1]) && typeof n[1][0] === "string";

function menu(p: RawPlace) {
  const sections: string[] = [], items: string[] = [], rows: MenuRow[] = [];
  walk(p[PLACE.menu], (n) => {
    // section: [[name], [[item, item, …]]]
    if (n.length === 2 && Array.isArray(n[0]) && n[0].length === 1 && typeof n[0][0] === "string" && Array.isArray(n[1])) {
      sections.push(n[0][0]);
      walk(n[1], (it) => { if (isItem(it)) rows.push({ sec: n[0][0], name: it[0][0], price: it[1][0] }); });
    }
    // item: [[name, desc], ["¥price"], …]
    if (isItem(n) && /[¥￥]/.test(n[1][0])) items.push(n[0][0]);
  });
  return { sections, items, rows };
}

export function extractFacts(p: RawPlace): LunchFacts {
  const { sections, items, rows } = menu(p);
  const more = Array.isArray(p[PLACE.moreHours]) ? p[PLACE.moreHours] : [];
  return {
    fid: String(p[PLACE.fid] ?? ""),
    name: String(p[PLACE.name] ?? ""),
    pos: coordsOf(p),
    categories: Array.isArray(p[PLACE.categories]) ? p[PLACE.categories].filter((c: unknown) => typeof c === "string") : [],
    hours: parseDays(p[PLACE.hours]?.[0]),
    moreHours: more.filter((h: any) => typeof h?.[0] === "string").map((h: any) => ({ type: h[0], days: parseDays(h[3]?.[0]) })),
    menuSections: sections,
    menuItems: items,
    menuRows: rows,
    ownerText: [...strings(p[PLACE.posts]), ...strings(p[PLACE.description])],
    reviewText: strings(p[PLACE.reviews]).filter((s) => s.length > 15),
    attrs: parseAttrs(p[PLACE.attrs]),
    snippets: [snippetOf(p)].filter((s): s is string => !!s),
  };
}

const fmt = (m: number) => `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, "0")}`;
export const fmtRange = ([s, e]: Range) => `${fmt(s)}–${fmt(e)}`;

/** Open at some point inside the meal's window (lunch 11–14) on at least one day. Unknown hours count as open. */
export function opensDuring(f: LunchFacts, meal: { window: [number, number] } = LUNCH) {
  const [from, to] = meal.window;
  const all = [...f.hours, ...f.moreHours.flatMap((h) => h.days)];
  if (!all.some((d) => d.ranges.length)) return true;
  return all.some((d) => d.ranges.some(([s, e]) => s < to && e > from));
}
export const opensAtMidday = (f: LunchFacts) => opensDuring(f, LUNCH);

export type Evidence = { source: "menu" | "hours" | "owner" | "review" | "attr" | "category"; text: string };

/** Owners rename a shut place instead of Maps marking it closed: "【閉店】京の里久 池袋店". */
export const SHUT_NAME = /[【\[［(（]\s*(?:閉店|閉業|閉鎖|移転)\s*[】\]］)）]/;

/** Tier A: the owner's own structured data names the meal. */
export function tierA(f: LunchFacts, meal: MealSpec = LUNCH): Evidence | null {
  const sec = f.menuSections.find((s) => namesMeal(meal, s));
  if (sec) return { source: "menu", text: sec };
  const item = f.menuItems.find((s) => namesMeal(meal, s));
  if (item) return { source: "menu", text: item };
  // owner-set meal hours count only as a real window: 博多酒場 よかよい。 sets ランチ = ディナー =
  // 12:00–23:15 with no lunch menu, so some day's window must end by meal.hoursEndBy.
  for (const h of f.moreHours.filter((x) => meal.re.test(x.type))) {
    const r = h.days.flatMap((d) => d.ranges).find(([, e]) => e <= meal.hoursEndBy);
    if (r) return { source: "hours", text: `${h.type} ${fmtRange(r)}` };
  }
  return null;
}

/** Short windows around each lunch mention, deduped (translations and owner replies repeat a lot). */
export function snippets(texts: string[], max: number, radius = 60, mention: RegExp = LUNCH_RE): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    const flat = t.replace(/\s+/g, " ");
    const m = flat.match(mention);
    if (!m || m.index == null) continue;
    const s = flat.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius).trim();
    const key = s.slice(0, 30);
    if (seen.has(key)) continue;
    seen.add(key); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export type Verdict = "menu" | "likely" | "none" | "closed" | "unsure" | "error";
export type RuleOutcome =
  | { verdict: Verdict; evidence?: Evidence }
  | { verdict: "nano"; owner: string[]; reviews: string[] };

/**
 * A non-meal question (questions.ts) from Maps data only:
 * closed → attr yes → attr no → category → attr likely → review snippet (Nano) → explicit attr "no" → unsure.
 */
export function askVerdict(f: LunchFacts, spec: AskSpec): RuleOutcome {
  if (SHUT_NAME.test(f.name)) return { verdict: "closed" };
  if (f.categories.length && !f.categories.some((c) => FOOD_PLACE.test(c))) return { verdict: "none", evidence: { source: "category", text: f.categories[0] } };
  if (spec.venue) {
    // a place type is a hard requirement: any of the place's categories
    const cat = f.categories.find((c) => spec.category!.test(c));
    if (cat) return { verdict: "menu", evidence: { source: "category", text: cat } };
    return f.categories.length ? { verdict: "none", evidence: { source: "category", text: f.categories[0] } } : { verdict: "unsure" };
  }
  const knownHours = f.hours.some((d) => d.ranges.length);
  if (spec.window && knownHours && !opensDuring(f, { window: spec.window })) return { verdict: "closed" };
  // `not` entries match the opposite flag (feels_quiet 0 counts for 熱鬧)
  const find = (ms: AttrMatch[] | undefined, want: boolean) => ms && f.attrs.find((x) => ms.some((m) => matchAttr(m, x) && x.yes === (m.not ? !want : want)));
  const attr = (x: PlaceAttr): Evidence => ({ source: "attr", text: x.label });
  const yes = find(spec.attrs?.yes, true);
  if (yes) return { verdict: "menu", evidence: attr(yes) };
  const no = find(spec.attrs?.no, true);
  if (no) return { verdict: "none", evidence: attr(no) };
  if (spec.lateAfter && knownHours) {
    const late = f.hours.flatMap((d) => d.ranges.map((r) => ({ d, r }))).find(({ r }) => r[1] > spec.lateAfter!);
    if (late) return { verdict: "likely", evidence: { source: "hours", text: `${DAY_SHORT[late.d.day] ?? late.d.day} ${fmtRange(late.r)}` } };
  }
  const cat = spec.category && f.categories.find((c) => spec.category!.test(c));
  if (cat) return { verdict: "menu", evidence: { source: "category", text: cat } };
  const likely = find(spec.attrs?.likely, true);
  if (likely) return { verdict: "likely", evidence: attr(likely) };
  const quote = spec.snippet && f.snippets.find((s) => spec.snippet!.keyword.test(s));
  if (quote) return { verdict: "nano", owner: [], reviews: [quote] };
  const denied = find(spec.attrs?.yes, false);
  if (denied) return { verdict: "none", evidence: attr(denied) };
  if (spec.lateAfter && knownHours) return { verdict: "none" }; // closes earlier every day
  return { verdict: "unsure" };
}

/** Everything decidable without a model. "nano" = tier B, needs judgment. */
export function ruleVerdict(f: LunchFacts, spec: QuestionSpec = LUNCH): RuleOutcome {
  if (spec.kind === "ask") return askVerdict(f, spec);
  const meal = spec;
  if (SHUT_NAME.test(f.name)) return { verdict: "closed" };
  const a = tierA(f, meal);
  if (a) return { verdict: "menu", evidence: a };
  if (!opensDuring(f, meal)) return { verdict: "closed" };
  const owner = snippets(f.ownerText, 4, 60, meal.re), reviews = snippets(f.reviewText, 3, 60, meal.re);
  if (!owner.length && !reviews.length) return { verdict: "none" };
  return { verdict: "nano", owner, reviews };
}

/**
 * Verdicts the light search record (hours + secondary hours, no menu/posts) can give without a detail
 * fetch: owner-set meal hours → menu; not open in the meal window → closed. Otherwise null.
 */
export function quickVerdict(f: LunchFacts, spec: QuestionSpec = LUNCH): { verdict: Verdict; evidence?: Evidence } | null {
  if (spec.kind === "ask") { const out = askVerdict(f, spec); return out.verdict === "nano" ? null : out; }
  const meal = spec;
  if (SHUT_NAME.test(f.name)) return { verdict: "closed" };
  const a = tierA(f, meal);
  if (a) return { verdict: "menu", evidence: a };
  if (f.hours.some((d) => d.ranges.length) && !opensDuring(f, meal)) return { verdict: "closed" };
  return null;
}

const DAY_SHORT: Record<string, string> = { 月曜日: "月", 火曜日: "火", 水曜日: "水", 木曜日: "木", 金曜日: "金", 土曜日: "土", 日曜日: "日" };
export const hoursSummary = (f: LunchFacts) =>
  f.hours.map((d) => `${DAY_SHORT[d.day] ?? d.day} ${d.ranges.length ? d.ranges.map(fmtRange).join(",") : "休"}`).join(" / ");
