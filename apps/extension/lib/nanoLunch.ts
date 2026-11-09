import { hoursSummary, type LunchFacts } from "./lunch";
import { LUNCH, type MealSpec } from "./meals";
import type { AskSpec } from "./questions";
// LanguageModel / LMSession globals are declared in ./nano.d.ts

/*
 * Tier-B judge: one store per prompt, answer + a quote copied from the evidence.
 * Measured 2026-10-30: 8/8 sensible answers, 4–11 s each, and the queue once stalled
 * (background tab) — so every prompt has a timeout and only ambiguous stores reach here.
 * Two deterministic gates on a "yes" (2026-10-30 run on 池袋 ランチ: Nano spliced quotes twice and
 * said yes to pure marketing "ランチからお酒を囲んだお集まりまで"):
 *   1. the quote must appear in the input (no invented evidence)
 *   2. the quote must name something concrete — a lunch set/menu word, a dish or a price
 */
export const LUNCH_NANO = { promptVersion: 2, timeoutMs: 25_000, firstTimeoutMs: 60_000 };

/** What LunchNano can judge: a meal (owner text + reviews) or a question with a review snippet. */
export type NanoSpec = MealSpec | (AskSpec & { snippet: NonNullable<AskSpec["snippet"]> });
export const nanoOf = (s: NanoSpec) => (s.kind === "meal" ? s.nano : s.snippet.nano);

/** Gate 2: the meal is mentioned together with what is actually served; for a snippet, the quote keeps the keyword. */
export const concrete = (meal: NanoSpec, quote: string) =>
  meal.kind === "ask" ? meal.snippet.keyword.test(quote) : meal.re.test(quote) && (meal.menuWord.test(quote) || meal.dish.test(quote));
export const concreteLunch = (quote: string) => concrete(LUNCH, quote);

const SCHEMA = {
  type: "object", required: ["answer", "quote"],
  properties: { answer: { enum: ["yes", "no", "unsure"] }, quote: { type: "string", maxLength: 80 } },
};
const IO = { expectedInputs: [{ type: "text", languages: ["ja", "en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };

export type NanoAnswer = { answer: "yes" | "no" | "unsure"; quote: string; ms: number; downgraded?: "quote-not-in-input" | "vague" };

export function lunchPrompt(f: LunchFacts, owner: string[], reviews: string[], spec: NanoSpec = LUNCH) {
  // one review sentence per prompt (measured 4–6 s; whole review sets took 8–18 s and invented quotes)
  if (spec.kind === "ask") return [`Store: ${f.name}`, `Category: ${f.categories.slice(0, 3).join(", ") || "-"}`, `Review: ${reviews[0] ?? "-"}`].join("\n");
  return [
    `Store: ${f.name}`,
    `Category: ${f.categories.slice(0, 3).join(", ") || "-"}`,
    `Hours: ${hoursSummary(f) || "-"}`,
    `Owner text: ${owner.join(" / ") || "-"}`,
    `Customer reviews: ${reviews.join(" / ") || "-"}`,
  ].join("\n");
}

const norm = (s: string) => s.replace(/\s+/g, "").replace(/[「」『』"“”]/g, "");
/** True when the model's quote really appears in what we gave it. */
export function quoteInInput(quote: string, input: string) {
  const q = norm(quote);
  return q.length >= 4 && norm(input).includes(q.slice(0, Math.min(q.length, 24)));
}

/** Applies both gates to a raw model answer. */
export function gate(out: { answer: NanoAnswer["answer"]; quote: string }, input: string, ms: number, meal: NanoSpec = LUNCH): NanoAnswer {
  if (out.answer !== "yes") return { ...out, ms };
  if (!quoteInInput(out.quote, input)) return { answer: "unsure", quote: out.quote, ms, downgraded: "quote-not-in-input" };
  if (!concrete(meal, out.quote)) return { answer: "unsure", quote: out.quote, ms, downgraded: "vague" };
  return { ...out, ms };
}

/**
 * One Gemini Nano prompt at a time for the whole page. Measured 2026-11-01 in the panel: three questions
 * (three sessions) prompting at once took 10–14 s per answer instead of 2–4 s, and every place was judged
 * by all three even after one said no. In one queue, a place's turn re-checks the other questions first.
 */
let nanoChain: Promise<void> = Promise.resolve();
export function nanoTurn(): Promise<() => void> {
  let release!: () => void;
  const prev = nanoChain;
  nanoChain = new Promise<void>((r) => { release = r; });
  return prev.then(() => release);
}

/** One judge per question for the whole page, so a preload (dev mode) and the scanners share sessions. */
const judges = new Map<string, LunchNano>();
export function lunchNanoFor(spec: NanoSpec): LunchNano {
  let n = judges.get(spec.id);
  if (!n) judges.set(spec.id, (n = new LunchNano(spec)));
  return n;
}

export class LunchNano {
  private base: Promise<LMSession> | null = null;
  private used = false;
  constructor(private meal: NanoSpec = LUNCH) {}

  /** Creates the session (system prompt + shots) ahead of the first place, in the page-wide Nano queue. */
  get ready() { return !!this.base; }

  async warm() {
    if (this.base) return;
    const release = await nanoTurn();
    try { await this.session(); } catch { this.base = null; } finally { release(); }
  }

  static async available() {
    if (typeof LanguageModel === "undefined") return "unavailable" as const;
    return LanguageModel.availability(IO);
  }

  private session() {
    return (this.base ??= LanguageModel!.create({
      initialPrompts: [
        { role: "system", content: nanoOf(this.meal).system },
        ...nanoOf(this.meal).shots.flatMap(([u, a]) => [{ role: "user", content: u }, { role: "assistant", content: JSON.stringify(a) }]),
      ],
      ...IO,
    }));
  }

  async judge(f: LunchFacts, owner: string[], reviews: string[], signal: AbortSignal): Promise<NanoAnswer> {
    const input = lunchPrompt(f, owner, reviews, this.meal);
    const t0 = performance.now();
    const s = await (await this.session()).clone();
    try {
      // a session's first answer includes the cold start (panel 2026-11-01: one timed out at 25 s)
      const limit = this.used ? LUNCH_NANO.timeoutMs : LUNCH_NANO.firstTimeoutMs;
      const raw = await s.prompt(input, { responseConstraint: SCHEMA, signal: AbortSignal.any([signal, AbortSignal.timeout(limit)]) });
      this.used = true;
      const out = JSON.parse(raw) as { answer: NanoAnswer["answer"]; quote: string };
      const ms = Math.round(performance.now() - t0);
      return gate(out, input, ms, this.meal);
    } finally { s.destroy(); }
  }

  destroy() { this.base?.then((s) => s.destroy()).catch(() => {}); this.base = null; }
}
