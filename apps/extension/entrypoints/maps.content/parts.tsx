import { useEffect, useState, type ReactNode } from "react";
import { ColorBar, Logo } from "@gmap/ui";
import { useStored, useT } from "@/lib/i18n/useT";

/** Dev mode (toggled from the popup) reveals pipeline internals. */
export function useDevMode() {
  return useStoredFlag("devMode");
}

/** A boolean in storage.local that stays in sync with the popup; `def` while unset. */
export function useStoredFlag(key: string, def = false) {
  return !!useStored<unknown>(key, def);
}

/** Anchor a launcher just right of Maps' left panel (place details or search results) while `when()` holds. */
export function useLauncherPos(when: () => boolean) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      if (!when()) return setPos(null);
      // rightmost visible left panel: the place details panel sits next to the results list when both are open
      let r: DOMRect | null = null;
      for (const el of document.querySelectorAll('[role="main"]')) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.left < innerWidth / 2 && (!r || b.right > r.right)) r = b;
      }
      setPos(r ? { left: Math.round(r.right + 12), top: Math.round(r.top + 76) } : { left: 492, top: 90 });
    }, 800);
    return () => clearInterval(t);
  }, [when]);
  return pos;
}

export function PanelShell({ title, sub, onClose, onMinimize, children }: { title: string; sub?: string; onClose: () => void; onMinimize?: () => void; children: ReactNode }) {
  const { t } = useT();
  return (
    <aside className="fixed top-[72px] right-[100px] z-[2147483000] flex max-h-[calc(100vh-88px)] w-[392px] flex-col overflow-hidden rounded-[28px] border-2 border-ink bg-paper">
      <ColorBar />
      <header className="flex items-center gap-2.5 border-b-2 border-ink bg-white px-4 py-3">
        <Logo width={30} height={30} />
        <span className="header-brand-copy min-w-0">{title}{sub && <small className="truncate">{sub}</small>}</span>
        {onMinimize && <button type="button" onClick={onMinimize} aria-label={t.common.minimize} className="ml-auto grid h-9 w-9 cursor-pointer place-items-center rounded-full border-2 border-ink bg-white font-bold">—</button>}
        <button type="button" onClick={onClose} aria-label={t.common.close} className={`${onMinimize ? "" : "ml-auto "}grid h-9 w-9 cursor-pointer place-items-center rounded-full border-2 border-ink bg-white font-bold`}>✕</button>
      </header>
      <div className="flex flex-col gap-3 overflow-y-auto p-4 [&>*]:shrink-0">{children}</div>
    </aside>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[16px] border-2 border-ink bg-white px-2.5 py-2">
      <div className="font-mono text-[10px] font-bold tracking-wider text-muted">{label}</div>
      <div className="text-[18px] font-bold leading-tight">{value}</div>
    </div>
  );
}

export function SecHead({ index, kicker, title }: { index: string; kicker: string; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="sec-index h-7 min-w-11 text-[11px]">{index}</span>
        <span className="sec-kicker text-[11px]">{kicker}</span>
        <span className="sec-rule" />
      </div>
      <h3 className="m-0 text-[22px] font-bold tracking-tight">{title}</h3>
    </div>
  );
}
