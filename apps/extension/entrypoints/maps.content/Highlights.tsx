import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isFinal, type LunchResult } from "@/lib/lunchScan";
import { isMatch, type Bubble } from "@/lib/askBubbles";
import { centerRect, clusterLabels, parseView, project, type CenterMode } from "@/lib/mapView";
import { fidFromHref } from "@/lib/searchList";
import { labelWidth, placeLabels } from "@/lib/labelLayout";
import type { T } from "@/lib/i18n/useT";
import { LOOK } from "./askLook";
import { Peek } from "./Peek";

/*
 * Two ways to show 問地圖 on Maps' own UI, both inside Shadow DOM:
 *  - ListBadges: a sticker on each matching result card in the left list (+ optional dimming of the rest),
 *    with the same rank number as the map label.
 *  - MapOverlay: every searched place drawn over the map canvas, projected from the URL camera (lib/mapView):
 *    candidates and places being judged as dots, matches as rings, the top few with a numbered name label;
 *    hovering a match opens its card (Peek). States: lib/askBubbles.
 * Maps-DOM assumptions are marked "calibrate"; they were written without a live tab.
 */

import { hasLunch } from "@/lib/askCombine";
export { hasLunch };

/** Re-use the panel's stylesheet (tokens + Tailwind) in other shadow roots without re-injecting CSS. */
function useSharedSheet(anchor: React.RefObject<HTMLElement | null>) {
  const [sheet, setSheet] = useState<CSSStyleSheet | null>(null);
  useEffect(() => {
    const root = anchor.current?.getRootNode();
    if (!(root instanceof ShadowRoot)) return;
    // drop WXT's `:host { all: initial !important }` reset — inside a shadow root it beats the host's inline position
    const keep = (r: CSSRule) => !(r instanceof CSSStyleRule && r.selectorText.includes(":host") && r.style.getPropertyValue("all"));
    const css = [...root.styleSheets].flatMap((s) => { try { return [...s.cssRules].filter(keep).map((r) => r.cssText); } catch { return []; } }).join("\n");
    const sh = new CSSStyleSheet();
    sh.replaceSync(css);
    setSheet(sh);
  }, [anchor]);
  return sheet;
}

const HOST_TAG = "gmap-ask-badge";
// calibrate: result card container; the <a.hfpxzc> overlay link sits inside it
const cardOf = (a: HTMLAnchorElement) => (a.closest("div.Nv2PK") as HTMLElement | null) ?? a.parentElement;

/**
 * `text`: the sticker words for one matched place (e.g. "一人OK·キャッシュレスOK" or "ランチ ¥850");
 * `rank`: its number on the map, if it has one. `lang`: the UI language's lang attribute (glyph shapes).
 */
export function ListBadges({ results, dim, text, rank, lang }: {
  results: LunchResult[]; dim: boolean; text: (r: LunchResult) => string; rank?: (fid: string) => number | undefined; lang: string;
}) {
  const look = LOOK;
  const anchor = useRef<HTMLSpanElement>(null);
  const sheet = useSharedSheet(anchor);
  const [boxes, setBoxes] = useState<[string, HTMLElement][]>([]);
  const byFid = useRef(new Map<string, LunchResult>());
  byFid.current = new Map(results.map((r) => [r.fid, r]));

  useEffect(() => {
    if (!sheet) return;
    const hosts = new Map<string, { host: HTMLElement; box: HTMLElement }>();
    const dimmed = new Set<HTMLElement>();
    const sync = () => {
      const seen = new Set<string>();
      for (const a of document.querySelectorAll<HTMLAnchorElement>("a.hfpxzc")) {
        const fid = fidFromHref(a.href), card = cardOf(a);
        if (!fid || !card) continue;
        const r = byFid.current.get(fid);
        const lunch = !!r && hasLunch(r);
        const fade = dim && !!r && isFinal(r.verdict) && !lunch;
        card.style.opacity = fade ? "0.45" : "";
        fade ? dimmed.add(card) : dimmed.delete(card);
        if (!lunch) continue;
        seen.add(fid);
        const cur = hosts.get(fid);
        if (cur?.host.isConnected && cur.host.parentElement === card) continue;
        cur?.host.remove();
        const host = document.createElement(HOST_TAG);
        host.style.cssText = `position:absolute;top:${look.badgeTop}px;right:8px;z-index:3;pointer-events:none`;
        host.setAttribute("lang", lang);
        if (getComputedStyle(card).position === "static") card.style.position = "relative";
        const shadow = host.attachShadow({ mode: "open" });
        shadow.adoptedStyleSheets = [sheet];
        const box = document.createElement("div");
        shadow.append(box);
        card.append(host);
        hosts.set(fid, { host, box });
      }
      for (const [fid, h] of hosts) if (!seen.has(fid)) { h.host.remove(); hosts.delete(fid); }
      setBoxes((prev) => {
        const next = [...hosts].map(([fid, h]) => [fid, h.box] as [string, HTMLElement]);
        return prev.length === next.length && prev.every(([f, b], i) => next[i][0] === f && next[i][1] === b) ? prev : next;
      });
    };
    sync();
    const t = setInterval(sync, 700);
    return () => {
      clearInterval(t);
      for (const h of hosts.values()) h.host.remove();
      for (const c of dimmed) c.style.opacity = "";
      setBoxes([]);
    };
  }, [sheet, dim, look, lang]);

  return (
    <>
      <span ref={anchor} hidden />
      {boxes.map(([fid, box]) => {
        const r = byFid.current.get(fid);
        if (!r || !hasLunch(r)) return null;
        const n = rank?.(fid);
        return createPortal(
          <span className={`chip pop-in font-sans text-ink ${n != null ? "pl-1" : ""} ${r.verdict === "menu" ? look.strongBg : look.weakBg}`}>
            {n != null && <span className="map-num h-[18px] w-[18px] text-[10px]">{n}</span>}
            {text(r)}
          </span>,
          box, fid,
        );
      })}
    </>
  );
}

/** Right edge of Maps' left panels (results list, and the place details panel when one is open). */
function leftPanelsRight(canvas: { left: number; width: number }) {
  let right = 0;
  for (const el of document.querySelectorAll('[role="main"]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.left < canvas.left + canvas.width / 2) right = Math.max(right, r.right);
  }
  return right;
}

// calibrate: the map surface and how far above the coordinate Maps draws a result pin's head
const mapRect = () => {
  const scene = document.querySelector<HTMLElement>("#scene");
  if (scene) return scene.getBoundingClientRect();
  let best: DOMRect | null = null;
  for (const c of document.querySelectorAll("canvas")) {
    const r = c.getBoundingClientRect();
    if (!best || r.width * r.height > best.width * best.height) best = r;
  }
  return best;
};
const PIN_HEAD_PX = 22;
const TOP_BAR_PX = 64; // Maps' search box + filter chips row
const PEEK_H = 300;    // rough card height, to keep it on screen
const LABEL_H = 30;    // .map-label: 20 px number circle + padding + 2 px outline

/**
 * A name-label candidate: rank number (once judging ends), its place in the label order, and the words
 * (place name, or a price in budget mode). Only the first LOOK.labelsMax candidates on separate spots are drawn.
 */
export type MapLabel = { num?: number; order?: number; text: string };
type Pt = { b: Bubble; x: number; y: number };
type Frame = { pts: Pt[]; center?: { x: number; y: number }; box: { left: number; right: number; top: number; bottom: number } };
const now = () => performance.now();

/**
 * Bubbles follow the camera without blinking:
 *  - drag: the layer is translated with the pointer (pan is 1:1), then snaps when Maps writes the new URL
 *  - wheel / keys / dbl-click zoom: the layer fades out and is redrawn ~120 ms after the URL changes
 * Our own UI (panel, dock, labels, card) never counts as map input — before, pressing a label hid the layer
 * and the click fell through to the map underneath.
 * `labelOf`: the name label of a match, or null for a plain ring (only the top few get one).
 */
export function MapOverlay({ bubbles, labelOf, ranks, mode, debug, hot, tt, onOpen }: {
  bubbles: Bubble[]; labelOf: (b: Bubble) => MapLabel | null; ranks: ReadonlyMap<string, number>;
  mode: CenterMode; debug?: boolean; hot?: string | null; tt: T; onOpen: (b: Bubble) => void;
}) {
  const look = LOOK, ring = look.ring;
  const root = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [state, setState] = useState<"shown" | "drag" | "zoom">("shown");
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const live = useRef({ bubbles, labelOf });
  live.current = { bubbles, labelOf };
  // hover card: which place, and a short close delay so the pointer can travel from the bubble to the card
  const [peek, setPeek] = useState<string | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openPeek = (fid: string) => { if (closing.current) clearTimeout(closing.current); closing.current = null; setPeek(fid); };
  const closePeek = () => { if (closing.current) clearTimeout(closing.current); closing.current = setTimeout(() => setPeek(null), 160); };

  useEffect(() => {
    let input: "idle" | "drag" | "settle" | "zoom" = "idle";
    let start: { x: number; y: number } | null = null, lastInput = 0, hrefAtInput = location.href, lastKey = "";
    const ours = (e: Event) => {
      const host = (root.current?.getRootNode() as ShadowRoot | undefined)?.host;
      return !!host && e.composedPath().includes(host);
    };
    const inMap = (e: MouseEvent) => {
      const r = mapRect();
      return !!r && e.clientX >= Math.max(r.left, leftPanelsRight(r)) && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const beginZoom = () => {
      if (input !== "zoom") hrefAtInput = location.href;
      input = "zoom"; lastInput = now(); setState("zoom"); setPeek(null);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || ours(e) || !inMap(e)) return;
      input = "drag"; start = { x: e.clientX, y: e.clientY }; hrefAtInput = location.href; lastInput = now();
      setState("drag"); setPeek(null);
    };
    const onMove = (e: PointerEvent) => {
      if (input !== "drag" || !start) return;
      setOffset({ x: e.clientX - start.x, y: e.clientY - start.y });
      lastInput = now();
    };
    const onUp = () => { if (input === "drag") { input = "settle"; start = null; lastInput = now(); } };
    const onWheel = (e: WheelEvent) => { if (!ours(e) && inMap(e)) beginZoom(); };
    const onDbl = (e: MouseEvent) => { if (!ours(e) && inMap(e)) beginZoom(); };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || ours(e)) return; // typing in Maps' search box
      if (/^(Arrow|\+|-|=)/.test(e.key)) beginZoom();
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onDown, opts);
    window.addEventListener("pointermove", onMove, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("wheel", onWheel, opts);
    window.addEventListener("dblclick", onDbl, opts);
    window.addEventListener("keydown", onKey, { capture: true });

    const draw = () => {
      const view = parseView(location.href), canvas = mapRect();
      if (!view || !canvas) { lastKey = ""; return setFrame(null); }
      const panelRight = leftPanelsRight(canvas);
      const rect = centerRect(canvas, panelRight, mode);
      const left = Math.max(canvas.left, panelRight);
      const { bubbles, labelOf } = live.current;
      const pts = bubbles.map((b) => ({ b, ...project(b.pos, view, rect) }))
        .filter((p) => p.x > left && p.x < canvas.right && p.y - PIN_HEAD_PX - look.labelLift - 24 > canvas.top + TOP_BAR_PX && p.y < canvas.bottom);
      const key = `${location.href}|${Math.round(canvas.width)}x${Math.round(canvas.height)}|${panelRight}|${pts.map((p) => `${p.b.fid}${p.b.state}${labelOf(p.b)?.num ?? ""}${labelOf(p.b)?.text ?? ""}`).join()}`;
      if (key === lastKey) return;
      lastKey = key;
      setFrame({
        pts,
        center: debug && rect.left + rect.width / 2 > panelRight ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined,
        box: { left, right: canvas.right, top: canvas.top + TOP_BAR_PX, bottom: canvas.bottom },
      });
    };
    const tick = () => {
      if (input === "drag") return; // keep the translated frame under the pointer
      if (input === "settle" || input === "zoom") {
        const quiet = now() - lastInput;
        const moved = location.href !== hrefAtInput;
        if ((moved && quiet > 120) || quiet > (input === "zoom" ? 1200 : 700)) {
          input = "idle"; lastKey = "";
          draw(); setOffset({ x: 0, y: 0 }); setState("shown");
        }
        return;
      }
      draw();
    };
    draw();
    const t = setInterval(tick, 100);
    return () => {
      clearInterval(t);
      window.removeEventListener("pointerdown", onDown, opts);
      window.removeEventListener("pointermove", onMove, opts);
      window.removeEventListener("pointerup", onUp, opts);
      window.removeEventListener("wheel", onWheel, opts);
      window.removeEventListener("dblclick", onDbl, opts);
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [mode, debug, look]);

  // the card and labels must not slide under our own panel or the dock (same shadow root, drawn above the overlay)
  const ownLeft = Math.min(...[...((root.current?.getRootNode() as ShadowRoot | undefined)?.querySelectorAll?.("aside, .tool-dock") ?? [])]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.left));
  const rightEdge = Math.min(frame?.box.right ?? Infinity, Number.isFinite(ownLeft) ? ownLeft - 8 : Infinity);

  // Matches in label order (labelled by number, then the rest by rank / arrival): clusterLabels makes the
  // first point of a group its head, so a numbered place always carries the group's label.
  const layout = useMemo(() => {
    const pts = frame?.pts ?? [];
    const cand = pts.map((p) => (isMatch(p.b.state) ? labelOf(p.b) : null));
    const order = pts.map((_, i) => i).filter((i) => isMatch(pts[i].b.state));
    const prio = (i: number) => (cand[i] ? cand[i]!.num ?? cand[i]!.order ?? 0 : 10_000 + (ranks.get(pts[i].b.fid) ?? 5_000));
    order.sort((a, b) => prio(a) - prio(b) || a - b);
    const groups = clusterLabels(order.map((i) => pts[i]));
    const head = new Map<number, number>(), count = new Map<number, number>(), members = new Map<number, number[]>();
    order.forEach((i, k) => {
      const h = order[groups.head[k]];
      head.set(i, h);
      members.set(h, [...(members.get(h) ?? []), i]);
    });
    for (const [h, m] of members) count.set(h, m.length);
    // next-match order for the card's 次へ: by rank, unranked after in arrival order
    const nav = order.slice().sort((a, b) => (ranks.get(pts[a].b.fid) ?? 1e9) - (ranks.get(pts[b].b.fid) ?? 1e9) || a - b);
    // labels: the first few candidates that head their own group, in rank order; the rest stay small rings
    const labelled = order.filter((i) => cand[i] && head.get(i) === i).slice(0, look.labelsMax);
    const keep = new Set(labelled);
    const lab = cand.map((l, i) => (keep.has(i) ? l : null));
    // each label on the first free side of its ring (lib/labelLayout); no room → number only
    const place = frame ? placeLabels(labelled.map((i) => {
      const n = count.get(i) ?? 1, l = lab[i]!;
      return { id: pts[i].b.fid, cx: pts[i].x, cy: pts[i].y - PIN_HEAD_PX, w: labelWidth(l.text, l.num != null, n > 1 ? tt.t.map.more(n - 1) : ""), h: LABEL_H };
    }), { x: frame.box.left, y: frame.box.top, w: rightEdge - frame.box.left, h: frame.box.bottom - frame.box.top }, look.labelLift, look.ring / 2 + 2) : new Map();
    return { lab, head, count, members, nav, place };
  }, [frame, labelOf, ranks, rightEdge, tt]);

  const interactive = state === "shown";
  const peekIdx = peek && frame ? frame.pts.findIndex((p) => p.b.fid === peek) : -1;
  const peekPt = peekIdx >= 0 && frame && isMatch(frame.pts[peekIdx].b.state) ? frame.pts[peekIdx] : null;
  const next = () => {
    if (!frame || peekIdx < 0) return;
    const k = layout.nav.indexOf(peekIdx);
    openPeek(frame.pts[layout.nav[(k + 1) % layout.nav.length]].b.fid);
  };
  const hover = (fid: string) => ({
    onMouseEnter: () => openPeek(fid), onMouseLeave: closePeek, onFocus: () => openPeek(fid), onBlur: closePeek,
  });

  // stable DOM order (pool order): moving nodes would restart every bubble's pop-in animation on each
  // hover; the hovered place is lifted with z-index instead
  return (
    <div
      ref={root}
      className="pointer-events-none fixed inset-0 z-[2147482990]"
      style={{ opacity: state === "zoom" || !frame ? 0 : 1, transition: "opacity .15s", transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {frame?.center && <span className="absolute h-4 w-4 rounded-full border-2 border-ink bg-red" style={{ left: frame.center.x - 8, top: frame.center.y - 8 }} />}
      {frame && frame.pts.map(({ b, x, y }, i) => {
        const match = isMatch(b.state), menu = b.state === "sure";
        const lifted = b.fid === hot || b.fid === peek;
        const isHead = match && layout.head.get(i) === i;
        const n = layout.count.get(i) ?? 1;
        const lab = layout.lab[i];
        const num = ranks.get(b.fid);
        // labelled / hovered places: the full sticker ring, drawn above every other ring; the rest: a small ring
        const big = !!lab || lifted, ring = big ? look.ring : look.ringSmall;
        // a placed label sits where labelLayout put it; a hovered place without one shows its name above
        const spot = layout.place.get(b.fid);
        const showLabel = match && (!!spot || lifted);
        const badgeOnly = match && isHead && !!lab && spot === null && num != null && !lifted;
        return (
          <div key={b.fid} className="absolute" style={{ left: x, top: y - PIN_HEAD_PX, zIndex: lifted ? 5 : big ? 4 : match ? 2 : 1 }}>
            {/* zero-size wrapper at the point: new places pop in from their own centre */}
            <div className="pop-in absolute left-0 top-0" style={{ animationDelay: `${Math.min(i, 24) * 18}ms` }}>
              {!match && b.state === "judging" && <span className="map-judging" />}
              {!match && <span className={`map-dot ${b.state === "no" ? "map-gone" : ""}`} />}
              {match && (
                // keyed by state and size: a dot that turns into a ring (or a ring that gets a label) pops again
                <span key={`${b.state}${big}`} className="pop-in absolute left-0 top-0">
                  {lifted && <span className={`map-glow absolute ${menu ? look.strongRing : look.weakRing}`} style={{ left: -ring / 2 - 10, top: -ring / 2 - 10, width: ring + 20, height: ring + 20 }} />}
                  {/* sticker ring: ink outline around a tone ring; hovering it opens the card */}
                  <span
                    {...hover(b.fid)} onClick={() => onOpen(b)}
                    className={`absolute cursor-pointer rounded-full border-2 border-ink ${interactive ? "pointer-events-auto" : ""}`}
                    style={{ left: -ring / 2 - 2, top: -ring / 2 - 2, width: ring + 4, height: ring + 4 }}
                  />
                  <span className={`pointer-events-none absolute rounded-full border-[3px] ${menu ? look.strongRing : look.weakRing}`} style={{ left: -ring / 2, top: -ring / 2, width: ring, height: ring }} />
                </span>
              )}
              {/* only numbered (or hovered) places carry a label; "+n" = other matches hidden under it */}
              {showLabel && (
                <button
                  type="button" {...hover(b.fid)} onClick={() => onOpen(b)}
                  title={(layout.members.get(i) ?? [i]).map((j) => frame.pts[j].b.name).join("\n")}
                  className={`map-label absolute ${interactive ? "pointer-events-auto" : ""} ${lifted ? "map-label-ink" : menu ? look.strongBg : look.weakBg} ${num == null ? "map-label-plain" : ""}`}
                  style={spot
                    ? { left: spot.box.x - x, top: spot.box.y - (y - PIN_HEAD_PX), maxWidth: spot.box.w + 2 }
                    : { left: 0, bottom: look.labelLift, transform: "translateX(-50%)" }}
                >
                  {num != null && <span className="map-num">{num}</span>}
                  <span className="map-label-text">{lab?.text ?? b.name}</span>
                  {isHead && n > 1 && <span className="map-label-more">{tt.t.map.more(n - 1)}</span>}
                </button>
              )}
              {/* no free spot for the label: the ring keeps its number */}
              {badgeOnly && (
                <button type="button" {...hover(b.fid)} onClick={() => onOpen(b)} title={b.name} aria-label={b.name}
                  className={`map-num absolute cursor-pointer border-2 border-white ${interactive ? "pointer-events-auto" : ""}`}
                  style={{ left: ring / 2 - 14, top: -ring / 2 - 8 }}>{num}</button>
              )}
            </div>
          </div>
        );
      })}
      {peekPt && frame && interactive && (
        <div
          className="pointer-events-auto absolute z-[6]"
          onMouseEnter={() => openPeek(peekPt.b.fid)} onMouseLeave={closePeek}
          style={{
            left: peekPt.x + ring / 2 + look.peekW + 16 > rightEdge ? peekPt.x - ring / 2 - 12 - look.peekW : peekPt.x + ring / 2 + 12,
            top: Math.max(frame.box.top + 8, Math.min(peekPt.y - PIN_HEAD_PX - 70, frame.box.bottom - PEEK_H)),
          }}
        >
          <Peek b={peekPt.b} rank={ranks.get(peekPt.b.fid)} tt={tt} onOpen={() => onOpen(peekPt.b)} onNext={layout.nav.length > 1 ? next : undefined} />
        </div>
      )}
    </div>
  );
}
