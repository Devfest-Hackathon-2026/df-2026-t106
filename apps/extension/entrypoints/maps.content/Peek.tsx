import { Button } from "@gmap/ui";
import { hasLunch } from "@/lib/askCombine";
import { QUESTIONS } from "@/lib/questions";
import type { Bubble } from "@/lib/askBubbles";
import type { T } from "@/lib/i18n/useT";
import { LOOK, TONE_BG } from "./askLook";
import { partLabel, yen } from "./askWords";

/**
 * The card a map bubble opens on hover / focus: why the place matches, one line per selected question
 * (answer, where it comes from, the original quote), then open it or step to the next match.
 * Quotes stay in the language Maps wrote them in; only the words around them follow the UI language.
 */
export function Peek({ b, rank, tt, onOpen, onNext }: { b: Bubble; rank?: number; tt: T; onOpen: () => void; onNext?: () => void }) {
  const { t } = tt;
  const parts = b.row?.parts ?? [];
  const sure = b.state === "sure";
  return (
    <div className="fade-up flex flex-col gap-2.5 rounded-[22px] border-2 border-ink bg-white p-3.5 font-sans text-ink" style={{ width: LOOK.peekW }}>
      <div className="flex items-center gap-2">
        {rank != null && <span className="map-num h-6 w-6 text-[12px]">{rank}</span>}
        <b className="min-w-0 flex-1 truncate text-[17px] leading-tight tracking-tight">{b.name}</b>
        <span className={`chip shrink-0 px-2 py-1 text-[10px] ${sure ? LOOK.strongBg : LOOK.weakBg}`}>{sure ? t.ask.sure : t.ask.likely}</span>
      </div>
      <span className="font-mono text-[10px] font-bold tracking-[.1em] text-muted uppercase">{t.map.why(parts.length)}</span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {parts.map(([id, p]) => {
          const yes = !!p && hasLunch(p), strong = p?.verdict === "menu";
          return (
            <li key={id} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className={`chip px-2 py-1 font-sans text-[11.5px] tracking-normal normal-case ${yes ? TONE_BG[QUESTIONS[id].tone] : "bg-white"} ${strong ? "" : "chip-dashed"}`}>
                  {strong ? "✓" : "?"} {partLabel(tt, id, p)}
                </span>
                {p?.evidence && <span className="font-mono text-[9.5px] font-bold tracking-[.08em] text-muted uppercase">{t.source[p.evidence.source]}</span>}
              </span>
              {p?.evidence && <span className="line-clamp-2 text-[12px] leading-snug text-body">「{p.evidence.text}」</span>}
            </li>
          );
        })}
      </ul>
      {b.row?.price && (
        <span className="flex min-w-0 items-baseline gap-2">
          <b className="text-[14px]">{yen(b.row.price.yen)}</b>
          <span className="min-w-0 flex-1 truncate text-[12px] text-body">{b.row.price.item}</span>
        </span>
      )}
      {!sure && <p className="m-0 rounded-[14px] bg-yellow-soft px-2.5 py-1.5 text-[11.5px] leading-snug">{t.map.likelyNote}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={onOpen}>{t.map.open}</Button>
        {onNext && <Button size="sm" onClick={onNext}>{t.map.next}</Button>}
      </div>
    </div>
  );
}
