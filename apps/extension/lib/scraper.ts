/*
 * Drives the Google Maps review list (open the tab, sort by newest, scroll). Review data itself
 * comes from the passive payload (lib/reviewTap.ts). Selectors are obfuscated and will drift —
 * every selector lives in SEL so fixes happen in one place.
 */
const SEL = {
  review: "div[data-review-id]",
  stars: '[role="img"][aria-label]',
  reviewsTab: '[role="tab"]',
  sortBtn: 'button[aria-label*="排序"], button[aria-label*="並べ替え"], button[aria-label*="Sort"]',
  sortItem: '[role="menuitemradio"]',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isPlacePage = () => location.pathname.startsWith("/maps/place/");

/** The place name in a /maps/place/<name>/… URL ("+" is a space; a real "+" is encoded as %2B). */
export function urlPlaceName(path = location.pathname): string | null {
  const m = path.match(/^\/maps\/place\/([^/]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, " ")); } catch { return null; }
}
const sameName = (a: string, b: string) => {
  const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
};

/**
 * The details panel of the place in the URL. Right after another place is opened (from the map or the
 * 問地圖 list) the URL already names the new place while Maps still shows the old panel for a moment;
 * driving that one sorted and scrolled the old place and read 0 reviews (live test 2026-11-09).
 * The panel's aria-label is the place name, the same name the URL carries.
 */
export function placePanel(path = location.pathname): HTMLElement | null {
  const name = urlPlaceName(path);
  const panels = [...document.querySelectorAll<HTMLElement>('[role="main"]')].filter((m) => m.querySelector(SEL.reviewsTab));
  if (!name) return panels[0] ?? null;
  return panels.find((m) => sameName(m.getAttribute("aria-label") ?? "", name)) ?? null;
}
/** Where to look for the review list: the current place's panel, else the whole page (unknown layout). */
const scope = (): ParentNode => placePanel() ?? document;

function scroller(): HTMLElement | null {
  let el = scope().querySelector<HTMLElement>(SEL.review);
  while (el && !(el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  return el;
}

/** Scrolls the review list to its end so Maps loads the next page (also used by lib/reviewFeed.ts). */
export function scrollReviews() {
  const sc = scroller();
  if (sc) sc.scrollTop = sc.scrollHeight;
}

/** The scrollable place-details pane (the review list only loads once it scrolls into view). */
function paneScroller(): HTMLElement | null {
  const main = scope().querySelector<HTMLElement>(SEL.reviewsTab)?.closest<HTMLElement>('[role="main"]') ?? null;
  if (!main) return null;
  let seen = 0;
  for (const el of main.querySelectorAll<HTMLElement>("div")) {
    if (++seen > 400) break;
    if (el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** `beforeSort` runs right before "newest" is clicked, so the caller can tell pages loaded after the switch from the relevance page before it. */
export async function openReviewsSortedNewest(beforeSort?: () => void) {
  // wait (up to 8 s) until Maps shows the panel of the place in the URL; after that, fall back to the page
  for (let i = 0; i < 40 && isPlacePage() && !placePanel(); i++) await sleep(200);
  const tab = [...scope().querySelectorAll<HTMLElement>(SEL.reviewsTab)].find((t) => /評論|クチコミ|Reviews/i.test(t.getAttribute("aria-label") ?? t.innerText));
  if (tab && tab.getAttribute("aria-selected") !== "true") { tab.click(); await sleep(1500); }
  // the sort button renders before it is interactive — wait for reviews, then retry the click.
  // Stores with a long summary block keep the list below the fold and Maps only loads it on scroll.
  for (let i = 0; i < 40 && !(scope().querySelector(SEL.sortBtn) && scope().querySelector(SEL.review)); i++) {
    if (i % 4 === 3) paneScroller()?.scrollBy(0, 800);
    await sleep(250);
  }
  const sort = scope().querySelector<HTMLElement>(SEL.sortBtn);
  if (!sort) throw new Error("no-sort-button");
  for (let attempt = 0; attempt < 4 && document.querySelectorAll(SEL.sortItem).length < 2; attempt++) {
    sort.click();
    for (let i = 0; i < 8 && document.querySelectorAll(SEL.sortItem).length < 2; i++) await sleep(150);
  }
  const items = document.querySelectorAll<HTMLElement>(SEL.sortItem);
  if (items.length < 2) throw new Error("no-sort-menu");
  beforeSort?.();
  items[1].click(); // 2nd option is "newest" in every UI language
  await sleep(2000);
}
