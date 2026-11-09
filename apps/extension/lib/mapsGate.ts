/*
 * Every request we make to google.com/maps goes through this gate: at most 4 in flight,
 * ≥120 ms between starts, and a rolling budget of 300 starts per 5 min (one search click ≈ 120).
 * If Maps answers 429 or shows its "unusual traffic" page, everything stops for a cool-down
 * instead of retrying.
 */
import { withAccount } from "./account";

export const GATE = { concurrency: 4, minGapMs: 120, coolDownMs: 5 * 60_000, windowMs: 5 * 60_000, windowMax: 300 };

export class BlockedError extends Error {
  /** The panel words it from `until` in the UI language. */
  constructor(public until: number) { super("Google is limiting requests"); this.name = "BlockedError"; }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createGate(opts: { fetch?: Fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; onBlocked?: (until: number) => void } = {}) {
  const doFetch: Fetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let inFlight = 0, lastStart = -Infinity, blockedUntil = 0, waitingUntil = 0;
  const starts: number[] = []; // start times inside the rolling window
  let turn: Promise<void> = Promise.resolve(); // starts are handed out one at a time, in call order
  const waiters: (() => void)[] = [];

  const isBlocked = (res: Response) => res.status === 429 || /\/sorry\//.test(res.url);

  async function acquire(signal?: AbortSignal) {
    while (inFlight >= GATE.concurrency) await new Promise<void>((r) => waiters.push(r));
    inFlight++;
    const prev = turn;
    let done!: () => void;
    turn = new Promise<void>((r) => { done = r; });
    try {
      await prev;
      while (starts.length && starts[0] <= now() - GATE.windowMs) starts.shift();
      if (starts.length >= GATE.windowMax) {
        waitingUntil = starts[starts.length - GATE.windowMax] + GATE.windowMs;
        await sleep(waitingUntil - now());
        waitingUntil = 0;
        while (starts.length && starts[0] <= now() - GATE.windowMs) starts.shift();
      }
      const wait = lastStart + GATE.minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      starts.push(lastStart);
    } finally { done(); }
    if (signal?.aborted) { release(); signal.throwIfAborted(); }
  }
  function release() { inFlight--; waiters.shift()?.(); }

  return {
    get blockedUntil() { return blockedUntil; },
    /** >0 while requests are paused by the rolling budget (UI: "稍等"). */
    get waitingUntil() { return waitingUntil; },
    /** Mark blocked from outside (e.g. remembered from an earlier page load). */
    block(until: number) { blockedUntil = Math.max(blockedUntil, until); },
    async text(url: string, signal?: AbortSignal): Promise<string> {
      if (now() < blockedUntil) throw new BlockedError(blockedUntil);
      await acquire(signal);
      try {
        if (now() < blockedUntil) throw new BlockedError(blockedUntil);
        const res = await doFetch(withAccount(url), { signal }); // keep the user's Google account
        if (isBlocked(res)) {
          blockedUntil = now() + GATE.coolDownMs;
          opts.onBlocked?.(blockedUntil);
          throw new BlockedError(blockedUntil);
        }
        return await res.text();
      } finally { release(); }
    },
  };
}

export type Gate = ReturnType<typeof createGate>;

const BLOCK_KEY = "mapsBlockedUntil";
/** The shared page-wide gate; remembers a block across reloads via storage.local when available. */
export const mapsGate: Gate = createGate({
  onBlocked: (until) => { try { browser?.storage?.local.set({ [BLOCK_KEY]: until }); } catch { /* harness: no extension APIs */ } },
});
try {
  browser?.storage?.local.get(BLOCK_KEY).then((v) => { if (typeof v[BLOCK_KEY] === "number") mapsGate.block(v[BLOCK_KEY]); });
} catch { /* harness */ }
