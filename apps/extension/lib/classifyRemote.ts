import type { Verdict } from "./health";

/*
 * Review-warning verdicts from services/classify (Cloud Run, Tokyo): Vertex AI gemini-embedding-001
 * + our own heads. Content scripts ask the background, which holds the Firebase user and its ID
 * token. The service caches verdicts in Firestore, so a review is embedded once for everyone.
 */
export const SERVICE_URL = "https://classify-82264202939.asia-northeast1.run.app";
export const CLASSIFY_URL = `${SERVICE_URL}/classify`;
const BATCH = 200;

export type ClassifyItem = { id: string; text: string };
export type ClassifyMsg = { type: "classify"; items: ClassifyItem[] };
type Reply = { ok: true; data: Record<string, Verdict> } | { ok: false; error: string };

/** Thrown when the extension was reloaded under an open Maps tab: this content script can no longer reach the background until the page reloads. */
export const CONTEXT_GONE = "context-invalidated";
/** The service's daily limit (per user or for everyone) is reached: HTTP 429. */
export const QUOTA = "quota";

/** Error text for a failed call to our service: "quota" for HTTP 429, else "HTTP <status>". */
export const httpError = (status: number) => (status === 429 ? QUOTA : `HTTP ${status}`);

export async function classifyRemote(items: ClassifyItem[]): Promise<Map<string, Verdict>> {
  if (!items.length) return new Map();
  let r: Reply | undefined;
  try {
    r = (await browser.runtime.sendMessage({ type: "classify", items } satisfies ClassifyMsg)) as Reply | undefined;
  } catch (e) {
    if (/context invalidated/i.test((e as Error).message)) throw new Error(CONTEXT_GONE);
    throw e;
  }
  if (!r) throw new Error("background did not answer");
  if (!r.ok) throw new Error(r.error);
  return new Map(Object.entries(r.data));
}

/**
 * Wakes the Cloud Run service (min instances 0: the first request after ~15 idle minutes waits
 * ~5 s for a cold start) and the Firebase token while the review list is still loading. Fire and forget.
 */
export function warmClassify() {
  browser.runtime.sendMessage({ type: "classify-warm" }).catch(() => {});
}

/**
 * Background side. `idToken` yields the signed-in (anonymous) Firebase user's ID token; `enabled` is
 * the 拡張機能 switch, checked before anything is sent.
 */
export function serveClassify(idToken: () => Promise<string>, enabled: () => Promise<boolean>, url = CLASSIFY_URL) {
  browser.runtime.onMessage.addListener((msg: ClassifyMsg | { type: "classify-warm" }, _sender, sendResponse) => {
    if (msg?.type === "classify-warm") {
      void (async () => {
        if (!(await enabled())) return;
        // /health, not /healthz: Cloud Run reserves paths ending in "z" (they never reach the service)
        await Promise.allSettled([idToken(), fetch(url.replace(/\/classify$/, "/health"))]);
      })();
      sendResponse(true);
      return;
    }
    if (msg?.type !== "classify") return;
    (async () => {
      if (!(await enabled())) throw new Error("advanced-off");
      const token = await idToken();
      const out: Record<string, Verdict> = {};
      for (let i = 0; i < msg.items.length; i += BATCH) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ items: msg.items.slice(i, i + BATCH) }),
        });
        if (!res.ok) throw new Error(httpError(res.status));
        const j = (await res.json()) as { verdicts: ({ id: string } & Verdict)[] };
        for (const v of j.verdicts) out[v.id] = { p: v.p, labels: v.labels, stance: v.stance };
      }
      return out;
    })().then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: (e as Error).message }));
    return true;
  });
}
