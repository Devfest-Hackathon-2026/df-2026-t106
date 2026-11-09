import type { Tone } from "@/lib/meals";

/*
 * How 問地圖 results look on Maps. Several questions can be on at once and a place lights up only when it
 * answers all of them, so ring and sticker colour carry certainty, not the question (DESIGN.md §7):
 * green = every active question says yes for sure, yellow = yes, but at least one only "likely".
 * Labels name the place (rank + name); the question itself is in the panel and in the hover card.
 */
export const LOOK = {
  strongBg: "bg-green-soft", weakBg: "bg-yellow-soft",     // 確定 / 可能 (chips, rows)
  strongRing: "border-green", weakRing: "border-yellow",   // map ring tone
  pinStrong: "#34a853", pinWeak: "#f9ab00",                // Pin fill in panel rows
  badgeTop: 8,                                             // px from the result card's top
  ring: 44,                                                // inner ring diameter (labelled / hovered matches)
  ringSmall: 20,                                           // other matches: a small ring, so 100+ matches stay readable
  labelLift: 26,                                           // map label distance above the ring centre
  labelsMax: 3,                                            // name labels on the map at once; other matches stay rings
  peekW: 300,                                              // hover card width
} as const;

/** Soft background per chip tone, for rows and per-question chips (literal class names for Tailwind). */
export const TONE_BG: Record<Tone, string> = { blue: "bg-blue-soft", red: "bg-red-soft", yellow: "bg-yellow-soft", green: "bg-green-soft" };
