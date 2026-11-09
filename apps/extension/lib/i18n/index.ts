import { ja, type Dict } from "./ja";
import { zh } from "./zh";
import { en } from "./en";
import type { UiLang } from "./lang";

export * from "./lang";
export { qText, type QText, type VerdictLabels } from "./questions";
export type { Dict };

export const DICTS: Record<UiLang, Dict> = { ja, zh, en };

/** A review-language code (ja, en, fil …) in the UI language, e.g. ja → 日本語 / Japanese / 日文. */
export function langName(ui: UiLang, code: string): string {
  try { return new Intl.DisplayNames([ui === "zh" ? "zh-Hant" : ui], { type: "language" }).of(code) ?? code; } catch { return code; }
}
