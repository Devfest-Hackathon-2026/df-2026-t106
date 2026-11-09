import { CHIP_ORDER, isVenue, MODIFIER_ORDER, QUESTIONS, TYPE_ORDER, type QuestionId } from "./questions";
// LanguageModel / LMSession globals are declared in ./nano.d.ts

/*
 * Free text → question templates. The sentence only ever selects templates (questions.ts); it is never
 * passed on as a judging prompt (demo reliability: Nano invents facts on open questions).
 * Shape: 1–2 purposes (一個人, 約會 …) + up to 2 modifiers (安靜, 有氣氛 …): "安靜的約會" = date + quiet.
 * Measured 2026-11-01 on 20 zh/ja/en sentences: one flat list of 20 ids dropped the purpose (17/20);
 * purposes and modifiers as separate fields kept every purpose, but Nano added modifiers the sentence
 * never named (作業 → lively, 蛋糕 → quiet) → cue gate: a modifier stays only if its intentRe matches.
 * Fallback when Nano is unavailable, slow or finds nothing: each template's intentRe.
 * Real-code run 2026-11-01 (scripts/intent-harness.ts, 24 sentences): Nano 21/24, all misses dropped a
 * condition (安靜可以讀書 → quiet only); the keyword rules 23/24 (missed 飲み会). Their union is used.
 * Place type (咖啡廳, 拉麵 …, at most one) comes from the word table only (each type's intentRe), never
 * from Nano. Measured 2026-11-01 (37 sentences): with a `type` field Nano added a type the sentence never
 * named to 9/37 (ラーメン ×4), and after a stricter prompt to 17/37 (it copied the last shot's バー);
 * the table alone 34/37. The table takes the type named last: the head noun ends the phrase (法式甜點).
 */
export const INTENT_NANO = { promptVersion: 3, timeoutMs: 12_000, maxPurposes: 2, maxModifiers: 2 };

/** brunch before lunch (午餐 would also match 早午餐); otherwise chip order. */
const PURPOSES: QuestionId[] = ["brunch", ...CHIP_ORDER];
const MODIFIERS: QuestionId[] = [...MODIFIER_ORDER];
const TYPES: QuestionId[] = [...TYPE_ORDER];

/** The place type the sentence names; when it names several, the one that ends last. */
export function ruleType(text: string): QuestionId | null {
  let best: QuestionId | null = null, end = -1;
  for (const id of TYPES) {
    const re = new RegExp(QUESTIONS[id].intentRe.source, QUESTIONS[id].intentRe.flags.replace("g", "") + "g");
    for (const m of text.matchAll(re)) if (m.index + m[0].length > end) { end = m.index + m[0].length; best = id; }
  }
  return best;
}

/** Modifiers Nano picked, kept only when the sentence names them (their intentRe). */
export const gateModifiers = (text: string, ids: QuestionId[]) => ids.filter((id) => QUESTIONS[id].intentRe.test(text));

export function ruleIntent(text: string): QuestionId[] {
  const purposes: QuestionId[] = [];
  for (const id of PURPOSES) {
    if (purposes.length >= INTENT_NANO.maxPurposes) break;
    if (id === "lunch" && purposes.includes("brunch")) continue;
    if (QUESTIONS[id].intentRe.test(text)) purposes.push(id);
  }
  const type = ruleType(text);
  return [...purposes, ...gateModifiers(text, MODIFIERS).slice(0, INTENT_NANO.maxModifiers), ...(type ? [type] : [])];
}

const SYSTEM = `You map a person's request about places to eat or drink in Japan to 1 or 2 purposes and up to 2 modifiers.
Pick only what the request explicitly asks for; fewer is better.
purposes:
solo: eating alone comfortably (one person, counter seats, not awkward alone)
work: staying a long time to work or study (laptop, reading)
outlet: power outlets to charge a phone or laptop (only when charging, power or outlets are mentioned)
tea: afternoon tea, cakes, parfaits, sweets, a coffee break in the afternoon
chat: sitting and talking with friends, a get-together, a party
date: a date with a partner, anniversary
vegetarian: vegetarian or vegan food, no meat
cashless: paying by card, PayPay, IC card, no cash
lunch: a lunch set (定食, ランチ), a cheap lunch, a lunch budget
brunch: brunch
any: no purpose, only modifiers (e.g. "a quiet cafe")
none: anything else (parking, pets, smoking, a specific cuisine, taste)
modifiers (only if the request says so):
quiet: quiet, calm
mood: nice atmosphere, stylish, romantic
lively: lively, energetic, noisy is fine
view: night view, scenery
private_room: private room (個室, 包廂)
late_night: open late at night
upscale: upscale, fancy, high-end
casual: casual, relaxed`;

type Out = { purposes: string[]; modifiers: string[] };
const SHOTS: [string, Out][] = [
  ["一個人吃不尷尬", { purposes: ["solo"], modifiers: [] }],
  ["安靜的約會", { purposes: ["date"], modifiers: ["quiet"] }],
  ["有插座可以工作兩小時", { purposes: ["outlet", "work"], modifiers: [] }],
  ["有包廂的聚會", { purposes: ["chat"], modifiers: ["private_room"] }],
  ["夜景がきれいなレストラン", { purposes: ["any"], modifiers: ["view"] }],
  ["一人で電源が使えるカフェ", { purposes: ["solo", "outlet"], modifiers: [] }],
  ["静かなデート", { purposes: ["date"], modifiers: ["quiet"] }],
  ["somewhere casual for a lunch set", { purposes: ["lunch"], modifiers: ["casual"] }],
  ["好吃的拉麵", { purposes: ["none"], modifiers: [] }],
];

const IO = { expectedInputs: [{ type: "text", languages: ["ja", "en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };
const SCHEMA = {
  type: "object", required: ["purposes", "modifiers"],
  properties: {
    purposes: { type: "array", minItems: 1, maxItems: INTENT_NANO.maxPurposes, items: { enum: [...PURPOSES, "any", "none"] } },
    modifiers: { type: "array", maxItems: INTENT_NANO.maxModifiers, items: { enum: MODIFIERS } },
  },
};

/** Why the keyword rules answered instead of Nano; the panel words it in the UI language. */
export type IntentNote = { code: "nano-off" | "nano-timeout" } | { code: "nano-error"; message: string };
export type IntentResult = { ids: QuestionId[]; source: "nano" | "rule" | "none"; ms?: number; note?: IntentNote };

/** Nano's raw answer → template ids: real purposes, then the modifiers the sentence names. */
export function toIds(text: string, out: Out): QuestionId[] {
  const picked = [...new Set(out.purposes)].filter((x): x is QuestionId => (PURPOSES as string[]).includes(x)).slice(0, INTENT_NANO.maxPurposes);
  // purposes are gated too, but softer: keep the ones the sentence names; if it names none, Nano's first
  // (panel 2026-11-01: "安靜的約會" came back as chat + date + quiet)
  const cued = picked.filter((id) => QUESTIONS[id].intentRe.test(text));
  const purposes = cued.length ? cued : picked.slice(0, 1);
  const mods = gateModifiers(text, [...new Set(out.modifiers)].filter((x): x is QuestionId => (MODIFIERS as string[]).includes(x))).slice(0, INTENT_NANO.maxModifiers);
  return [...purposes, ...mods];
}

export class IntentNano {
  private base: Promise<LMSession> | null = null;

  static async available() {
    if (typeof LanguageModel === "undefined") return "unavailable" as const;
    return LanguageModel.availability(IO);
  }

  /**
   * Creates the session early (panel open) so the first question does not pay the cold start.
   * `prime`: also answer one throwaway sentence, which loads the model itself (dev-mode preload).
   */
  async warm(prime = false) {
    try {
      await this.session();
      if (prime && !this.primed) { this.primed = true; await this.map("一個人", new AbortController().signal); }
    } catch { this.base = null; this.primed = false; }
  }
  private primed = false;

  private session() {
    return (this.base ??= LanguageModel!.create({
      initialPrompts: [
        { role: "system", content: SYSTEM },
        ...SHOTS.flatMap(([u, o]) => [{ role: "user", content: `Request: ${u}` }, { role: "assistant", content: JSON.stringify(o) }]),
      ],
      ...IO,
    }));
  }

  async map(text: string, signal: AbortSignal): Promise<{ ids: QuestionId[]; ms: number }> {
    const t0 = performance.now();
    const s = await (await this.session()).clone();
    try {
      const raw = await s.prompt(`Request: ${text}`, { responseConstraint: SCHEMA, signal: AbortSignal.any([signal, AbortSignal.timeout(INTENT_NANO.timeoutMs)]) });
      return { ids: toIds(text, JSON.parse(raw) as Out), ms: Math.round(performance.now() - t0) };
    } finally { s.destroy(); }
  }

  destroy() { this.base?.then((s) => s.destroy()).catch(() => {}); this.base = null; }
}

/** The page's one intent session (panel and dev-mode preload share it). */
let sharedIntent: IntentNano | null = null;
export const intentNano = () => (sharedIntent ??= new IntentNano());

/** Nano's ids plus what the keyword rules see (Nano drops conditions more often than the rules invent them). */
export function mergeIds(nano: QuestionId[], rule: QuestionId[]): QuestionId[] {
  const all = [...new Set([...nano, ...rule])];
  const isMod = (id: QuestionId) => (MODIFIERS as string[]).includes(id);
  let purposes = all.filter((id) => !isMod(id) && !isVenue(id));
  if (purposes.includes("brunch")) purposes = purposes.filter((id) => id !== "lunch");
  const type = rule.find(isVenue);
  return [...purposes.slice(0, INTENT_NANO.maxPurposes), ...all.filter(isMod).slice(0, INTENT_NANO.maxModifiers), ...(type ? [type] : [])];
}

/** Nano first; the regex table when Nano is missing, fails, times out or finds nothing the rules can see. */
export async function resolveIntent(text: string, nano: { map: IntentNano["map"] } | null, signal: AbortSignal): Promise<IntentResult> {
  const rule = ruleIntent(text);
  if (!text.trim()) return { ids: [], source: "none" };
  if (!nano) return rule.length ? { ids: rule, source: "rule", note: { code: "nano-off" } } : { ids: [], source: "none" };
  try {
    const { ids, ms } = await nano.map(text, signal);
    if (ids.length) return { ids: mergeIds(ids, rule), source: "nano", ms };
    return rule.length ? { ids: rule, source: "rule", ms } : { ids: [], source: "none", ms };
  } catch (e) {
    if (signal.aborted) throw e;
    const note: IntentNote = (e as Error).name === "TimeoutError" ? { code: "nano-timeout" } : { code: "nano-error", message: (e as Error).message };
    return rule.length ? { ids: rule, source: "rule", note } : { ids: [], source: "none", note };
  }
}
