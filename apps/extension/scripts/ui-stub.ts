// Harness-only stand-in for @gmap/ui (keeps React out of the injected bundle).
export const CHART_SLOTS = ["#4285f4", "#ea4335", "#129eaf", "#e8a000", "#a142f4", "#34a853"] as const;
export const CHART_OTHER = "#9aa0a6";
export type PieDatum = { key: string; label: string; value: number; color: string };
export type TrendPoint = { key: string; label: string; avg: number | null; count: number; estimated: boolean };
