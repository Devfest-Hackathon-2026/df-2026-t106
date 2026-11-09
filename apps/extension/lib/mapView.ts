import type { LatLng } from "./mapsData";

/*
 * Where is a lat/lng on screen? Maps' canvas can't be queried, but the URL carries the camera
 * (/@lat,lng,zoomz) and the map is Web Mercator with 256-px tiles, so we project ourselves.
 * Unverified assumption (calibrate in dev mode): the URL centre is the centre of the map canvas
 * ("canvas"), not of the part left visible by the side panel ("visible").
 */

export type View = { lat: number; lng: number; zoom: number };
export type Rect = { left: number; top: number; width: number; height: number };
export type CenterMode = "canvas" | "visible";

/** Only `…z` (zoom) views; satellite/3D URLs use `…m` (metres) and are not projected. */
export function parseView(href: string): View | null {
  const m = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
  return m ? { lat: +m[1], lng: +m[2], zoom: +m[3] } : null;
}

export function worldPx({ lat, lng }: LatLng, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}

/** Screen position of `pos` given the camera and the rect whose centre the camera points at. */
export function project(pos: LatLng, view: View, rect: Rect) {
  const p = worldPx(pos, view.zoom), c = worldPx(view, view.zoom);
  return { x: rect.left + rect.width / 2 + (p.x - c.x), y: rect.top + rect.height / 2 + (p.y - c.y) };
}

/** The rect the URL centre refers to: whole canvas, or canvas minus the left panel. */
export function centerRect(canvas: Rect, panelRight: number, mode: CenterMode): Rect {
  if (mode === "canvas" || panelRight <= canvas.left) return canvas;
  const left = Math.min(panelRight, canvas.left + canvas.width);
  return { left, top: canvas.top, width: canvas.left + canvas.width - left, height: canvas.height };
}

/**
 * Nearby markers share one label: greedy, in input order. Returns for each point the index of the
 * label it belongs to and, for label heads, how many points the label covers.
 */
export function clusterLabels(pts: { x: number; y: number }[], radius = 36) {
  const head: number[] = [], count = new Map<number, number>();
  pts.forEach((p, i) => {
    const h = [...count.keys()].find((j) => Math.hypot(pts[j].x - p.x, pts[j].y - p.y) < radius);
    if (h == null) { head.push(i); count.set(i, 1); } else { head.push(h); count.set(h, count.get(h)! + 1); }
  });
  return { head, count };
}
