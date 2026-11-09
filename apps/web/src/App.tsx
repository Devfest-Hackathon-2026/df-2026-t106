import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown, AskBar, AskPin, Asterisk, Bowl, Brace, Bubble, Card, CheckPill, Chip, ColorBar, CopyField, Dots, Globe, HalfMoon,
  LinkButton, LiveDot, Logo, LongArrow, Marquee, Meter, Pin, SectionHeading, Slashes, StepRail, Switch, TabCard, Tile,
  type Step,
} from "@gmap/ui";

/*
 * Two pages (Japanese), same design as the Claude Design mockup "Joren ウェブサイト（再デザイン）":
 *  - "/"      the story for judges: hero, demo video, 権八 vs 道玄坂 漁, general-AI comparison, how it works, validation.
 *  - "/start" the guide for testers: install, requirements, try it, FAQ.
 * Firebase Hosting rewrites every path to index.html, so the path alone picks the page.
 * The extension is not on the Chrome Web Store: the site hands out the ZIP built by `npm run zip:ext` (see vite.config.ts).
 * Requirements follow developer.chrome.com/docs/ai/get-started (checked 2026-11-07).
 * Numbers come from our own measurements (2026-11-09 in Shibuya for the demo and the 権八 / 道玄坂 漁 comparison; 2026-11-08 for the general-AI comparison).
 */
const REPO_URL = "https://github.com/Devfest-Hackathon-2026/df-2026-t106";
const DEMO_VIDEO = "/video/joren-demo.mp4"; // 1:45, H.264 1080p, no sound: submission/joren-demo-shibuya-v2.mp4 (already +faststart)
const MAPS_URL = "https://www.google.com/maps/@35.6578,139.6978,17z?hl=ja"; // 渋谷駅西側: the demo's view
const EXAMPLES = ["静かなデート", "一人で電源が使えるカフェ", "深夜に一人でごはん"]; // = the panel's examples (i18n/ja.ts)

type Page = "top" | "start";
const TOP_NAV = [["デモ", "#demo"], ["わかること", "#result"], ["しくみ", "#how"], ["検証", "#proof"], ["はじめかた", "/start"]] as const;
const START_NAV = [["トップ", "/"], ["インストール", "#install"], ["動作環境", "#requirements"], ["使い方", "#try"], ["FAQ", "#faq"]] as const;

const build = __EXT__.built ? `v${__EXT__.version} · ${__EXT__.built}` : `v${__EXT__.version}`;
const dotted = "[background-image:radial-gradient(#1e1e1e22_1.2px,transparent_1.2px)] [background-size:14px_14px]";
const textLink = "font-bold text-ink underline decoration-2 underline-offset-2";

function DownloadButton({ size = "lg", children = "拡張機能をダウンロード" }: { size?: "sm" | "lg"; children?: ReactNode }) {
  return <LinkButton href={__EXT__.href} download variant="primary" size={size}>{children}</LinkButton>;
}

function Header({ page }: { page: Page }) {
  const nav = page === "top" ? TOP_NAV : START_NAV;
  return (
    <div className="site-header">
      <div className="header-bar">
        <a href={page === "top" ? "#top" : "/"} className="header-brand text-ink no-underline">
          <Logo width={36} height={36} />
          <span className="header-brand-copy">Joren<small>for Google Maps</small></span>
        </a>
        <nav className="header-nav">
          {nav.map(([l, h]) => <a key={h} href={h} className={h === "/start" ? "bg-yellow-soft" : undefined}>{l}</a>)}
        </nav>
        <div className="header-actions">
          <DownloadButton size="sm">ダウンロード</DownloadButton>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ top page ------------------------------------------------------------------ */

const ASK_STEPS: Step[] = [
  { label: "理解", sub: "ランチ + 和食", state: "done" },
  { label: "検索", sub: "388 店", state: "done" },
  { label: "判断", sub: "26 店に印", state: "done" },
  { label: "表示", sub: "≤ ¥1,000", state: "active" },
];
const PICKS = [
  { mark: "A", tone: "bg-yellow-soft", name: "権八", price: "¥900 · 焼き鳥丼", pill: "外国語 73%", bad: true },
  { mark: "B", tone: "bg-green-soft", name: "道玄坂 漁", price: "¥1,000 · 十八番丼", pill: "日本語 97%", bad: false },
];

/** The product as one card: the sentence, the four steps and two of the places it marked (the demo's Shibuya run). */
function AskPanel() {
  const [q, setQ] = useState("1000円以下の和食ランチ");
  return (
    <div className={`flex flex-col gap-4 rounded-[28px] border-2 border-ink bg-white p-[22px] ${dotted}`}>
      <div className="flex items-center justify-between gap-3">
        <Chip>マップに聞く</Chip>
        <span className="font-mono text-xs font-bold text-muted">渋谷駅 西側</span>
      </div>
      <AskBar value={q} onChange={setQ} onSubmit={() => { window.location.href = "/start#try"; }} placeholder="ひと言で聞く" label="試し方を見る" />
      <StepRail steps={ASK_STEPS} />
      <div className="flex flex-col gap-2.5">
        {PICKS.map((p) => (
          <div key={p.mark} className="flex flex-wrap items-center gap-2.5 rounded-[18px] border-2 border-ink bg-white px-3.5 py-3">
            <span className={`grid h-[30px] w-[30px] flex-none place-items-center rounded-full border-2 border-ink font-mono text-xs font-bold ${p.tone}`}>{p.mark}</span>
            <span className="flex min-w-[120px] flex-1 flex-col gap-0.5">
              <b className="text-base">{p.name}</b>
              <span className="font-mono text-xs font-bold text-body">{p.price}</span>
            </span>
            <CheckPill bad={p.bad}>{p.pill}</CheckPill>
          </div>
        ))}
      </div>
      <p className="m-0 text-[13px] leading-relaxed text-body">388 店を判断して 26 店に印。どちらも 1,000 円以下ですが、クチコミの言語がまったく違います。</p>
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-clip pt-[calc(var(--header-h)+clamp(24px,3.4vw,48px))] pb-[clamp(40px,5vw,72px)]">
      <div className="container flex flex-col gap-[clamp(24px,3vw,40px)]">
        <div className="flex items-center gap-[clamp(12px,2vw,26px)]">
          <Dots className="h-8 w-auto flex-none" />
          <span className="flex h-[clamp(42px,3.6vw,48px)] items-center whitespace-nowrap rounded-full border-2 border-ink bg-yellow-half px-[clamp(16px,2vw,24px)] font-mono text-[clamp(11px,1vw,13px)] font-bold tracking-[.08em]">
            DEVFEST HACKATHON 2026 · 観光
          </span>
          <LongArrow className="min-w-12 flex-auto max-md:hidden" />
          <Brace className="text-[clamp(15px,1.4vw,18px)] font-bold max-md:hidden">Chrome Extension</Brace>
        </div>

        <div className="grid items-stretch gap-[clamp(24px,3vw,48px)] lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col justify-between gap-8">
            <h1 className="m-0 text-[clamp(48px,7.4vw,112px)] font-bold leading-[.95] tracking-[-.045em]">
              <span className="block text-blue">一見さんでも、</span>
              <span className="my-[.08em] flex items-center gap-[.22em] text-[.42em] font-normal tracking-[-.02em]">
                for Google Maps
                <span className="inline-block rounded-full border-2 border-ink bg-blue-soft px-[.5em] pt-[.12em] pb-[.16em] font-mono text-[.5em] font-bold tracking-normal">2026</span>
              </span>
              <span className="block">常連の店へ。</span>
            </h1>
            <div className="flex flex-col gap-[22px]">
              <p className="m-0 max-w-[30em] text-[clamp(18px,1.6vw,22px)] font-bold leading-[1.6]">
                はじめての街でも、地元の人が通うお店がわかる。Google マップにひと言で聞くと、パソコンの中の Gemini Nano がお店を 1 軒ずつ確かめ、理由つきで地図に印をつけます。
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <DownloadButton />
                <LinkButton href="#demo" size="lg" icon={<ArrowDown />}>デモを見る</LinkButton>
              </div>
              <p className="m-0 inline-flex flex-wrap items-center gap-2.5 font-mono text-[12.5px] font-bold tracking-[.04em]">
                <LiveDot /> {build} · 無料・ログイン不要 · <a href="/start" className={textLink}>はじめかた</a>
              </p>
            </div>
          </div>
          <AskPanel />
        </div>

        <ol className="relative m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
          <li className="absolute top-1/2 right-0 left-0 h-0.5 bg-ink max-sm:hidden" aria-hidden />
          <li className="relative"><Tile tone="blue" step="01" value="理解" sub="UNDERSTAND" label="文を検証済みの条件に置き換え" meta="GEMINI NANO" /></li>
          <li className="relative"><Tile tone="red" step="02" value="検索" sub="SEARCH" label="地図の周辺のお店を集める" meta="GOOGLE MAPS" /></li>
          <li className="relative"><Tile tone="yellow" step="03" value="判断" sub="JUDGE" label="店舗情報とクチコミを 1 軒ずつ" meta="ON-DEVICE" /></li>
          <li className="relative"><Tile tone="green" step="04" value="表示" sub="SHOW" label="当てはまるお店に印と理由" meta="NO LOGIN" /></li>
        </ol>
      </div>
    </section>
  );
}

const CHAPTERS = [
  { t: "0:00", s: 0, tone: "bg-blue-soft", title: "ひと言で聞く", sub: "Gemini Nano が文を条件に置き換える" },
  { t: "0:28", s: 28, tone: "bg-red-soft", title: "印と理由を見る", sub: "388 店を判断して 26 店に印。黄色は Gemini Nano がクチコミを読んだ判断" },
  { t: "0:47", s: 47, tone: "bg-yellow-soft", title: "お店の今", sub: "クチコミの急増、警告サイン、外国語の割合" },
  { t: "1:12", s: 72, tone: "bg-green-soft", title: "地元の人が通うお店", sub: "道玄坂 漁：評価は安定、クチコミの 97% が日本語" },
];

/** The demo video plays in place: the yellow button starts it, a chapter card jumps to its time. */
function Demo() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const playAt = (sec: number) => {
    const v = video.current;
    if (!v) return;
    const seek = () => { v.currentTime = sec; };
    // with preload="none" the time can only be set once the metadata is in
    if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
    v.play().catch(() => {});
  };
  return (
    <section id="demo" className="section">
      <div className="container">
        <SectionHeading
          index="01" kicker="Demo"
          title={<>2 分で、<br />使い方がわかる。</>}
          desc="はじめて東京に来た日、渋谷で「1000円以下の和食ランチ」と聞いてみました。画面はすべて実際の動作の録画です（編集は待ち時間のカットと、画面に「早送り」と出る区間だけ）。"
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="relative aspect-video overflow-hidden rounded-[36px] border-2 border-ink bg-ink">
            <video ref={video} src={DEMO_VIDEO} poster="/img/demo-poster.webp" preload="none" playsInline muted controls={started}
              onPlay={() => setStarted(true)} className="block h-full w-full object-contain"
              aria-label="デモ動画：渋谷で「1000円以下の和食ランチ」と聞く（1 分 45 秒、音声なし、字幕つき）" />
            {!started && (
              <>
                <div className="pointer-events-none absolute top-5 left-5"><Chip variant="ink">Video 1:45</Chip></div>
                <button type="button" onClick={() => playAt(0)} aria-label="デモ動画を再生"
                  className="absolute top-1/2 left-1/2 grid h-[104px] w-[104px] -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-2 border-ink bg-yellow-soft transition-colors hover:bg-yellow-half">
                  <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden><path d="M8 5l11 7-11 7z" fill="#1e1e1e" stroke="#1e1e1e" strokeWidth={2.5} strokeLinejoin="round" /></svg>
                </button>
              </>
            )}
          </div>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {CHAPTERS.map((c) => (
              <li key={c.t} className="flex flex-1">
                <button type="button" onClick={() => playAt(c.s)} aria-label={`${c.t} から再生：${c.title}`}
                  className={`flex flex-1 cursor-pointer items-center gap-4 rounded-[22px] border-2 border-ink px-5 py-[18px] text-left transition-colors hover:border-dashed ${c.tone}`}>
                  <span className="shrink-0 whitespace-nowrap rounded-full border-[1.5px] border-ink bg-white px-[11px] py-[5px] font-mono text-xs font-bold">▶ {c.t}</span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <b className="text-xl">{c.title}</b>
                    <span className="text-sm text-body">{c.sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const STORES = [
  {
    name: "権八", bad: true, status: "要注意", price: "¥900 · 焼き鳥丼", img: "/img/gonpachi-store-now.webp",
    alt: "権八の「お店の今」：要注意、2026 年 9〜10 月にクチコミが急増",
    share: 73, tone: "red" as const, shareNote: "外国語のクチコミ（246 件中。英語 61%、4 言語）",
    stats: [["4.1×", "30 日で 61 件。ふだんのペースの 4.1 倍に急増"], ["15", "接客への不満（直近 8 件）。想定外の料金には「Tourist trap. Avoid.」"]],
  },
  {
    name: "道玄坂 漁", bad: false, status: "良好", price: "¥1,000 · 十八番丼", img: "/img/ryo-store-now.webp",
    alt: "道玄坂 漁の「お店の今」：良好、評価は安定",
    share: 3, tone: "green" as const, shareNote: "外国語のクチコミ（38 件中 1 件。37 件が日本語）",
    stats: [["4.35", "直近 180 日の評価。以前は 4.32 で安定し、急増もなし"], ["0", "最近の警告サイン（以前に 1 件だけ）"]],
  },
];

function Result() {
  return (
    <section id="result" className="section border-y-2 border-ink bg-yellow-soft">
      <div className="container">
        <SectionHeading
          index="02" kicker="Result"
          title={<>2 軒の違いが、<br />数字で見える。</>}
          desc="どちらも渋谷駅の近くで、平日ランチは 1,000 円以下の和食。「お店の今」で並べると、観光客の多いお店と、地元の人が通うお店の違いが数字で見えます。"
        />
        <div className="grid gap-4 lg:grid-cols-2">
          {STORES.map((s) => (
            <article key={s.name} className="flex min-w-0 flex-col gap-5 rounded-[28px] border-2 border-ink bg-white p-[26px]">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="m-0 text-[28px] font-bold">{s.name}</h3>
                <CheckPill bad={s.bad}>{s.status}</CheckPill>
                <span className="ml-auto font-mono text-sm font-bold text-body">{s.price}</span>
              </div>
              <div className="flex flex-wrap items-start gap-6">
                <img src={s.img} alt={s.alt} width={366} height={598} loading="lazy"
                  className="h-auto w-[200px] flex-none rounded-[22px] border-2 border-ink bg-white" />
                <div className="flex min-w-[220px] flex-1 flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <span className="text-[56px] font-bold leading-none tracking-[-.03em]">{s.share}%</span>
                    <Meter value={s.share} max={100} tone={s.tone} label={`外国語のクチコミ ${s.share}%`} />
                    <span className="text-sm leading-relaxed text-body">{s.shareNote}</span>
                  </div>
                  {s.stats.map(([v, note]) => (
                    <div key={v} className="flex flex-col gap-1">
                      <span className="text-[40px] font-bold leading-none">{v}</span>
                      <span className="text-sm leading-relaxed text-body">{note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-5 mb-0 font-mono text-xs leading-relaxed text-body">2026 年 11 月 9 日、渋谷駅西側での実測。画面は Joren の「お店の今」。警告サインの分類は拡張機能（クラウド）。</p>
      </div>
    </section>
  );
}

const AI_ROWS = [
  {
    name: "佐五右衛門", how: "日本語で 3 回聞いて、3 回とも推薦", lang: "ja",
    claim: "「平日のランチタイムは…連日行列ができる人気店」「600円〜900円台」",
    tag: "GOOGLE マップ + JOREN", fact: "17:00 開店", note: "毎日 17:00〜23:30 の営業。Joren の判定も「昼は営業していない」",
  },
  {
    name: "魚べい 渋谷道玄坂店", how: "英語で聞いた回答", lang: "en",
    claim: "\"a staple for busy salarymen, local students, and workers\"",
    tag: "JOREN「お店の今」", fact: "89%", note: "外国語のクチコミ（6 言語。日本語は 11%）",
  },
];

function VsAi() {
  return (
    <section id="ai" className="section">
      <div className="container">
        <SectionHeading
          index="03" kicker="vs General AI"
          title={<>汎用 AI に<br />聞くと？</>}
          desc="同じ質問を Gemini アプリ（自動モード）に 5 回しました。挙がったお店を Google マップと Joren で確かめると、もっともらしい理由と事実が食い違うことがあります。"
        />
        <div className="flex flex-col gap-4">
          {AI_ROWS.map((r) => (
            <div key={r.name} className="flex flex-wrap items-center gap-x-7 gap-y-5 rounded-[28px] border-2 border-ink bg-white px-7 py-6">
              <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                <h3 className="m-0 text-[26px] font-bold">{r.name}</h3>
                <span className="text-sm text-body">{r.how}</span>
              </div>
              <div className="flex min-w-[300px] flex-[3] flex-col gap-2.5">
                <Chip className="bg-blue-soft">Gemini の回答</Chip>
                <p lang={r.lang} className="m-0 text-xl leading-relaxed">{r.claim}</p>
              </div>
              <span aria-hidden className="grid h-14 w-14 flex-none place-items-center rounded-full border-2 border-ink bg-yellow-soft text-2xl font-bold">→</span>
              <div className="flex min-w-[260px] flex-[2] flex-col gap-1.5">
                <Chip className="bg-green-soft">{r.tag}</Chip>
                <span className="text-5xl font-bold leading-[1.05] tracking-[-.02em]">{r.fact}</span>
                <span className="text-sm leading-relaxed text-body">{r.note}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="m-0 rounded-full border-2 border-ink bg-yellow-soft px-6 py-3 text-[clamp(16px,1.5vw,20px)] font-bold">
            汎用 AI は有名店の知識。Joren は地図の上で数えて、根拠と一緒に見せる。
          </p>
          <span className="font-mono text-xs text-body">2026-11-08 実施。回答は実行ごとに変わります。</span>
        </div>
      </div>
    </section>
  );
}

/** One card per tool (copy follows the extension's ja.ts). */
const FEATURES = [
  { label: "01 · Ask", art: <AskPin className="h-12 w-12" />, name: "マップに聞く", runs: "Gemini Nano · PC 内", dashed: false, note: "ひと言で条件を指定すると、当てはまるお店を地図に番号つきの印で示します。印に触れると理由（店舗情報やクチコミの引用）が見られます。" },
  { label: "02 · Store now", art: <Bubble className="h-12 w-12" />, name: "お店の今", runs: "PC 内で計算", dashed: false, note: "直近 24 か月・最大 300 件のクチコミから、評価の推移、客単価の変化、クチコミの急増、クチコミの言語（地元客の目安）を調べます。" },
  { label: "03 · Dishes", art: <Bowl className="h-12 w-12" />, name: "このお店で頼むなら", runs: "AI 不使用", dashed: false, note: "クチコミでよく話題になる料理を、Google マップ上のメニューと照らし合わせ、価格つきで並べます。" },
  { label: "04 · Warnings", art: <Asterisk className="h-11 w-11" />, name: "警告サイン", runs: "Vertex AI · 初期設定オフ", dashed: true, note: "値上げ・衛生・接客などの不満をクチコミから分類します。「拡張機能（クラウド）」をオンにしたときだけ動きます。" },
];

const BASIC = [
  { tag: "AI", title: "Gemini Nano（Chrome に内蔵）", note: "ひと言の文を検証済みの条件に置き換え、クチコミの引用を 1 件ずつ判断します。モデルは Chrome が用意します。" },
  { tag: "MAP", title: "Google マップの情報", note: "店舗の属性・メニュー・クチコミを Google マップから取得します。旅行者がもう使っている場所で答えます。" },
  { tag: "RULE", title: "規則", note: "評価の推移、クチコミの急増、日本語のクチコミの割合（地元客の目安）。" },
];
const CLOUD = [
  ["Vertex AI", "gemini-embedding-001 と自前の分類器で、クチコミの警告を分類"],
  ["Cloud Run", "分類 API"],
  ["Cloud Firestore", "ほかの人の判断を共有し、多数決でまとめる"],
  ["Firebase", "匿名認証と、サイト・拡張機能の配布"],
];

function How() {
  const [cloud, setCloud] = useState(false);
  return (
    <section id="how" className="section border-y-2 border-ink bg-blue-soft">
      <div className="container">
        <SectionHeading
          index="04" kicker="How it works"
          title={<>判断は、<br />パソコンの中で。</>}
          desc="判断はすべて、Chrome に内蔵された Gemini Nano と規則で、あなたのパソコンの中で行います。当チームのクラウドを使う拡張機能は、ポップアップのスイッチをオンにしたときだけ動きます。"
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <Card key={f.label} tone="white" label={f.label} art={f.art}>
              <div className="card-value text-[clamp(22px,2vw,26px)] font-bold leading-tight">{f.name}</div>
              <p className="card-note">{f.note}</p>
              <Chip variant={f.dashed ? "dashed" : undefined} className="relative z-[1]">{f.runs}</Chip>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-5 rounded-[36px] border-2 border-ink bg-green-soft p-7">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border-2 border-ink bg-white px-4 py-1.5 text-lg font-bold">基本機能</span>
              <span className="font-mono text-xs font-bold tracking-[.12em]">ON-DEVICE · パソコンの中</span>
            </div>
            {BASIC.map((b) => (
              <div key={b.tag} className="flex items-start gap-4">
                <span className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full border-2 border-ink bg-white font-mono text-[13px] font-bold">{b.tag}</span>
                <span className="flex flex-col gap-1">
                  <b className="text-xl">{b.title}</b>
                  <span className="text-[15px] leading-[1.7] text-body">{b.note}</span>
                </span>
              </div>
            ))}
            <div className="mt-auto flex flex-wrap gap-2">
              <CheckPill>当チームのクラウドへの送信ゼロ</CheckPill>
              <CheckPill>ログイン不要</CheckPill>
              <CheckPill>専用 GPU なしのノート PC で動く</CheckPill>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-4 rounded-[36px] border-2 border-dashed border-ink bg-white p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="rounded-full border-2 border-ink bg-yellow-soft px-4 py-1.5 text-lg font-bold">拡張機能（クラウド）</span>
              <Switch on={cloud} onChange={setCloud} label="拡張機能（クラウド）" cloud onText="オン" offText="オフ" />
            </div>
            <span className="font-mono text-xs font-bold tracking-[.12em]">初期設定オフ · 東京リージョン</span>
            {CLOUD.map(([k, v]) => (
              <p key={k} className="m-0 text-[15px] leading-[1.7]"><b>{k}</b>　{v}</p>
            ))}
            <p className="mt-auto mb-0 border-t-2 border-dashed border-ink pt-3 text-sm leading-[1.7] text-body">保存するのは判断結果だけ。クチコミの本文は保存しません。</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const PROOF = [
  { tone: "blue", label: "01 · Intent", value: "24/24", note: "ひと言 → 条件の置き換えが正解（Gemini Nano と規則の併用、約 1.5 秒。Nano だけなら 21/24）" },
  { tone: "red", label: "02 · Speed", value: <>12<span className="text-2xl"> 秒</span></>, note: "渋谷で聞いてから、最初の 1 件が地図に出るまで（デモ動画の実測。Nano の準備後）" },
  { tone: "yellow", label: "03 · Warnings", value: "0.80", note: "クチコミ警告分類の精度（macro AP、910 件）。分類器なしは 0.62" },
  { tone: "green", label: "04 · Burst rule", value: "5/5", note: "事前に疑わしいとした 5 店をすべて検出し、正常な 5 店では 0 件" },
] as const;

function Proof() {
  return (
    <section id="proof" className="section">
      <div className="container">
        <SectionHeading
          index="05" kicker="Validation"
          title={<>実データで、<br />測りました。</>}
          desc="精度と速さは、池袋と渋谷のお店の実データで測っています。測定は Chrome 156、Intel Arc 140V（専用 GPU なし）、2026 年 10〜11 月。"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROOF.map((p) => (
            <Card key={p.label} tone={p.tone} label={p.label}>
              <div className="card-value text-[clamp(56px,5vw,76px)] font-bold leading-none tracking-[-.04em]">{p.value}</div>
              <p className="card-note">{p.note}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function TopCta() {
  return (
    <section className="relative overflow-clip border-b-2 border-ink bg-blue py-[clamp(110px,14vw,200px)] text-center">
      <Globe className="absolute top-[12%] left-[6%] w-[clamp(60px,9vw,130px)] max-sm:hidden" />
      <HalfMoon className="absolute right-[8%] bottom-[14%] w-[clamp(36px,5vw,70px)] max-sm:hidden" />
      <Asterisk className="absolute top-[18%] right-[14%] w-[clamp(36px,5vw,64px)] max-sm:hidden" />
      <div className="container">
        <Chip>Get started</Chip>
        <h2 className="mx-auto mt-6 mb-8 max-w-[14em] text-[clamp(40px,6.4vw,96px)] font-bold leading-[1.05] tracking-[-.035em] text-white">
          一見さんでも、<br />常連の店へ。
        </h2>
        <div className="flex flex-wrap justify-center gap-3">
          <LinkButton href="/start" variant="primary" size="lg">はじめかたを見る</LinkButton>
          {REPO_URL && <LinkButton href={REPO_URL} target="_blank" rel="noreferrer" size="lg">GitHub</LinkButton>}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- start page ----------------------------------------------------------------- */

function StartHero() {
  const tiles = [
    { href: "#install", tone: "yellow", step: "01", value: "インストール", sub: "INSTALL", label: "ZIP を Chrome に読み込む", meta: "4 STEPS" },
    { href: "#requirements", tone: "blue", step: "02", value: "動作環境", sub: "REQUIREMENTS", label: "Gemini Nano が動くパソコン", meta: "CHROME 138+" },
    { href: "#try", tone: "green", step: "03", value: "使ってみる", sub: "TRY IT", label: "渋谷や池袋の地図でひと言", meta: "GOOGLE MAPS" },
    { href: "#faq", tone: "red", step: "04", value: "FAQ", sub: "TROUBLESHOOT", label: "うまく動かないとき", meta: "6 Q&A" },
  ] as const;
  return (
    <section id="top" className="relative overflow-clip pt-[calc(var(--header-h)+clamp(32px,4vw,64px))] pb-[clamp(48px,6vw,88px)]">
      <div className="container flex flex-col gap-8">
        <div className="flex items-center gap-4">
          <Chip variant="ink">Getting started</Chip>
          <LongArrow className="min-w-12 flex-auto" />
          <Dots className="h-7 w-auto flex-none" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
          <h1 className="m-0 min-w-0 flex-[999_1_560px] text-[clamp(44px,6.4vw,96px)] font-bold leading-none tracking-[-.04em]">
            <span className="text-blue">1 分で入れて、</span><br />地図でひと言。
          </h1>
          <p className="m-0 max-w-[30em] flex-[1_1_340px] text-[17px] leading-[1.95] text-body">
            Chrome ウェブストアには未公開のため、ZIP を Chrome に読み込んで使います。基本機能はログイン不要で、当チームのクラウドには何も送りません。専用 GPU のないノート PC でも動きます。
          </p>
        </div>
        <ol className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
          {tiles.map((t) => (
            <li key={t.href}>
              <a href={t.href} className="block text-ink no-underline">
                <Tile tone={t.tone} step={t.step} value={t.value} sub={t.sub} label={t.label} meta={t.meta} />
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Numbered instruction rows (static): yellow number circle, bold step, optional detail and extra content. */
function Steps({ items }: { items: { title: ReactNode; sub?: ReactNode; extra?: ReactNode }[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-3 rounded-[20px] border-2 border-ink bg-white p-3.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full border-2 border-ink bg-yellow font-mono text-xs font-bold">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5 pt-1">
            <span className="text-[15px] font-bold leading-snug">{s.title}</span>
            {s.sub && <span className="text-[13px] leading-relaxed text-body">{s.sub}</span>}
            {s.extra && <div className="mt-1 flex flex-wrap items-center gap-2">{s.extra}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Install() {
  return (
    <section id="install" className="section border-y-2 border-ink bg-yellow-soft">
      <div className="container">
        <SectionHeading
          index="01" kicker="Install"
          title={<>1 分で、<br />インストール。</>}
          desc="ZIP をダウンロードして展開し、Chrome の拡張機能のページから読み込みます。"
        />
        <TabCard tab="4 Steps">
          <div className="grid gap-6 p-[clamp(18px,3vw,36px)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className={`relative flex min-h-[300px] flex-col items-start justify-end gap-4 rounded-[24px] border-2 border-ink bg-blue-soft p-6 ${dotted}`}>
              <Chip className="absolute top-4 left-4">ZIP{__EXT__.kb ? ` · ${__EXT__.kb} KB` : ""}</Chip>
              <Brace className="absolute top-4 right-5 text-5xl"><Pin className="h-12 w-auto" color="#4285f4" /></Brace>
              <div>
                <div className="text-[clamp(26px,2.6vw,36px)] font-bold leading-tight tracking-[-.02em]">Joren</div>
                <div className="mt-1 font-mono text-xs font-bold tracking-[.08em]">{build} · CHROME 138+</div>
              </div>
              <DownloadButton>ZIP をダウンロード</DownloadButton>
            </div>
            <div className="flex flex-col gap-4">
              <Steps items={[
                { title: "ZIP をダウンロードして展開する", sub: "Windows：右クリック →「すべて展開」　Mac：ダブルクリック" },
                { title: "Chrome で拡張機能のページを開く", sub: "アドレスバーに貼り付けて Enter（Web ページからは直接開けません）", extra: <CopyField value="chrome://extensions" label="コピー" doneLabel="コピーしました" /> },
                { title: "右上の「デベロッパー モード」をオンにする" },
                { title: "「パッケージ化されていない拡張機能を読み込む」で、展開したフォルダを選ぶ", sub: "manifest.json が入っているフォルダです。読み込んだら完了です。" },
              ]} />
              <p className="m-0 text-[13px] leading-relaxed text-body">
                ヒント：ツールバーのパズル型アイコンからピン留めすると、ポップアップで表示言語（日本語 / 中文 / English）や「拡張機能（クラウド）」をすぐ切り替えられます。
              </p>
            </div>
          </div>
        </TabCard>
      </div>
    </section>
  );
}

function Requirements() {
  return (
    <section id="requirements" className="section">
      <div className="container">
        <SectionHeading
          index="02" kicker="Requirements"
          title={<>Gemini Nano が<br />動くパソコンで。</>}
          desc="クチコミを読む判断は、Chrome に内蔵された Gemini Nano があなたのパソコン上で行います。モデルは初回に Chrome が自動でダウンロードします。"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card tone="blue" label="Chrome">
            <div className="card-value text-[clamp(30px,3vw,44px)] font-bold leading-none">138 以降</div>
            <p className="card-note">デスクトップ版（Windows 10 / 11・macOS 13 以降・Linux・Chromebook Plus）</p>
          </Card>
          <Card tone="red" label="Storage">
            <div className="card-value text-[clamp(30px,3vw,44px)] font-bold leading-none">22 GB</div>
            <p className="card-note">Chrome のプロフィールがあるドライブの空き容量</p>
          </Card>
          <Card tone="yellow" label="GPU / CPU">
            <div className="card-value text-[clamp(30px,3vw,44px)] font-bold leading-none">VRAM 4 GB 超</div>
            <p className="card-note">または RAM 16 GB 以上と CPU 4 コア以上。専用 GPU なしのノート PC でも動きます。</p>
          </Card>
          <Card tone="green" label="Network">
            <div className="card-value text-[clamp(30px,3vw,44px)] font-bold leading-none">初回のみ</div>
            <p className="card-note">モデルのダウンロードに、従量制でない回線</p>
          </Card>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Card tone="white" label="Check">
            <div className="card-value text-[clamp(20px,1.8vw,26px)] font-bold">モデルの状態を確認</div>
            <p className="card-note">Chrome のアドレスバーに貼り付けると、Gemini Nano のダウンロード状況と状態が見られます。</p>
            <CopyField value="chrome://on-device-internals" label="コピー" doneLabel="コピーしました" className="relative z-[1] mt-3 self-start" />
          </Card>
          <Card tone="white" label="No Nano?">
            <div className="card-value text-[clamp(20px,1.8vw,26px)] font-bold">それでも動きます</div>
            <p className="card-note">Google マップの店舗情報に明記された条件（一人で入りやすい・キャッシュレス・ベジタリアンメニューなど）は判定でき、「お店の今」と「このお店で頼むなら」もそのまま使えます。クチコミを読む条件は「不明」になります。</p>
          </Card>
        </div>
        <p className="mt-4 mb-0 font-mono text-xs text-body">
          出典：<a className={textLink} href="https://developer.chrome.com/docs/ai/get-started" target="_blank" rel="noreferrer">developer.chrome.com/docs/ai/get-started</a>（2026-11 確認）
        </p>
      </div>
    </section>
  );
}

function Ring({ tone }: { tone: "green" | "yellow" | "dot" }) {
  return (
    <span className="grid h-10 w-10 flex-none place-items-center rounded-full border-2 border-ink bg-white">
      {tone === "dot"
        ? <span className="h-3 w-3 rounded-full border-2 border-dashed border-ink" />
        : <span className={`h-6 w-6 rounded-full border-[3px] ${tone === "green" ? "border-green" : "border-yellow"}`} />}
    </span>
  );
}

function Try() {
  return (
    <section id="try" className="section border-y-2 border-ink bg-green-soft">
      <div className="container">
        <SectionHeading
          index="03" kicker="Try it"
          title={<>地図を開いて、<br />ひと言。</>}
          desc="質問のテンプレートは池袋のお店で検証し、渋谷でも確かめています。まずはデモと同じ渋谷で試してみてください。"
        />
        <TabCard tab="Try it">
          <div className="grid gap-6 p-[clamp(18px,3vw,36px)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Steps items={[
              {
                title: "Google マップを開く",
                sub: "www.google.com/maps で動きます（google.co.jp/maps には表示されません）",
                extra: <LinkButton href={MAPS_URL} target="_blank" rel="noreferrer" size="sm">渋谷で開く</LinkButton>,
              },
              { title: "地図の右端のツールから「マップに聞く」を押す" },
              { title: "「Gemini Nano を準備中… n/15」が消えるまで待つ", sub: "初回だけ約 1 分。モデルのダウンロードが必要なときは、さらに数分かかります。" },
              {
                title: "例を押すか、ひと言入力して送信",
                sub: "デモと同じ「1000円以下の和食ランチ」も使えます。文の中の金額から、予算（≤¥1,000）も自動で選ばれます。",
                extra: EXAMPLES.map((e) => <Chip key={e}>{e}</Chip>),
              },
              { title: "印にカーソルを合わせると、理由が見られます", sub: "候補の点 → 判断中の黄色い輪 → 当てはまるお店に番号つきの輪。お店を開くと、お店のページにも答えが出ます。" },
              { title: "お店を開いて、右端の「クチコミ」を押すと「お店の今」", sub: "地元客の割合・評価の推移・客単価・クチコミの急増はこの PC の中で計算します（Gemini Nano も不要）。警告サインは「拡張機能（クラウド）」をオンにすると表示されます。" },
            ]} />
            <div className={`flex flex-col gap-4 rounded-[24px] border-2 border-ink bg-white p-6 ${dotted}`}>
              <Chip>Legend</Chip>
              <div className="flex items-start gap-3">
                <Ring tone="green" />
                <p className="m-0 text-[14px] leading-relaxed"><b>緑</b>：すべての条件が Google マップの店舗情報やメニューに明記されています。</p>
              </div>
              <div className="flex items-start gap-3">
                <Ring tone="yellow" />
                <p className="m-0 text-[14px] leading-relaxed"><b>黄</b>：すべて当てはまりますが、少なくとも 1 つは Gemini Nano がクチコミやお店の文章を読んだ判断です。</p>
              </div>
              <div className="flex items-start gap-3">
                <Ring tone="dot" />
                <p className="m-0 text-[14px] leading-relaxed"><b>点線の点</b>：見つけたお店。判断が終わると、当てはまらないお店は消えます。</p>
              </div>
              <p className="m-0 mt-auto text-[13px] leading-relaxed text-body">
                表示言語はツールバーの拡張機能アイコンから切り替えられます。クチコミの引用は原文のまま表示します。
              </p>
              <LinkButton href="/#demo">デモを見る</LinkButton>
            </div>
          </div>
        </TabCard>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ["地図にツールが出ない", "URL が https://www.google.com/maps/ で始まっているか確認し、ページを再読み込みしてください。インストール前から開いていたタブは再読み込みが必要です。"],
  ["「Nano 利用不可」と出る", "上の動作環境を満たしているか確認し、Chrome を再起動してください。chrome://on-device-internals でモデルの状態を確認できます。店舗情報で判定できる条件はそのまま使えます。"],
  ["「準備中」から進まない", "初回は Chrome がモデルをダウンロードするため、数分かかることがあります。タブを開いたまま待ってください。"],
  ["何が送信されますか", "基本機能（マップに聞く・お店の今の数値）では、当チームのクラウドに何も送りません。ポップアップで「拡張機能（クラウド）」をオンにしたときだけ、お店の ID と Gemini Nano の判断結果（ランチの有無、最安値など）を匿名で共有し、警告サインの分類のためにクチコミ本文を送ります（本文は保存しません）。位置と料理名は送りません。共有した判断は、ほかの利用者からは誰のものかわからない集計としてだけ見えます。初期設定はオフです。"],
  ["「拡張機能（クラウド）」で何が変わりますか", "クチコミの警告サイン（値上げ・衛生・接客など）を分類できるようになります。共有キャッシュも使えます。ほかの人が判断したお店はすぐに表示され、Gemini Nano を待たずに済み、パソコンの電池も使いません。Gemini Nano が使えないパソコンでも、判断済みのお店は見られます。複数の人の判断を多数決でまとめるので、一度の判断ミスが残りにくくなります。"],
  ["結果が少ない", "検索するのは、いま表示している地図の周辺です。地図を動かしてから、もう一度聞いてください。"],
];
const FAQ_TONES = ["blue", "red", "yellow", "green", "blue", "red"] as const;

function Faq() {
  return (
    <section id="faq" className="section">
      <div className="container">
        <SectionHeading index="04" kicker="FAQ" title={<>うまく<br />動かないとき。</>} desc="よくあるつまずきと、確認する場所です。" />
        <div className="grid gap-3 md:grid-cols-2">
          {FAQ.map(([q, a], i) => (
            <Card key={q} tone={FAQ_TONES[i]} label={`Q${i + 1}`}>
              <div className="card-value text-[clamp(20px,1.9vw,26px)] font-bold">{q}</div>
              <p className="card-note">{a}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function StartCta() {
  return (
    <section className="relative overflow-clip border-b-2 border-ink bg-blue py-[clamp(88px,11vw,150px)] text-center">
      <Slashes className="absolute top-[18%] left-[7%] w-[clamp(48px,7vw,96px)] max-sm:hidden" />
      <Pin className="absolute right-[9%] bottom-[18%] w-[clamp(36px,4vw,56px)] max-sm:hidden" />
      <div className="container">
        <Chip>Get started</Chip>
        <h2 className="mx-auto mt-6 mb-8 max-w-[14em] text-[clamp(40px,6vw,88px)] font-bold leading-[1.05] tracking-[-.035em] text-white">
          地図に、<br />聞いてみよう。
        </h2>
        <div className="flex flex-wrap justify-center gap-3">
          <DownloadButton />
          {REPO_URL && <LinkButton href={REPO_URL} target="_blank" rel="noreferrer" size="lg">GitHub</LinkButton>}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- shared ------------------------------------------------------------------- */

function Footer({ page }: { page: Page }) {
  const nav = page === "top" ? TOP_NAV : START_NAV;
  return (
    <footer className="bg-ink text-white">
      <ColorBar />
      <div className="container">
        <div className="grid gap-8 py-[60px] pb-7 md:grid-cols-[1.2fr_1fr_auto]">
          <div className="flex items-center gap-3">
            <Logo width={48} height={48} />
            <span className="flex flex-col gap-1 border-l-[1.5px] border-white/50 pl-3 text-[15px] font-bold leading-tight">
              Joren<small className="text-xs text-blue-half">for Google Maps</small>
            </span>
          </div>
          <nav className="grid grid-cols-[repeat(2,max-content)] gap-x-7 gap-y-2.5 text-sm font-bold">
            {nav.map(([l, h]) => <a key={h} href={h} className="text-white/80 no-underline hover:text-white">{l}</a>)}
          </nav>
          <a href="#top" className="font-mono text-xs font-bold tracking-widest text-white no-underline uppercase">Back to top ↑</a>
        </div>
        <div className="flex select-none justify-center pt-2 text-[clamp(72px,18vw,280px)] font-bold leading-[.8] tracking-[-.06em] text-[#2c2c2c]">
          Joren
        </div>
        <div className="flex flex-col gap-2 border-t border-white/20 py-6 pb-8 font-mono text-xs leading-relaxed text-white/60">
          <div className="flex flex-wrap justify-between gap-3">
            <span>© 2026 Joren · Day of KAI国人 · DevFest GDGoC Japan Hackathon 2026</span>
            <span>Fonts: Google Sans / Google Sans Code (SIL OFL 1.1)</span>
          </div>
          <span>非公式の作品で、Google LLC とは関係ありません。Google、Google マップ、Chrome、Gemini、Firebase は Google LLC の商標です。</span>
        </div>
      </div>
    </footer>
  );
}

const pageOf = (path: string): Page => (path.replace(/\/+$/, "") === "/start" ? "start" : "top");

export default function App() {
  const page = pageOf(window.location.pathname);
  useEffect(() => {
    document.title = page === "start" ? "はじめかた — Joren" : "Joren — 一見さんでも、常連の店へ。";
    // the sections render after the browser's own jump to the #hash, so jump again once they exist
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(decodeURIComponent(id))?.scrollIntoView();
  }, [page]);
  return (
    <>
      <Header page={page} />
      <main>
        {page === "top" ? (
          <>
            <Hero />
            <Marquee
              top={["Gemini Nano", "Google Maps", "Chrome Extension", "Firebase", "Vertex AI", "On-device AI"]}
              bottom={["#dfGDGoCHack26", "一見さん", "常連", "Ask", "Store now"]}
            />
            <Demo />
            <Result />
            <VsAi />
            <How />
            <Proof />
            <TopCta />
          </>
        ) : (
          <>
            <StartHero />
            <Install />
            <Requirements />
            <Try />
            <Faq />
            <StartCta />
          </>
        )}
      </main>
      <Footer page={page} />
    </>
  );
}
