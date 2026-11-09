import { LUNCH_NANO } from "./nanoLunch";
import type { Verdict } from "./lunch";
import type { LunchPrice, PriceSource } from "./lunchPrice";
import { isShareable, QUESTIONS, type QuestionId } from "./questions";

/*
 * Where verdicts are remembered.
 *  - local:  this browser only (cache, 14 days).
 *  - shared: our cloud (services/classify). A vote goes to `POST /report`; the server keeps votes private
 *            (one per question, place and user) and publishes a uid-free tally per place (majority
 *            verdict + median ¥), which is all a client can read (Firestore `tallies`).
 *            Part of 拡張機能 (lib/advanced.ts): off by default, and while off it neither reads
 *            nor writes. Only OUR judgment is ever shared (verdict, source, cheapest ¥), never Maps
 *            text (menu names, posts, reviews) or any position — evidence is re-read from Maps when shown.
 */
export const LUNCH_VERSION = `r6n${LUNCH_NANO.promptVersion}`; // bump r when rules change: old cached verdicts are ignored
const TTL_MS = 14 * 24 * 3600_000;

/** Local record. evidence/pos/item name stay in this browser; toReport() drops them. `reports`: how many people agreed (shared only). */
export type StoredVerdict = { verdict: Verdict; source?: string; evidence?: string; lat?: number; lng?: number; price?: LunchPrice; at: number; v: string; reports?: number };
/** The only shape that may leave the browser (checked again by `Vote` in services/classify/main.py). `key` = `${meal}~${fid}`. */
export type SharedVerdict = "menu" | "likely" | "none" | "closed";
export type Report = {
  key: string; meal: string; fid: string; verdict: SharedVerdict; v: string;
  source?: string; yen?: number; yenSource?: PriceSource;
};
/** Firestore `tallies/{key}~{v}`, written only by the server: everyone's votes for one place, without who voted. */
export type Tally = {
  key: string; meal: string; fid: string; v: string; verdict: SharedVerdict;
  agree: number; total: number; at: number; source?: string; yen?: number; yenSource?: PriceSource;
};

export interface LunchStore {
  get(fids: string[]): Promise<Map<string, StoredVerdict>>;
  put(entries: [string, StoredVerdict][]): Promise<void>;
}

/** Results worth remembering; errors/timeouts are retried next time. */
export const cacheable = (v: Verdict) => v !== "error";

type KV = { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
const key = (meal: string, fid: string) => `${meal}:${LUNCH_VERSION}:${fid}`;

/** `store`, except that while `off()` (dev 「キャッシュなし」, lib/noCache.ts) it reads nothing and writes nothing. Asked at every call. */
export function gatedStore(store: LunchStore, off: () => boolean): LunchStore {
  return {
    get: (fids) => (off() ? Promise.resolve(new Map()) : store.get(fids)),
    put: (entries) => (off() ? Promise.resolve() : store.put(entries)),
  };
}

export function localLunchStore(kv: KV, now = () => Date.now(), meal = "lunch"): LunchStore {
  return {
    async get(fids) {
      const got = await kv.get(fids.map((f) => key(meal, f)));
      const out = new Map<string, StoredVerdict>();
      for (const fid of fids) {
        const v = got[key(meal, fid)] as StoredVerdict | undefined;
        if (v && v.v === LUNCH_VERSION && now() - v.at < TTL_MS) out.set(fid, v);
      }
      return out;
    },
    async put(entries) {
      const ok = entries.filter(([, v]) => cacheable(v.verdict));
      if (ok.length) await kv.set(Object.fromEntries(ok.map(([fid, v]) => [key(meal, fid), v])));
    },
  };
}

const SHARED_TTL_MS = 30 * 24 * 3600_000;
const isShared = (v: Verdict): v is SharedVerdict => v === "menu" || v === "likely" || v === "none" || v === "closed";

export function toReport(fid: string, v: StoredVerdict, meal = "lunch"): Report | null {
  if (!isShared(v.verdict) || !isShareable(meal)) return null;
  // 問地圖 questions share only what Nano read in a review; attributes/categories are Maps' own data
  if (QUESTIONS[meal as QuestionId]?.kind === "ask" && v.source !== "review") return null;
  const r: Report = { key: `${meal}~${fid}`, meal, fid, verdict: v.verdict, v: v.v };
  if (v.source) r.source = v.source;
  if (v.price && (v.verdict === "menu" || v.verdict === "likely")) { r.yen = v.price.yen; r.yenSource = v.price.source; }
  return r;
}

/**
 * A shared tally counts only when at least MIN_AGREE people agree (one anonymous vote is too easy to
 * fake), it was made under this LUNCH_VERSION, and its newest agreeing vote is under 30 days old.
 * Otherwise the place is judged on this machine, and that judgment becomes one more vote.
 */
export const MIN_AGREE = 2;
export function fromTally(t: Tally, now = Date.now()): StoredVerdict | null {
  if (t.v !== LUNCH_VERSION || now - t.at >= SHARED_TTL_MS || t.agree < MIN_AGREE) return null;
  const price: LunchPrice | undefined = t.yen != null ? { yen: t.yen, item: "", source: t.yenSource ?? "menu", items: 0 } : undefined;
  return { verdict: t.verdict, source: t.source, price, at: t.at, v: LUNCH_VERSION, reports: t.agree };
}

/** The background owns Firebase; content scripts reach it through this. */
export interface SharedRemote {
  read(keys: string[]): Promise<Tally[]>;
  write(reports: Report[]): Promise<void>;
}

/** `enabled` = the 拡張機能 switch, asked at every call: while it is off the store reads and writes nothing. */
export function sharedLunchStore(opts: { remote: SharedRemote; enabled: () => boolean; log?: (...a: unknown[]) => void; meal?: string; now?: () => number }): LunchStore {
  const meal = opts.meal ?? "lunch";
  return {
    async get(fids) {
      const out = new Map<string, StoredVerdict>();
      if (!fids.length || !opts.enabled()) return out;
      for (const t of await opts.remote.read(fids.map((f) => `${meal}~${f}`))) {
        const m = fromTally(t, opts.now?.());
        if (m) out.set(t.fid, m);
      }
      return out;
    },
    async put(entries) {
      if (!opts.enabled()) return;
      const rows = entries.flatMap(([fid, v]) => toReport(fid, v, meal) ?? []);
      if (!rows.length) return;
      await opts.remote.write(rows).catch((e) => opts.log?.("shared write failed", (e as Error).message));
    },
  };
}
