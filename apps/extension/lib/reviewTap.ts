/*
 * Passive review source: the Maps place page loads reviews through
 * `fetch POST /maps/_/MapsWizUi/data/batchexecute` (rpc `qv9Egd`, 10 reviews per response).
 * A wrapper on `window.fetch` in the page's MAIN world reads each response and posts the parsed
 * reviews to the extension's isolated world (see entrypoints/maps-tap.content.ts, lib/reviewFeed.ts).
 * Field paths measured 2026-11-06 (fixtures/direction2-research.json, partA.passiveSource.paths).
 * Nothing about the reviewer's identity is kept: no name, profile id, or avatar.
 */

export type TapReview = {
  id: string;                      // == DOM data-review-id
  cid: string | null;              // place: hex after "0x0:" in r[1][0]
  publishedAt: number;             // ms epoch
  editedAt: number;                // ms epoch; "newest" sort orders by this
  stars: number;
  text: string | null;             // original language, full text
  lang: string | null;             // original language code (ja, en, zh-Hant, ...)
  translation: string | null;      // Google's translation into the UI language, when shown
  photos: number;
  reviewer: { reviews: number | null; photos: number | null; localGuide: boolean };
  food: number | null; service: number | null; atmosphere: number | null;   // 1–5 sub-ratings
  pricePerPerson: string | null;   // guided-dining code, e.g. "E:JPY_1000_TO_2000"
  pricePerPersonLabel: string | null; // the UI-language label, e.g. "￥1,000～2,000"
  mealType: string | null;         // "E:LUNCH" | "E:DINNER" | "E:BREAKFAST" | "E:BRUNCH" | "E:OTHER"
  ownerReply: { text: string; at: number } | null;
};

export const TAP_MESSAGE = "gmap-ext:reviews";
export type TapMessage = { type: typeof TAP_MESSAGE; reviews: TapReview[]; nextPage: boolean };

export const isReviewRequest = (url: string) => url.includes("/MapsWizUi/data/batchexecute");

const XSSI = /^\)\]\}'\s*/;
const at = (o: any, ...path: (number | string)[]) => path.reduce((a, k) => (a == null ? undefined : a[k]), o);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** All `qv9Egd` payloads in one batchexecute response body (each a JSON string). */
export function reviewPayloads(body: string): string[] {
  const out: string[] = [];
  for (const line of body.replace(XSSI, "").split("\n")) {
    if (!line.startsWith("[[")) continue;
    let chunk: unknown;
    try { chunk = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(chunk)) continue;
    for (const e of chunk) if (Array.isArray(e) && e[0] === "wrb.fr" && e[1] === "qv9Egd" && typeof e[2] === "string") out.push(e[2]);
  }
  return out;
}

/** Reviews in one `qv9Egd` payload (inner[2][i][0] = review record). */
export function parseReviewPayload(payload: string): { reviews: TapReview[]; nextPage: boolean } {
  let inner: any;
  try { inner = JSON.parse(payload); } catch { return { reviews: [], nextPage: false }; }
  const list: any[] = Array.isArray(inner?.[2]) ? inner[2] : [];
  const reviews: TapReview[] = [];
  for (const w of list) {
    const r = parseReview(Array.isArray(w) ? w[0] : null);
    if (r) reviews.push(r);
  }
  return { reviews, nextPage: typeof inner?.[1] === "string" && inner[1].length > 0 };
}

export function parseReview(r: any): TapReview | null {
  const id = str(at(r, 0));
  const published = num(at(r, 1, 2));
  const stars = num(at(r, 2, 0, 0));
  if (!id || published == null || stars == null) return null;
  const place = str(at(r, 1, 0));
  const cid = place?.includes(":") ? place.split(":")[1].toLowerCase().replace(/^0x/, "") : null;
  const edited = num(at(r, 1, 3)) ?? published;
  const photos = at(r, 2, 2);
  const rv = at(r, 1, 4, 5);
  const replyText = str(at(r, 3, 14, 0, 0));
  const replyAt = num(at(r, 3, 1));

  let food: number | null = null, service: number | null = null, atmosphere: number | null = null;
  let price: string | null = null, priceLabel: string | null = null, meal: string | null = null;
  const guided = at(r, 2, 6);
  if (Array.isArray(guided)) {
    for (const q of guided) {
      const key = str(at(q, 0, 0)) ?? "";
      const score = num(at(q, 11, 0));
      if (key === "GUIDED_DINING_FOOD_ASPECT") food = score;
      else if (key === "GUIDED_DINING_SERVICE_ASPECT") service = score;
      else if (key === "GUIDED_DINING_ATMOSPHERE_ASPECT") atmosphere = score;
      const choices = at(q, 2, 0);
      if (!Array.isArray(choices)) continue;
      for (const c of choices) {
        const code = str(at(c, 0, 0)) ?? "";
        if (code.startsWith("E:JPY_") || /^E:[A-Z]{3}_\d/.test(code)) { price = code; priceLabel = str(at(c, 1)); }
        else if (/^E:(LUNCH|DINNER|BREAKFAST|BRUNCH|OTHER)$/.test(code)) meal = code;
      }
    }
  }
  return {
    id, cid,
    publishedAt: Math.round(published / 1000), editedAt: Math.round(edited / 1000),
    stars,
    text: str(at(r, 2, 15, 0, 0)),
    lang: str(at(r, 2, 14, 0)),
    translation: str(at(r, 2, 15, 1, 0)),
    photos: Array.isArray(photos) ? photos.length : 0,
    reviewer: { reviews: num(at(rv, 5)), photos: num(at(rv, 6)), localGuide: at(rv, 8, 0) === true || at(rv, 8, 0) === 1 },
    food, service, atmosphere,
    pricePerPerson: price, pricePerPersonLabel: priceLabel, mealType: meal,
    ownerReply: replyText && replyAt != null ? { text: replyText, at: Math.round(replyAt / 1000) } : null,
  };
}

/** Installs the fetch wrapper in the page (MAIN world). `post` receives every parsed batch. */
export function installTap(win: Window & typeof globalThis, post: (m: TapMessage) => void) {
  const orig = win.fetch;
  win.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const res = await orig.call(this, input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (isReviewRequest(url)) {
        res.clone().text().then((body) => {
          for (const p of reviewPayloads(body)) {
            const { reviews, nextPage } = parseReviewPayload(p);
            if (reviews.length) post({ type: TAP_MESSAGE, reviews, nextPage });
          }
        }).catch(() => {});
      }
    } catch { /* never break the page's own fetch */ }
    return res;
  } as typeof fetch;
}
