import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/style.css";
import { Button, CheckPill, Chip, ColorBar, Dots, LiveDot, Logo, SegToggle, Switch } from "@gmap/ui";
import { htmlLang, LANG_NAME, UI_LANG_KEY, UI_LANGS, type UiLang } from "@/lib/i18n";
import { useT } from "@/lib/i18n/useT";
import { ADVANCED_DEFAULT, ADVANCED_KEY } from "@/lib/advanced";
import { clearLocalCache, NO_CACHE_KEY } from "@/lib/noCache";
import { MAPS_ACCOUNT_KEY, mapsHome } from "@/lib/account";

function FlagSwitch({ flag, label, note, def = false, cloud, onChange }: { flag: string; label: string; note?: string; def?: boolean; cloud?: boolean; onChange?: (on: boolean, byUser: boolean) => void }) {
  const { t } = useT();
  // null until storage answers: the switch appears in its stored position instead of sliding there
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { browser.storage.local.get(flag).then((v) => { const x = !!(v[flag] ?? def); setOn(x); onChange?.(x, false); }); }, [flag, def]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: boolean) => { setOn(v); browser.storage.local.set({ [flag]: v }); onChange?.(v, true); };
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] border-2 border-dashed border-ink bg-white px-3 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="font-mono text-[11px] font-bold tracking-wider uppercase">{label}</span>
        {note && <span className="text-[11px] leading-snug text-muted">{note}</span>}
      </span>
      {on == null
        ? <span className="h-9 w-[72px] flex-none" aria-hidden />
        : <Switch on={on} onChange={set} label={label} onText={t.common.on} offText={t.common.off} cloud={cloud} />}
    </div>
  );
}

function Popup() {
  const { lang, t } = useT();
  useEffect(() => { document.documentElement.lang = htmlLang(lang); }, [lang]);
  const setLang = (l: UiLang) => browser.storage.local.set({ [UI_LANG_KEY]: l });
  // everything happens on Google Maps itself; open it in the account the user last used there
  const openMaps = async () => {
    const { [MAPS_ACCOUNT_KEY]: au } = await browser.storage.local.get(MAPS_ACCOUNT_KEY);
    await browser.tabs.create({ url: mapsHome(au as string | undefined) });
    window.close();
  };
  // dev only: 「キャッシュなし」 shows while Dev mode is on; turning it on clears this browser's cache
  const [dev, setDev] = useState(false);
  // The Dev mode switch is for us, not for users: it shows in dev builds, while Dev mode is already on,
  // or after 5 clicks on the logo.
  const [showDev, setShowDev] = useState(import.meta.env.DEV);
  const [logoTaps, setLogoTaps] = useState(0);
  useEffect(() => { browser.storage.local.get("devMode").then((v) => { if (v.devMode === true) setShowDev(true); }); }, []);
  const onLogo = () => { const n = logoTaps + 1; setLogoTaps(n); if (n >= 5) setShowDev(true); };
  const [cleared, setCleared] = useState<number | null>(null);
  const onNoCache = async (on: boolean, byUser: boolean) => { if (!on) setCleared(null); else if (byUser) setCleared(await clearLocalCache()); };

  return (
    <div className="flex flex-col">
      <ColorBar />
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center gap-2.5">
          <span onClick={onLogo}><Logo width={36} height={36} /></span>
          <span className="header-brand-copy">Joren<small>for Google Maps</small></span>
          <Chip variant="ink" className="ml-auto">Beta</Chip>
        </header>

        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] font-bold tracking-wider uppercase">{t.popup.language}</span>
          <SegToggle value={lang} onChange={setLang} options={UI_LANGS.map((l) => ({ value: l, label: LANG_NAME[l] }))} />
        </div>

        <div className="card tone-yellow min-h-0 gap-2 p-5">
          <div className="flex items-center justify-between">
            <Chip><LiveDot /> Ready</Chip>
            <Dots className="h-5 w-auto" />
          </div>
          <p className="mt-3 mb-0 text-2xl font-bold leading-tight tracking-tight">{t.popup.tagline1}<br />{t.popup.tagline2}</p>
          <p className="card-note">{t.popup.note}</p>
        </div>

        <div className="flex flex-wrap gap-1.5 [&_.check-pill]:text-xs">
          <CheckPill>{t.popup.pillLocal}</CheckPill>
          <CheckPill>{t.popup.pillNoLogin}</CheckPill>
        </div>

        <Button variant="primary" className="justify-between" onClick={openMaps}>{t.popup.openMaps}</Button>
        <FlagSwitch flag={ADVANCED_KEY} def={ADVANCED_DEFAULT} label={t.popup.advanced} note={t.popup.advancedNote} cloud />
        {showDev && <FlagSwitch flag="devMode" label="Dev mode" onChange={setDev} />}
        {showDev && dev && <FlagSwitch flag={NO_CACHE_KEY} label={t.popup.noCache} note={cleared != null ? t.popup.noCacheCleared(cleared) : t.popup.noCacheNote} onChange={onNoCache} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
