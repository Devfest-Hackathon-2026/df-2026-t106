import type { Report, SharedRemote, Tally } from "./lunchStore";
import { httpError, SERVICE_URL } from "./classifyRemote";

/** Runtime messages between content scripts and the background (which owns Firebase and the ID token). */
export type SharedMsg = { type: "shared:read"; keys: string[] } | { type: "shared:write"; reports: Report[] };
type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

async function send<T>(msg: SharedMsg): Promise<T> {
  const r = (await browser.runtime.sendMessage(msg)) as Reply<T> | undefined;
  if (!r) throw new Error("background did not answer");
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export const messageRemote: SharedRemote = {
  read: (keys) => send<Tally[]>({ type: "shared:read", keys }),
  write: (reports) => send<void>({ type: "shared:write", reports }),
};

export const REPORT_URL = `${SERVICE_URL}/report`;
const REPORT_MAX = 50; // = MAX_REPORTS in services/classify/main.py

/** Votes to our service (`POST /report`, Firebase ID token). The server keeps them private and publishes only tallies. */
export function postReports(idToken: () => Promise<string>, url = REPORT_URL, doFetch: typeof fetch = fetch) {
  return async (reports: Report[]) => {
    const token = await idToken();
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ reports }),
    });
    if (!res.ok) throw new Error(httpError(res.status));
  };
}

/**
 * A scan finishes places one by one, and each finish shares one vote. The background collects them and
 * sends one request per `delayMs` (or as soon as `max` are waiting) instead of one per place. A newer
 * vote for the same place replaces the waiting one. `add` resolves once queued; send errors go to `onError`.
 */
export function createReportQueue(opts: {
  post: (reports: Report[]) => Promise<void>;
  delayMs?: number; max?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  onError?: (e: Error) => void;
}) {
  const delayMs = opts.delayMs ?? 1500, max = Math.min(opts.max ?? REPORT_MAX, REPORT_MAX);
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  let waiting = new Map<string, Report>();
  let timer = false;

  const flush = () => {
    timer = false;
    const all = [...waiting.values()];
    waiting = new Map();
    for (let i = 0; i < all.length; i += max) opts.post(all.slice(i, i + max)).catch((e: Error) => opts.onError?.(e));
  };
  return {
    async add(reports: Report[]) {
      for (const r of reports) { waiting.delete(r.key); waiting.set(r.key, r); }
      if (waiting.size >= max) flush();
      else if (waiting.size && !timer) { timer = true; setTimer(flush, delayMs); }
    },
    flush,
    get size() { return waiting.size; },
  };
}

/** Background side: answers SharedMsg with `remote`, and refuses while `enabled()` (拡張機能) is false. */
export function serveShared(remote: SharedRemote, enabled: () => Promise<boolean>) {
  browser.runtime.onMessage.addListener((msg: SharedMsg, _sender, sendResponse) => {
    if (msg?.type !== "shared:read" && msg?.type !== "shared:write") return;
    const job = enabled().then((on): Promise<Tally[] | void> => {
      if (!on) throw new Error("advanced-off");
      return msg.type === "shared:read" ? remote.read(msg.keys) : remote.write(msg.reports);
    });
    job.then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: (e as Error).message }));
    return true; // keep the channel open for the async reply
  });
}
