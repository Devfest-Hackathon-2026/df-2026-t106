import type { Gate } from "./mapsGate";

/*
 * 問地圖 yields to 「お店の今」: while a review analysis runs (it scrolls the place's review list, so Maps
 * loads review pages, then classifies them), 問地圖's area searches, detail fetches and Nano judgments wait
 * at their next step. A request or Nano prompt already started finishes first. The place page's own
 * checks (lunch chip, attribute chips) never wait.
 */
let holds = 0;
const waiters = new Set<() => void>();
const listeners = new Set<(held: boolean) => void>();

export const askHeld = () => holds > 0;

/** Pauses 問地圖 until the returned release is called (safe to call twice). Holds stack. */
export function holdAsk(): () => void {
  if (++holds === 1) listeners.forEach((l) => l(true));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--holds > 0) return;
    for (const go of [...waiters]) go();
    listeners.forEach((l) => l(false));
  };
}

/** Resolves at once when nothing holds 問地圖, else once the last hold is released. Rejects if `signal` aborts first. */
export function askResumed(signal?: AbortSignal): Promise<void> {
  if (!holds) return Promise.resolve();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const go = () => { waiters.delete(go); signal?.removeEventListener("abort", stop); resolve(); };
    const stop = () => { waiters.delete(go); reject(signal!.reason); };
    waiters.add(go);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** Called with true when 問地圖 pauses and false when it resumes. Returns the unsubscribe. */
export function onAskHold(l: (held: boolean) => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** `gate` (the page-wide Maps gate) for 問地圖: every request first waits out a hold. */
export function pausable(gate: Gate): Gate {
  return {
    get blockedUntil() { return gate.blockedUntil; },
    get waitingUntil() { return gate.waitingUntil; },
    block: (until) => gate.block(until),
    async text(url, signal) {
      await askResumed(signal);
      return gate.text(url, signal);
    },
  };
}
