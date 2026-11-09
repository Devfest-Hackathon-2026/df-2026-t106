import { useEffect, useState } from "react";
import { DICTS, qText, DEFAULT_LANG, isUiLang, UI_LANG_KEY, type UiLang } from "./index";
import type { QuestionId } from "../questions";

/** A value in storage.local, kept in sync with the popup and every open page; `def` while unset. */
export function useStored<T>(key: string, def: T, valid: (v: unknown) => v is T = (v): v is T => v !== undefined): T {
  const [val, setVal] = useState<T>(def);
  useEffect(() => {
    const pick = (v: unknown) => setVal(valid(v) ? v : def);
    browser.storage.local.get(key).then((v) => pick(v[key]));
    const listen = (ch: Record<string, { newValue?: unknown }>) => { if (key in ch) pick(ch[key].newValue); };
    browser.storage.onChanged.addListener(listen);
    return () => browser.storage.onChanged.removeListener(listen);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return val;
}

/** The UI language (popup switch, Japanese by default) and its words. Re-renders when the switch changes. */
export function useT() {
  const lang = useStored<UiLang>(UI_LANG_KEY, DEFAULT_LANG, isUiLang);
  return { lang, t: DICTS[lang], q: (id: QuestionId) => qText(lang, id) };
}
export type T = ReturnType<typeof useT>;
