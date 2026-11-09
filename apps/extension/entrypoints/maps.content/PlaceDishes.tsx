import { useEffect, useState } from "react";
import { Chip, LiveDot } from "@gmap/ui";
import { fetchPlaceShared } from "@/lib/mapsData";
import { extractFacts } from "@/lib/lunch";
import { reviewTopics, topDishes, type Dish } from "@/lib/dishes";
import { fidFromHref } from "@/lib/searchList";
import { noCacheOn } from "@/lib/noCache";
import { useDevMode } from "./parts";
import { useT } from "@/lib/i18n/useT";

/*
 * 這家該點什麼: the dishes reviewers mention most that are also on the owner menu, with the price.
 * String match only (lib/dishes.ts). Shares the place fetch with the lunch chip; cached locally 14 days.
 */

const VERSION = "d2";
const TTL_MS = 14 * 24 * 3600_000;
const key = (fid: string) => `dishes:${VERSION}:${fid}`;
type Cached = { dishes: Dish[]; topics: number; at: number };
const TONES = ["bg-blue-soft", "bg-red-soft", "bg-yellow-soft"];
const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

export function PlaceDishes() {
  const fid = fidFromHref(location.href);
  const dev = useDevMode();
  const { t } = useT();
  const [state, setState] = useState<{ fid: string; loading: boolean; data?: Cached; error?: string } | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => { browser.storage.local.get("dishesOpen").then((v) => { if (v.dishesOpen === false) setOpen(false); }); }, []);
  const toggle = () => { setOpen(!open); browser.storage.local.set({ dishesOpen: !open }); };

  useEffect(() => {
    if (!fid) return;
    let gone = false;
    setState({ fid, loading: true });
    (async () => {
      const fresh = await noCacheOn(); // dev 「キャッシュなし」: read Maps again, store nothing
      const hit = fresh ? undefined : (await browser.storage.local.get(key(fid)))[key(fid)] as Cached | undefined;
      if (hit && Date.now() - hit.at < TTL_MS) return !gone && setState({ fid, loading: false, data: hit });
      try {
        const p = await fetchPlaceShared(document.title.split(" - ")[0], fid);
        const topics = reviewTopics(p);
        const data: Cached = { dishes: topDishes(topics, extractFacts(p).menuRows), topics: topics.length, at: Date.now() };
        if (!fresh) await browser.storage.local.set({ [key(fid)]: data });
        if (!gone) setState({ fid, loading: false, data });
      } catch (e) {
        if (!gone) setState({ fid, loading: false, error: (e as Error).message });
      }
    })();
    return () => { gone = true; };
  }, [fid]);

  if (!fid || !state || state.fid !== fid) return null;
  if (state.loading) return <span className="chip bg-white font-sans text-ink"><LiveDot /> {t.dishes.loading}</span>;
  const dishes = state.data?.dishes ?? [];
  if (!dishes.length) {
    // nothing to recommend is the common quiet case; only dev mode says why
    return dev ? <Chip className="bg-white text-[10px]">{state.error ?? t.dishes.devNone(state.data?.topics ?? 0)}</Chip> : null;
  }
  if (!open) {
    return <button type="button" onClick={toggle} className="chip cursor-pointer bg-white font-sans text-ink">{t.dishes.collapsed(dishes.length)}</button>;
  }
  return (
    <section className="flex w-full flex-col gap-2 rounded-[22px] border-2 border-ink bg-white p-3 font-sans text-ink">
      <header className="flex items-center gap-2">
        <span className="font-mono text-[10px] font-bold tracking-wider text-muted uppercase">What to order</span>
        <b className="text-[15px]">{t.dishes.title}</b>
        <button type="button" onClick={toggle} aria-label={t.common.collapse} className="ml-auto grid h-7 w-7 cursor-pointer place-items-center rounded-full border-2 border-ink bg-white text-[12px] font-bold">—</button>
      </header>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {dishes.map((d, i) => (
          <li key={d.topic} className={`flex items-center gap-2.5 rounded-[16px] border-2 border-ink px-2.5 py-2 ${TONES[i % TONES.length]}`}>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-white font-mono text-[11px] font-bold">{i + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[14px] leading-tight">{d.item}</b>
              <span className="font-mono text-[10px] font-bold tracking-wider text-muted">{t.dishes.mentions(d.mentions, d.topic)}{d.variants > 1 && t.dishes.variants(d.variants)}</span>
            </span>
            {d.yen != null && <b className="shrink-0 text-[15px]">{yen(d.yen)}</b>}
          </li>
        ))}
      </ol>
      {dev && <p className="m-0 text-[11px] leading-snug text-muted">{t.dishes.note}</p>}
    </section>
  );
}
