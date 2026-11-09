/*
 * Opening a place inside Maps without reloading the page. Measured 2026-11-07 (池袋, from a search
 * list, from the bare map and from another place): push the place URL with a null history state and
 * fire `popstate` — Maps' router reads the URL as if the user had pressed Back/Forward and opens the
 * place in place. Maps then records the place itself (pushState/replaceState about 0.3 s and 1–1.6 s
 * later); those calls are turned into replaceState so exactly one history entry is added and Back
 * returns to the list or the map. Maps calls `history.pushState` on the instance, so the wrapper has to
 * live in the MAIN world (entrypoints/maps-tap.content.ts); the panel asks for it by postMessage.
 */

export const NAV_MESSAGE = "gmap-ext:open-place";
export const NAV_DONE = "gmap-ext:open-place:done";
export type NavRequest = { type: typeof NAV_MESSAGE; id: string; url: string; fid: string };
export type NavDone = { type: typeof NAV_DONE; id: string; ok: boolean };

/** How long Maps' own history calls for the place are folded into our one entry. */
export const NAV_SETTLE_MS = 3000;

type Win = Pick<Window, "history" | "addEventListener" | "postMessage" | "dispatchEvent" | "location"> & { PopStateEvent: typeof PopStateEvent };
type HistoryFn = History["pushState"];

/** MAIN world: serve open requests from the isolated world. */
export function installPlaceNav(win: Win, settleMs = NAV_SETTLE_MS) {
  let finish: ((superseded?: boolean) => void) | null = null;
  win.addEventListener("message", (e: MessageEvent<NavRequest>) => {
    const m = e.data;
    if (e.source !== (win as unknown) || m?.type !== NAV_MESSAGE || typeof m.id !== "string" || typeof m.fid !== "string") return;
    if (typeof m.url !== "string" || !m.url.startsWith("/maps/place/") || !m.url.includes(m.fid)) return;
    finish?.(true); // a newer click wins: the previous one stops folding Maps' calls
    let resolved = false;
    const reply = (ok: boolean) => { if (resolved) return; resolved = true; win.postMessage({ type: NAV_DONE, id: m.id, ok } satisfies NavDone, win.location.origin); };
    finish = openInPage(win, m.url, m.fid, reply, settleMs);
  });
}

/** Pushes `url`, lets Maps route to it and folds Maps' own history calls for `fid` into that entry. Returns a stop function. */
export function openInPage(win: Win, url: string, fid: string, reply: (ok: boolean) => void, settleMs = NAV_SETTLE_MS) {
  const h = win.history;
  const own = { push: Object.getOwnPropertyDescriptor(h, "pushState"), replace: Object.getOwnPropertyDescriptor(h, "replaceState") };
  const base = { push: h.pushState, replace: h.replaceState };
  const mine = (u: unknown) => u != null && (String(u).includes(fid) || decode(String(u)).includes(fid));
  const wrap = (fn: HistoryFn): HistoryFn => function (this: History, state, unused, u) {
    if (!mine(u)) return fn.call(this, state, unused, u);
    reply(true);
    return base.replace.call(this, state, unused, u);
  };
  h.pushState = wrap(base.push);
  h.replaceState = wrap(base.replace);
  let stopped = false;
  /** `superseded`: a newer click took over, so this one must not fall back to a page load. */
  const stop = (superseded = false) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    restore(h, "pushState", own.push);
    restore(h, "replaceState", own.replace);
    reply(superseded); // no-op once Maps answered
  };
  const timer = setTimeout(stop, settleMs);
  base.push.call(h, null, "", url);
  win.dispatchEvent(new win.PopStateEvent("popstate", { state: null }));
  return stop;
}

function restore(h: History, key: "pushState" | "replaceState", d: PropertyDescriptor | undefined) {
  if (d) Object.defineProperty(h, key, d); else delete (h as unknown as Record<string, unknown>)[key];
}

function decode(s: string) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Isolated world: ask the MAIN world to open `url`. "opened" once Maps routed to the place; "failed"
 * when it did not (the URL was pushed, the page shows something else); "absent" when nothing answered
 * (no MAIN-world script on this page, e.g. right after the extension was updated).
 */
export function requestOpen(fid: string, url: string, timeoutMs = NAV_SETTLE_MS + 500): Promise<"opened" | "failed" | "absent"> {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const on = (e: MessageEvent<NavDone>) => {
      if (e.source === window && e.data?.type === NAV_DONE && e.data.id === id) done(e.data.ok ? "opened" : "failed");
    };
    const timer = setTimeout(() => done("absent"), timeoutMs);
    function done(r: "opened" | "failed" | "absent") { clearTimeout(timer); window.removeEventListener("message", on); resolve(r); }
    window.addEventListener("message", on);
    window.postMessage({ type: NAV_MESSAGE, id, url, fid } satisfies NavRequest, location.origin);
  });
}
