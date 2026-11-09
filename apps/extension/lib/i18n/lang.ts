/** UI language. Japanese is the default for everyone; the popup switches it (storage key UI_LANG_KEY). */
export const UI_LANGS = ["ja", "zh", "en"] as const;
export type UiLang = (typeof UI_LANGS)[number];
export const UI_LANG_KEY = "uiLang";
export const DEFAULT_LANG: UiLang = "ja";
export const isUiLang = (x: unknown): x is UiLang => (UI_LANGS as readonly unknown[]).includes(x);
/** The `lang` attribute: decides CJK glyph shapes (Han unification) and the :lang() font stacks. */
export const htmlLang = (l: UiLang) => (l === "zh" ? "zh-Hant" : l);
/** Each language's name in itself, for the switch. */
export const LANG_NAME: Record<UiLang, string> = { ja: "日本語", zh: "中文", en: "English" };
