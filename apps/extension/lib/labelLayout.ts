/*
 * Map labels that never overlap (問地圖 name labels). Greedy, in rank order: each label tries above its
 * ring, then below, right and left, and takes the first spot that hits no earlier label, no other labelled
 * ring and stays inside the map. No free spot → null: the ring then shows only its number.
 * Widths are estimated from the text (the labels are absolutely positioned before they are measured).
 */
export type Box = { x: number; y: number; w: number; h: number };
export type Side = "top" | "bottom" | "right" | "left";
export type LabelItem = { id: string; cx: number; cy: number; w: number; h: number };
export type Placed = { side: Side; box: Box };

const SIDES: Side[] = ["top", "bottom", "right", "left"];

/** Label width in px: rank circle, text (CJK ≈ 13 px, Latin ≈ 7.6 px at 13 px bold), "+n", padding; capped. */
export function labelWidth(text: string, num: boolean, more = "", max = 168): number {
  const chars = (s: string) => [...s].reduce((w, c) => w + (/[　-鿿＀-￯]/.test(c) ? 13 : 7.6), 0);
  const w = 4 + (num ? 3 + 20 + 6 : 11) + chars(text) + (more ? 6 + chars(more) * 0.85 : 0) + 11;
  return Math.min(max, Math.ceil(w));
}

const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** `gap`: distance from the ring centre to the label's near edge (ring radius + a little). */
export function placeLabels(items: LabelItem[], bounds: Box, gap = 26, ringR = 24): Map<string, Placed | null> {
  const rings: Box[] = items.map((it) => ({ x: it.cx - ringR, y: it.cy - ringR, w: ringR * 2, h: ringR * 2 }));
  const placed: Box[] = [];
  const out = new Map<string, Placed | null>();
  items.forEach((it, i) => {
    const at: Record<Side, Box> = {
      top: { x: it.cx - it.w / 2, y: it.cy - gap - it.h, w: it.w, h: it.h },
      bottom: { x: it.cx - it.w / 2, y: it.cy + gap, w: it.w, h: it.h },
      right: { x: it.cx + gap, y: it.cy - it.h / 2, w: it.w, h: it.h },
      left: { x: it.cx - gap - it.w, y: it.cy - it.h / 2, w: it.w, h: it.h },
    };
    const side = SIDES.find((s) => inside(at[s], bounds) && !placed.some((p) => hits(p, at[s])) && !rings.some((r, j) => j !== i && hits(r, at[s])));
    if (!side) { out.set(it.id, null); return; }
    placed.push(at[side]);
    out.set(it.id, { side, box: at[side] });
  });
  return out;
}
