import { useEffect, useRef, useState } from "react";
import { Chip, LiveDot } from "@gmap/ui";
import { fetchPlaceShared } from "@/lib/mapsData";
import { askVerdict, extractFacts } from "@/lib/lunch";
import { CHIP_ORDER, MODIFIER_ORDER, QUESTIONS, type AskSpec, type QuestionId } from "@/lib/questions";
import { TONE_BG } from "./askLook";
import { LunchNano, lunchNanoFor } from "@/lib/nanoLunch";
import { LUNCH } from "@/lib/meals";
import { gatedStore, localLunchStore, sharedLunchStore } from "@/lib/lunchStore";
import { advancedOn } from "@/lib/advanced";
import { noCacheOn } from "@/lib/noCache";
import { messageRemote } from "@/lib/sharedRemote";
import { isFinal, LunchScanner, type LunchResult } from "@/lib/lunchScan";
import { fidFromHref } from "@/lib/searchList";
import { useT } from "@/lib/i18n/useT";
import { useDevMode } from "./parts";

const log = (...a: unknown[]) => console.log("[GMAP]", ...a);

/*
 * The place the user opened (from a map pin, a direct search, or any list):
 *  - LunchChip: the same lunch check as list results, so stores that never appear in a list (e.g. an
 *    居酒屋 under "餐廳") are covered. One place = 2 requests (+ one Nano prompt for tier B).
 *  - AnswerChips: every 問地圖 question its own Maps record answers (attributes, category) — no Nano,
 *    same record as the lunch check (fetchPlaceShared). The record is handed to the 問地圖 panel so the
 *    place joins its list without another request.
 */

export function PlaceAnswers() {
  return (
    <>
      <LunchChip />
      <AnswerChips />
    </>
  );
}

type Answer = { id: QuestionId; verdict: "menu" | "likely" };

function AnswerChips() {
  const { q } = useT();
  const fid = fidFromHref(location.href);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  useEffect(() => {
    if (!fid) return;
    setAnswers(null);
    const ac = new AbortController();
    const name = document.title.split(" - ")[0];
    fetchPlaceShared(name, fid, ac.signal).then(async (raw) => {
      if (ac.signal.aborted) return;
      const f = extractFacts(raw);
      const out: Answer[] = [];
      for (const id of [...CHIP_ORDER, ...MODIFIER_ORDER]) {
        const spec = QUESTIONS[id];
        if (spec.kind !== "ask") continue;
        let v: { verdict: string } = askVerdict(f, spec as AskSpec);
        // review questions need a search quote; show what an area scan already judged for this place
        if (v.verdict !== "menu" && v.verdict !== "likely" && spec.snippet) {
          const c = (await localLunchStore(browser.storage.local, undefined, id).get([fid])).get(fid);
          if (c) v = c;
        }
        if (v.verdict === "menu" || v.verdict === "likely") out.push({ id, verdict: v.verdict });
      }
      if (ac.signal.aborted) return;
      setAnswers(out);
      window.dispatchEvent(new CustomEvent("gmap:place-checked", { detail: { fid, name, raw } }));
    }).catch(() => {});
    return () => ac.abort();
  }, [fid]);
  if (!fid || !answers?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {answers.map((a) => (
        <span key={a.id} className={`chip font-sans text-ink ${a.verdict === "menu" ? TONE_BG[QUESTIONS[a.id].tone] : "chip-dashed bg-white"}`} title={q(a.id).title}>{q(a.id).labels[a.verdict]}</span>
      ))}
    </div>
  );
}

const BG: Partial<Record<LunchResult["verdict"], string>> = { menu: "bg-green-soft", likely: "bg-yellow-soft", error: "bg-red-soft" };

function LunchChip() {
  const { t, q } = useT();
  const dev = useDevMode();
  const fid = fidFromHref(location.href);
  const [r, setR] = useState<LunchResult | null>(null);
  const [open, setOpen] = useState(false);
  const scanner = useRef<LunchScanner | null>(null);
  const nano = useRef<Promise<LunchNano | null> | null>(null);

  useEffect(() => {
    if (!fid) return;
    setR(null); setOpen(false);
    const ac = new AbortController();
    (async () => {
      const cloud = await advancedOn(); // 拡張機能: shared cache on/off
      const fresh = await noCacheOn(); // dev 「キャッシュなし」: judge again, store nothing
      nano.current ??= LunchNano.available().then((a) => (a === "available" ? lunchNanoFor(LUNCH) : null));
      const sc = (scanner.current = new LunchScanner({
        fetchPlace: fetchPlaceShared,
        stores: { local: gatedStore(localLunchStore(browser.storage.local), () => fresh), shared: sharedLunchStore({ remote: messageRemote, enabled: () => cloud && !fresh, log }) },
        nano: await nano.current,
        onUpdate: () => { const x = sc.results.get(fid); if (x && !ac.signal.aborted) setR({ ...x }); },
      }));
      const name = document.title.split(" - ")[0];
      await sc.scan([{ fid, name }], ac.signal);
    })();
    return () => ac.abort();
  }, [fid]);

  if (!fid || !r) return null;
  const busy = !isFinal(r.verdict);
  const v = r.verdict;
  const label = v === "menu" || v === "likely" || v === "none" || v === "closed" ? q("lunch").labels[v] : v === "unsure" ? t.lunch.unsure : v === "error" ? t.lunch.error : "";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`chip cursor-pointer font-sans text-ink ${BG[r.verdict] ?? "bg-white"}`}>
        {busy ? <><LiveDot /> {t.lunch.checking}</> : <>{label}{r.price && (r.verdict === "menu" || r.verdict === "likely") && ` · ¥${r.price.yen.toLocaleString("ja-JP")}`}</>}
      </button>
      {open && !busy && (
        <div className="rounded-[18px] border-2 border-ink bg-white px-3 py-2 text-[12px] leading-snug text-body">
          {r.price && (r.verdict === "menu" || r.verdict === "likely") && <div className="mb-1 text-ink"><b>¥{r.price.yen.toLocaleString("ja-JP")}</b> {r.price.item}</div>}
          {r.evidence ? <>「{r.evidence.text}」</> : r.verdict === "closed" ? t.lunch.closedHint : t.lunch.noneHint}
          <div className="mt-1"><Chip className="text-[10px]">{r.evidence?.source === "menu" ? t.lunch.srcMenu : r.evidence?.source === "hours" ? t.lunch.srcHours : r.evidence ? t.lunch.srcNano : t.lunch.srcRule}{dev && r.from === "local" && t.lunch.cached}</Chip></div>
        </div>
      )}
    </div>
  );
}
