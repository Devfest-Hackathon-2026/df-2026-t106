# Design System — DevFest GDGoC Japan Hackathon 2026 style

Source of truth for all UI in this repo. Derived from https://df-hack26.gdgs.jp/ (hackathon rule: products must use this style). Reference copy of the original site: `df-hack26-mirror/` (serve with `python -m http.server 8026` inside it).

Implementation: `packages/ui/src/styles.css` (tokens + component classes) and `packages/ui/src/components.tsx` / `shapes.tsx` (React). If this doc and the code disagree, fix one so they match.

---

## 1. Personality

Flat, playful, "sticker" look. Everything is a **flat color shape with a 2px near-black outline and big rounded corners**, on a light-gray paper background. No shadows, no gradients, no glassmorphism (except the header's light blur), no photos as decoration. Information is chunked into colored cards. Small labels are **uppercase monospace pills**. Big headings are **bold, tight, very large**.

## 2. Color tokens (Tailwind names → hex)

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1e1e1e` | text, ALL outlines, dark buttons/icons, footer bg |
| `paper` | `#f0f0f0` | page background |
| `white` | `#ffffff` | cards, pills, buttons (default) |
| `body` | `#3c4043` | paragraph / description text |
| `muted` | `#5f6368` | secondary labels, step numbers |
| `blue` / `blue-deep` / `blue-half` / `blue-soft` | `#4285f4` / `#0b57d0` / `#57caff` / `#c3ecf6` | |
| `red` / `red-soft` | `#ea4335` / `#f8d8d8` | |
| `yellow` / `yellow-half` / `yellow-soft` | `#f9ab00` / `#ffd427` / `#ffe7a5` | |
| `green` / `green-half` / `green-soft` | `#34a853` / `#5cdb6d` / `#ccf6c5` | |
| `pink` | `#ff7daf` | rare accent |

Rules:
- Card backgrounds use the **`-soft`** shades. Full-strength colors are for: icons/shapes, one hero word (blue), the countdown/CTA panels (blue), and occasional solid cards.
- Section kicker text is `blue-deep`.
- Primary action = `yellow-soft` button, hover `yellow-half`.
- Rotate tones in Google order **blue → red → yellow → green** (or blue → green → yellow → red) when listing multiple items.
- Tone system: add class `tone-blue|red|yellow|green|pink|white` to set `--tone` / `--tone-soft`; components read those vars.
- Whole sections may get a soft background (`bg-green-soft`, `bg-yellow-soft`, `bg-blue-soft`) with `border-y-2 border-ink`.

## 3. Typography

- Sans: **Google Sans** (400/700) → Japanese fallback first (Hiragino Sans, Noto Sans JP, Yu Gothic UI, Meiryo). Under `lang="zh-Hant"` the `:lang(zh-Hant)` rule swaps `--font-sans` / `--font-mono` to Noto Sans TC / PingFang TC / Microsoft JhengHei. Always set `lang` (`ja` / `zh-Hant` / `en`) on the UI root and on every extra shadow host: the same Han characters need Japanese or Chinese glyph shapes. Mono: **Google Sans Code** (400/700, `MONO` axis pinned to 1 = monospace; 0.6 em per character, same as the site's Google Sans Mono). Font files in `packages/ui/src/fonts/` (copy in `apps/extension/public/fonts/`): both families are **SIL OFL 1.1**, built from the official releases (googlefonts/googlesans v13.002 static, googlefonts/googlesans-code v7.001 variable) and cut to the Google Fonts Latin subset; ship the `OFL-*.txt` files with them. Never use Google Sans Mono — it is "All Rights Reserved", not licensed for redistribution. Trademark rule (googlesans TRADEMARKS.txt): no "Google" / "Google Sans" in product or company names, no implied affiliation with Google.
- Only weights **400 and 700**. Headings & labels are 700.
- Hero title: `clamp(50px, 9.2vw, 138px)`, line-height .9, letter-spacing -.045em. First line in `blue`, middle line 0.56em weight 400 with a mono "year" pill (`blue-soft`).
- Section title (`.sec-title`): `clamp(40px, 5.8vw, 86px)`, lh 1.1, ls -.03em, usually two lines with a `<br />` and ending in "。" / "、".
- Description (`.sec-desc`): 15–17px, lh 1.95, color `body`, max 38em.
- Mono labels: 11–13px, 700, uppercase, letter-spacing .08–.16em.

## 4. Shape & spacing

- Outline: **2px solid ink** on cards/buttons/tiles; **1.5px** on small chips.
- Radius: buttons & chips `999px` (pill); cards `28px` (`--radius-card`); tiles `22px`; big panels `36px`; inner boxes 18–24px.
- Container: `min(100% - 2*gutter, 1320px)`, gutter `clamp(16px, 4vw, 56px)` → class `.container`.
- Section vertical padding: `clamp(88px, 11vw, 150px)` → class `.section`.
- Card padding 26px; grid gaps 12px (`gap-3`).

## 5. Components (class → React)

| Class | React | Notes |
|---|---|---|
| `.btn` (+`.btn-primary`, `.btn-lg`, `.btn-sm`) | `Button`, `LinkButton` | Pill, text left, **round ink icon circle on the right** with ↗ arrow (rotates 45° on hover). Use `ArrowDown` icon for in-page scroll links. `busy` (`.btn-busy`) swaps in a spinning `Spinner` arc while the click's work runs. |
| `.chip` (+`.chip-dashed`, `.chip-ink`) | `Chip` | Mono uppercase label pill. Top-left of every card. |
| `.chip-btn` (+ `tone-*`) | `ChipButton` | Selectable chip for multi-select filters (問地圖 questions): idle = its tone's `-soft`, hover = dashed outline, pressed = ink bg + white text (same pressed language as `SegToggle`). Rotate tones blue → red → yellow → green across a row. A second, smaller row (`px-2.5 py-1.5 text-[10.5px]`) below a dashed ink rule with a mono `+ 條件` label holds modifiers (安靜, 有氣氛 …). |
| `.step-rail` / `.step` | `StepRail` | A process shown as numbered steps on a 2px ink rail (same language as the Tile row): idle white, active pulses `yellow-soft`↔`yellow-half` with a `LiveDot`, done = `green-soft` + `Check`; mono sub-line for live counts ("Nano 31/82"), wrapping to at most two lines (a step is only ~54px wide in the extension panel; never cut a count with an ellipsis). Used for 問地圖's 理解 → 搜尋 → 判斷 → 標出. |
| `.meter` (+`.meter-wrap` / `.meter-mark`) | `Meter` | Pill bar (2px ink outline, white track, tone fill with an ink edge) for "how many of N" per item; width animates. `threshold` adds a 2px ink tick sticking out above and below where a rule fires (store-health burst checks put it in the middle: `max = 2 × threshold`; fill red once past it, green below). |
| `.signal-row` / `.signal` | `SignalRow` | The verdict's status tiles: 4 small outlined tiles (18px radius) on a 2px ink rail, each = mono label (`01 評価`), big value (`▼0.59`), bold status word; background is the status tone's `-soft` (red = bad, yellow = caution, green = fine, white = neutral). A tile is a button that opens and scrolls to its section; hover = dashed outline. While a run is going each tile says what it waits for: **pending** = dashed white, muted value, the status names the wait (`比較中 16/30`, `料金 3/5`, `全期間 55%`) over a small 8px `yellow-half` meter; **provisional** = dashed white with an ink value and status 暫定 (a value that may still change); `waiting` adds `BlinkDots` (接続中). The value fades up when it arrives; when the run ends the tiles take their tone one after another (0.12 s stagger). |
| `.blink-dots` | `BlinkDots` | Three 5px dots blinking in turn (`blink-dot`) after a status: waiting for a service to answer (判定サービスに接続中). Takes the text color. |
| `.stamp` | `Stamp` | A partial result stamped in place the moment it is final: `green-soft` mono pill with ink outline, tilted -3°, drops in once (`stamp-in`). Used for 直近 確定 ✓ while the rest still loads. |
| `.timeline` | `ReviewTimeline` | Reviews per calendar month on `paper` (oldest left, 今日 right): each review a 9×5px pill colored by stars (4–5 `green-half`, 3 `yellow-half`, 1–2 `red`) stacked in its month and popping in as it loads; months with more than 11 become stacked bars scaled to the busiest month. While loading newest first, an ink scan line with a `yellow-half` date tag walks back in time and the months not read yet carry the dotted pattern; the recent window is a `yellow-soft` band (stamped ✓ once complete); red dots under the axis count judged warning signs. It stays after loading as the spread of reviews. |
| `.dumbbell` (+`.dumbbell-key`) | `Dumbbell`, `DumbbellKey` | Before → now on a 1–5 pill track: small dashed hollow dot = before, larger ink dot in a 3px tone ring = now, the segment between is red when it fell and green when it rose. On mount the now dot travels from the before position while the segment grows behind it (`dumbbell-travel` / `dumbbell-grow`, 0.7 s), then its ring pulses three times (`glow-pulse`). One row per sub-rating; a mono `★1 … 5` scale under the last row; `DumbbellKey` draws the two marks as the legend ("○ 以前 → ● 直近") at the right end of the section rule. |
| `.month-strip` | `MonthStrip` | One cell per calendar month (oldest left): a 12px tone dot with ink ring where something happened, a faint 4px ink dot otherwise; the recent months sit on a `yellow-soft` pill band. Used for "when did people complain". |
| `.band-grid` | `BandGrid` | Bucketed values per period (price per person): rows = buckets (high first, mono label), columns = quarters; the period's bucket is a `yellow-half` ink-outlined pill carrying its count, dashed white when the count is under 3. Shows bucketed data without inventing precision. |
| `.quote` (+`.quote-clamp`) | `Quote` | A review in its original language (`lang` set) on a `paper` 16px box: mono meta line (`2026/9 · ★1`), then the text in 「」, clamped to 2 lines until its row is opened. |
| `.status-pill` | `StatusPill` | A finished background job in one line: green check dot (red "!" on error), two mono lines (what was done / the span), action button on the right (`再分析`). While the job runs, a white card takes its place: `LiveDot` + two mono lines (counts / what happens now: 「2026/1 までさかのぼり中」, 「判定サービスに接続中」 + `BlinkDots`) + 停止, and a 10px yellow `Meter` of overall progress. |
| `.fold-btn` | `FoldButton` | Round 30px ink-outlined ＋ / − that opens or folds a section; hover `yellow-soft`. A folded section is one row: `sec-index` + 16px title + mono summary + ＋. |
| — | `CountUp` | A big number that counts to its new value (~600 ms ease-out) instead of jumping; `decimals` for ratings (the verdict's 66px rating eases to each partial average while reviews load, muted until the recent window is complete). |
| `.pop-in` / `.fade-up` | — | Entrance motion: map rings and result stickers pop from their centre (staggered ~18 ms), new list rows / notes fade up 6px. Plain CSS keyframes, safe in Shadow DOM. No other motion besides these, `glow-pulse`, `live-pulse`, the marquee, the `.map-gone` 300 ms fade-out of a rejected map dot, the `.switch` motion (knob slide; on `.switch-cloud`: connect dots + cloud pop), the `.dumbbell` travel + ring pulse, the `.timeline` scan line, pills and dotted unread area, `.blink-dots`, the `.stamp` drop-in and the staggered `.signal` tone fill. All of them stop under `prefers-reduced-motion`. |
| `.ask-bar` | `AskBar` | Pill text field (white, 2px ink outline, 52px) with the round ink ↗ circle of `.btn` as submit; focus = `yellow-soft` background; spinner while busy. Text 700 15px, placeholder `muted` 400. Enter never submits while a Japanese/Chinese IME is composing. The only text field in the system — reuse it, don't style raw inputs. |
| `.copy-field` | `CopyField` | Text the user must paste elsewhere (`chrome://extensions`, `chrome://on-device-internals` — web pages can't link to them): white pill, 2px outline, mono 700 14px **keeping case** (unlike `.chip`), with the round ink circle of `.btn` holding `CopyIcon`; the circle turns `blue-deep` on hover and shows `Check` for 1.5 s after copying. |
| `.check-pill` | `CheckPill` | Pill with green check circle; for feature/eligibility lists. `bad` = red circle with "!" (a check that failed, e.g. 急増あり). |
| `.live-dot` | `LiveDot` | Pulsing green dot; "live/open/ready" status. |
| `.card` (+`.card-solid`, `.card-value`, `.card-note`, `.card-art`) | `Card` | Bento card: chip top-left, art top-right, big value pushed to bottom, note below. |
| `.tab-card` / `.tab-card-tab` | `TabCard` | Folder card with a mono tab on top-left. For grouped/stepped content. |
| `.tile` | `Tile` | Small date/step tile: step number, big value, mono sub, label, meta pill. Usually 4 in a row joined by a 2px ink rail. |
| `.sec-head` … | `SectionHeading` | `[01] KICKER ———————` row, then big title left + description right. Number every section 01, 02, … |
| `.marquee` | `Marquee` | Two bands: ink band rotated -1.8°, yellow-half band rotated +1.4° overlapping; mono uppercase items separated by colored circles; infinite scroll, opposite directions. Place right after the hero. |
| `.site-header` / `.header-bar` | (in apps/web) | Fixed floating white pill bar, 66px, 2px outline, 14px from top; logo + divider + 2-line brand, centered nav links (hover → yellow-soft pill), right: `SegToggle` + small primary button. |
| `.seg-toggle` | `SegToggle` | Pill segmented control; active = ink bg + white text. |
| `.switch` (+`.switch-cloud`) | `Switch` | On/off flag (extension popup; the map dock keeps its ON/OFF pill). 72×36 pill with a 2px outline; a 26px ink knob slides left → right (0.24 s, slight overshoot); the track turns `green-soft` when on; the mono オン/オフ label sits on the free side. `cloud` (拡張機能（クラウド）): when it turns on, three ink dots blink in turn ("connecting"), then a white `Cloud` pops onto the knob and the label fades in (~1.2 s in total). Turning off: the knob slides back and the cloud fades out. Motion plays only after a click (`.is-live`); a switch that opens already on is drawn still. `role="switch"`. |
| `.count-part` | `Countdown` | Each number in its own tone-soft outlined box (blue/red/yellow/green), unit label after. Sits in a blue `rounded-[28px]` panel. |
| `.tool-dock` | `ToolDock` | Extension only: vertical white pill pinned to the map's right edge holding 56px round ink-outlined tools (icon + 9px mono label, active = yellow-soft, disabled = 35% opacity, green-soft count badge top-right). Optional master `toggle` on top (`.tool-dock-switch`, 30px mono ON/OFF pill, green-soft when on) turns every map layer on/off. New features are added as tools here; each opens its panel to the left of the dock. Icons: `AskPin` (問地圖), `Bubble` (reviews); `Bowl` / `Pancakes` are kept for later tools. Hovering a row in a panel list (or a bubble on the map) makes its map ring pulse (`.map-glow`, `glow-pulse` keyframes) and turns its label ink (`.map-label-ink`). 問地圖 highlights: several questions combine as an intersection, so ring and sticker colour carry certainty only — green = every selected question sure, yellow = all yes but at least one only likely; labels name the place, the questions are in the panel and the hover card (`apps/extension/entrypoints/maps.content/askLook.ts`). |
| `.colorbar` | `ColorBar` | 4-color 8px strip (blue/red/yellow/green). Top of footer, top of extension popup/panel. |

Shapes (`shapes.tsx`, all flat fill + 2.5px ink stroke, round joins): `Logo`, `Dots`, `Brace` (wraps text in `{ }`), `Globe`, `Asterisk`, `HalfMoon`, `Slashes`, `Lines`, `Pin`, `People`, `LongArrow`, icons `ArrowUpRight`/`ArrowDown`/`Check`/`CopyIcon`, dock icons `AskPin`/`Bubble`/`Bowl`/`Pancakes`, `Cloud` (拡張機能; white on the `Switch` knob). Use them as decoration in the hero art area, card art corners, and CTA background. Do NOT copy the GDG logo or the site's exact illustrations — draw original shapes in the same language.

## 5b. Charts (`charts.tsx`)

- Categorical palette `CHART_SLOTS` = `#4285f4, #ea4335, #129eaf, #e8a000, #a142f4, #34a853` (validated with the dataviz validator — all checks pass in light mode; contrast WARN relieved by ink outlines + visible labels). Never add a 7th hue: extra categories fold into "其他" `#9aa0a6`.
- Color follows the entity, never its rank (languages: ja/en/zh/ko own slots 0–3; others take a free slot on first appearance).
- Every mark has a 2px ink outline; legend with % always visible; hover highlights a slice / shows a tooltip.
- Line charts: single series in ink 2px, markers yellow-half with ink ring; estimated points hollow + dashed segment. Counts go in a separate mini bar chart below — never a second y-axis.
- `TrendChart` options (store health): `yMin` axis floor (2 or 3 when every value is high, never below 1); `band` = the recent period as a `yellow-soft` span to the right edge, labelled on top in mono; `refLine` = the earlier average as a dashed ink level with a mono label; `mark` = the low point drawn red and larger with its value; `hot` = a count bar drawn red with an ink outline and a mono note (the burst). Labels over lines get a white halo. Quarter ticks under the bars: `25Q2` on the first and on each Q1, else `Q3`. The current, unfinished quarter is "estimated" (hollow, dashed).
- Inside a Shadow DOM panel: don't rely on Tailwind utilities that need `@property` (shadow/ring/translate/rotate); put `[&>*]:shrink-0` on scrolling flex columns.

## 6. Page structure (web)

Header → Hero (lockup row: dots + yellow mono pill + long arrow + `{brace}` text; big 3-line title; art cluster; tagline + 2 buttons + live-dot note; 4 tiles) → countdown panel → Marquee → numbered sections (bento grid, tab-card steps, …) alternating paper / soft-color backgrounds → blue final CTA with scattered shapes and white title → ink footer (colorbar, brand, nav, giant `#2c2c2c` wordmark, mono bottom line).

The header's `SegToggle` appears only when the page really has more than one language (apps/web is Japanese-only for now, so it has just the primary button). apps/web is the landing + "how to try" page: 01 About (bento) → 02 Install (yellow-soft; `TabCard` with a dotted download panel + numbered white step rows, ink-outlined yellow number circles) → 03 Requirements (4 tone cards + `CopyField`) → 04 Try it (green-soft; steps + ring legend) → 05 FAQ (tone cards, Q1…). Text links inside copy are ink, bold, 2px underline — never default blue.

## 7. Extension

- Same tokens/components; import `@gmap/ui/styles.css` in `apps/extension/assets/style.css`.
- Popup width 360px, padding 16px, `ColorBar` on top, brand header, one tone card, check pills, full-width primary button (「Google マップを開く」, in the account last used on Maps). There is no side panel: every tool lives on Google Maps itself.
- Highlights on Maps' own UI: result-card sticker = `.chip` with `bg-green-soft` (確定) / `bg-yellow-soft` (推定) and the answer words ("一人OK·キャッシュレスOK", at most two + "+n"), led by the place's rank number (`.map-num`) when it has one. Each sits in its own shadow host that re-uses the panel stylesheet and carries `lang`. Non-matching cards may be dimmed to opacity .45 — never recolor Maps' own elements.
- Map bubbles (問地圖, states in `apps/extension/lib/askBubbles.ts`): the map shows the work as it happens.
  - Every place the search finds appears as a 12px hollow dashed dot (`.map-dot`).
  - While a question reads it, it gets a dashed yellow ring (`.map-judging`).
  - A no fades out (`.map-gone`).
  - A match becomes the 48px ink-outlined ring around a 3px tone ring.
  - When judging ends, matches are numbered: sure before likely, then nearest the searched centre. Numbers never reshuffle; 載入更多 appends.
  - At most `LOOK.labelsMax` (3) matches get a label (`.map-label`): ink number circle + place name, max 168px with an ellipsis. They get the full 48px ring, drawn above everything. Other matches are small 20px rings (`LOOK.ringSmall`).
  - Labels never overlap (`apps/extension/lib/labelLayout.ts`). In rank order each label takes the first free side of its ring: above, below, right, left. A free side stays inside the map (not under our panel) and hits no earlier label and no other labelled ring. No free side → the ring keeps only its number badge.
  - A labelled place with others hidden under it shows "+n" in its label. In budget mode the label is the price.
  - Hovering or focusing a ring or label opens the hover card (`Peek.tsx`, white 22px card, 300px). It shows rank + name + certainty chip, then one line per question (answer chip ✓ solid / ? dashed, mono source tag, original-language quote), then 開く (primary) / 次へ.
- 「お店の今」panel (`Health.tsx`, logic in `lib/health.ts`), 392px like every panel, top to bottom:
  - Status: while running (loading or judging), one white card: `LiveDot`, 「読み込み n 件 · 判定 n 件」 / what happens now, 停止, overall `Meter`; once done, a `StatusPill` (件数 · 判定数 / span) with 再分析.
  - Waiting: the verdict card is the same card while loading and when done, so nothing jumps. Reviews are read newest first, so the recent window settles first: the 66px rating eases (`CountUp`) muted → ink and a `Stamp` 直近 確定 ✓ drops in. Headlines go クチコミを開いています… → 新しい順に読んでいます… → 直近の評価が出ました。以前と比べています… → いまのところ、… (only once ≥ 30 earlier reviews are in; fewer flipped the direction in tests) → the final verdict. The `ReviewTimeline` sits between the rating and the tiles; tiles show pending / provisional states; a mono hint explains the order. How far back the sorted reading has got comes from `collectReviews`'s `reachedAt` (the relevance page Maps loads first holds old reviews, so the loaded span cannot tell).
  - Verdict card (white, 18px padding): `いまの判断` chip + level chip (要注意 red-soft / 注意 yellow-soft / 良好 green-soft; dashed 途中経過 while busy), a 25px two-line headline ending in 。 (rule: `verdictOf` — burst > drop ≥ 0.3★ > ≥ 2 recent warnings > rise > steady; < 5 reviews on a side = not enough), the 66px now-rating with Delta chip and mono now / before lines, the `ReviewTimeline`, a `SignalRow` (評価 / 警告 / 客単価 / 信頼), and one generated sentence in `body`. The two chips never wrap (`whitespace-nowrap`); the vs label truncates.
  - Sections 01 評価の推移 (blue: `TrendChart` in a white 20px box, its mono legend line only in dev mode, + `Dumbbell` per sub-rating) → 02 警告サイン (red when any, else white: one white row per category, sorted recent-first, with count, ink `直近 n` chip, a `ChipButton` that opens up to 8 quotes, `MonthStrip`, the newest `Quote`) → 03 客単価 (yellow: the bucket as the big value, `BandGrid`, a full-width button to the price complaints) → 04 信頼 (green, red when flagged: `CheckPill`, three threshold `Meter`s, owner-reply `Stat`s with one yellow-soft flag chip) → 05 言語 (blue, folded by default: `PieChart` of the original review languages with colors per language as in §5b, foreign-share and language-count `Stat`s, a mono ★-average-per-language line).
  - Sections with nothing to say start folded; all are folded while loading. Signal tiles open and scroll to their section.
- Fine print: notes that explain *how* something is computed (limits, timings, models, validation numbers, data-source caveats) show only in **dev mode** (popup switch, `useDevMode()`). Kept for everyone: what is sent to the cloud (popup), what the colors mean, source tags and quotes as evidence, and caveats that change how to read a number. Dev-only today: 問地圖 review / lunch progress notes and the budget rule, the lunch chip's 「· キャッシュ」, the 「このお店で頼むなら」 matching note, and in 「お店の今」 the warning month legend, the classifier note, the price-bucket note, the burst-rule note, the language note and the trend-chart legend.
- Language: Japanese is primary; Traditional Chinese and English are switched in the popup. Copy lives in `apps/extension/lib/i18n` (`ja.ts` is the source, `zh.ts` / `en.ts` must match its keys; question words in `i18n/questions.ts`). Never translate matching data or Nano prompts. Quotes from Maps and reviews stay in their original language; only the words around them follow the UI language. Japanese UI uses 件 / お店, full-width 「」 and （）.
- Content scripts injected into Google Maps MUST render inside a Shadow DOM (WXT `createShadowRootUi`) so Tailwind preflight doesn't leak.

## 8. Don'ts

- No drop shadows, gradients (except dotted pattern `radial-gradient(#1e1e1e22 1.2px, transparent 1.2px)` 14px), thin 1px gray borders, or default blue links.
- No other fonts, no weights other than 400/700.
- No colors outside the token table.
- Don't use small radii (< 12px) on outlined boxes.
- Don't write one-off CSS in apps when a `packages/ui` class/component fits — add to `packages/ui` instead.
