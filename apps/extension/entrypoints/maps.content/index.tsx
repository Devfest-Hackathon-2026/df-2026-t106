import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AskPin, Bubble, ToolDock, type DockTool } from "@gmap/ui";
import "./style.css";
import { StoreHealth } from "./Health";
import { QuestionFinder } from "./QuestionFinder";
import { PlaceAnswers } from "./PlaceAnswers";
import { PlaceDishes } from "./PlaceDishes";
import { useLauncherPos } from "./parts";
import { isPlacePage } from "@/lib/scraper";
import { rememberAccount } from "@/lib/account";
import { htmlLang } from "@/lib/i18n";
import { useT } from "@/lib/i18n/useT";

const FONTS = [
  ["Google Sans", 400, "google-sans-regular"], ["Google Sans", 700, "google-sans-bold"],
  ["Google Sans Code", 400, "google-sans-code-regular"], ["Google Sans Code", 700, "google-sans-code-bold"],
] as const;

/** @font-face is ignored inside shadow roots, so register the faces on the host page. */
function registerFonts() {
  const css = FONTS.map(([fam, w, file]) =>
    `@font-face{font-family:"${fam}";font-weight:${w};font-display:swap;src:url("${browser.runtime.getURL(`/fonts/${file}.ttf` as any)}") format("truetype")}`).join("");
  const style = document.createElement("style");
  style.dataset.gmap = "fonts";
  style.textContent = css;
  document.head.append(style);
}

type ToolId = "ask" | "review";

/** Re-render when the Maps page kind changes (SPA navigation has no event we can hook). */
function usePlacePage() {
  const [on, setOn] = useState(isPlacePage());
  useEffect(() => { const t = setInterval(() => setOn(isPlacePage()), 700); return () => clearInterval(t); }, []);
  return on;
}

/** Tool dock on the map's right edge; each tool owns one panel, one panel open at a time. */
function Root() {
  const [open, setOpen] = useState<ToolId | null>(null);
  const [askCount, setAskCount] = useState(0);
  const [layers, setLayers] = useState(true);
  useEffect(() => { browser.storage.local.get("layersOn").then((v) => { if (v.layersOn === false) setLayers(false); }); }, []);
  const toggleLayers = (on: boolean) => { setLayers(on); browser.storage.local.set({ layersOn: on }); };
  const onPlace = usePlacePage();
  const placePos = useLauncherPos(isPlacePage);
  const close = () => setOpen(null);
  useEffect(() => { if (open === "review" && !onPlace) setOpen(null); }, [onPlace, open]);
  const { lang, t } = useT();
  const tools: DockTool[] = [
    { id: "ask", label: t.dock.ask, icon: <AskPin />, active: open === "ask", badge: askCount || undefined, title: t.dock.askTitle },
    { id: "review", label: t.dock.review, icon: <Bubble />, active: open === "review", disabled: !onPlace, title: onPlace ? t.dock.reviewTitle : t.dock.reviewDisabled },
  ];
  return (
    // lang decides CJK glyph shapes and the :lang() font stack (DESIGN.md §3)
    <div lang={htmlLang(lang)} className="font-sans text-ink [font-size:14px] leading-normal">
      <ToolDock tools={tools} toggle={{ on: layers, onChange: toggleLayers, title: layers ? t.dock.layersHide : t.dock.layersShow }} onSelect={(id) => setOpen((cur) => (cur === id ? null : (id as ToolId)))} className="fixed top-[72px] right-4 z-[2147483000]" />
      {placePos && (
        <div className="pointer-events-none fixed z-[2147483000] flex w-[300px] flex-col items-start gap-2 [&>*]:pointer-events-auto" style={{ left: placePos.left, top: placePos.top }}>
          <PlaceAnswers />
          <PlaceDishes />
        </div>
      )}
      <StoreHealth open={open === "review"} onClose={close} />
      <QuestionFinder layers={layers} open={open === "ask"} onClose={close} onCount={setAskCount} />
    </div>
  );
}

export default defineContentScript({
  matches: ["https://www.google.com/maps/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    registerFonts();
    // switching accounts reloads Maps, so once per page load is enough
    rememberAccount();
    const ui = await createShadowRootUi(ctx, {
      name: "gmap-analyzer",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount(container) {
        const root = createRoot(container);
        root.render(<Root />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();
  },
});
