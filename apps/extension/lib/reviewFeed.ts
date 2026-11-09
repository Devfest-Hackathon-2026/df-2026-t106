import { openReviewsSortedNewest, scrollReviews } from "./scraper";
import { TAP_MESSAGE, type TapMessage, type TapReview } from "./reviewTap";

/*
 * Isolated-world side of the passive review source: collects what the MAIN-world tap posts
 * (lib/reviewTap.ts), keyed by review id, and drives the Maps review list so more pages load.
 */

const store = new Map<string, TapReview>();
const listeners = new Set<() => void>();
let lastBatch: TapReview[] = [];   // the most recent page Maps loaded
let batchSeq = 0;                  // pages received so far (tells pages after the sort switch apart)
let installed = false;

export function startFeed() {
  if (installed) return;
  installed = true;
  window.addEventListener("message", (e: MessageEvent<TapMessage>) => {
    if (e.source !== window || e.data?.type !== TAP_MESSAGE) return;
    for (const r of e.data.reviews) store.set(r.id, r);
    lastBatch = e.data.reviews;
    batchSeq++;
    listeners.forEach((l) => l());
  });
}

/**
 * Current place's cid from the URL (…!1s0x…:0x<cid>…). Opening a place from another place's page keeps
 * the previous one in a nested data block, so the current place is the LAST id in the URL.
 */
export function placeCid(url = location.href): string | null {
  const m = [...url.matchAll(/!1s0x[0-9a-f]+:0x([0-9a-f]+)/gi)].pop();
  return m ? m[1].toLowerCase() : null;
}

/** Reviews seen for one place, newest edit first. */
export function reviewsFor(cid: string | null): TapReview[] {
  return [...store.values()].filter((r) => !cid || !r.cid || r.cid === cid).sort((a, b) => b.editedAt - a.editedAt);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CollectStatus = "opening" | "loading" | "window" | "all" | "max";
export type CollectEvents = {
  /** `reachedAt`: the oldest last-edit time among pages loaded after the sort switch, i.e. how far back the newest-first reading has got (undefined before the first sorted page). */
  onUpdate: (reviews: TapReview[], status: CollectStatus, reachedAt?: number) => void;
};

/**
 * Opens the reviews tab sorted by newest and scrolls until the list reaches `maxMonths` back
 * (by last-edit time, which is what "newest" sorts by), `maxN` reviews, or stops growing.
 * The place page already loaded a "relevance" batch (old reviews included) before the sort
 * switch; it is kept for analysis but never decides when to stop: pages arrive newest first
 * after the switch, so the stop test looks only at the most recent page — and only once a page
 * has arrived after the click. (Testing the relevance page stopped busy stores after ~19 reviews
 * whenever the sorted page took longer than the 2 s wait.)
 */
export async function collectReviews({ maxMonths, maxN, signal, onUpdate }: CollectEvents & { maxMonths: number; maxN: number; signal: AbortSignal }) {
  startFeed();
  const cid = placeCid();
  const cutoff = Date.now() - maxMonths * 30.4 * 86400e3;
  onUpdate(reviewsFor(cid), "opening");
  let sortedFrom = Infinity;
  await openReviewsSortedNewest(() => { sortedFrom = batchSeq; });
  let seen = -1, stale = 0, reached = Infinity;
  while (!signal.aborted) {
    const cur = reviewsFor(cid);
    stale = cur.length > seen ? 0 : stale + 1;
    seen = cur.length;
    const page = batchSeq > sortedFrom ? lastBatch.filter((r) => !cid || !r.cid || r.cid === cid) : [];
    const oldest = page.length ? Math.min(...page.map((r) => r.editedAt)) : Infinity;
    reached = Math.min(reached, oldest);
    const at = Number.isFinite(reached) ? reached : undefined;
    if (cur.length >= maxN) return onUpdate(cur, "max", at);
    if (oldest < cutoff) return onUpdate(cur, "window", at);
    if (stale > 8) return onUpdate(cur, "all", at);
    onUpdate(cur, "loading", at);
    scrollReviews();
    await sleep(650);
  }
}
