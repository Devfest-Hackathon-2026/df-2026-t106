/*
 * One-off: removes verbatim Google Maps text (owner replies, review text) from the fixtures that are part
 * of the repo, keeping everything the tests and the research notes need.
 *
 *  - fixtures/direction2-meta/*.json: ownerReply.text -> "#" + a letters-only hash of the normalized text,
 *    plus " 高評価" when the original thanked for a high rating. replyHealth() (lib/health.ts) gives the
 *    same result on every store before and after; the script checks that and refuses to write otherwise.
 *  - fixtures/direction2-research.json: review / owner-reply text fields -> "[removed]". Field paths,
 *    counts and our own notes stay.
 * Originals are moved to fixtures/private/ (git-ignored), so the research can still be re-run locally.
 *
 * Build + run (from apps/extension):
 *   npx esbuild scripts/sanitize-fixtures.ts --bundle --platform=node --format=esm --outfile=.output/sanitize-fixtures.mjs && node .output/sanitize-fixtures.mjs
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HIGH_RATING_THANKS, normReply, replyHealth } from "../lib/health";
import type { TapReview } from "../lib/reviewTap";

const FIX = join(process.cwd(), "fixtures");
const PRIVATE = join(FIX, "private");
const META = join(FIX, "direction2-meta");
const RESEARCH = join(FIX, "direction2-research.json");

/** Hex digest spelled with letters a–p: normReply() turns digit runs into "0", which would merge different hashes. */
const letters = (hex: string) => hex.replace(/[0-9a-f]/g, (c) => "abcdefghijklmnop"[parseInt(c, 16)]);
const hashReply = (text: string) => `#${letters(createHash("sha1").update(normReply(text)).digest("hex").slice(0, 16))}${HIGH_RATING_THANKS.test(text) ? " 高評価" : ""}`;

/** Just the fields replyHealth() reads. */
const asTap = (r: any): TapReview => ({
  id: r.reviewId, cid: null, publishedAt: Date.parse(r.publishedAt), editedAt: Date.parse(r.lastEditedAt), stars: r.stars,
  text: null, lang: null, translation: null, photos: 0, reviewer: { reviews: null, photos: null, localGuide: false },
  food: null, service: null, atmosphere: null, pricePerPerson: null, pricePerPersonLabel: null, mealType: null,
  ownerReply: r.ownerReply ? { text: r.ownerReply.text, at: Date.parse(r.ownerReply.at) } : null,
});

function backup(path: string, name: string) {
  mkdirSync(PRIVATE, { recursive: true });
  const to = join(PRIVATE, name);
  if (!existsSync(to)) copyFileSync(path, to);
}

let replies = 0;
for (const f of readdirSync(META).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
  const path = join(META, f);
  const m = JSON.parse(readFileSync(path, "utf8"));
  if (m.reviews.every((r: any) => !r.ownerReply || String(r.ownerReply.text).startsWith("#"))) continue; // done already
  const before = replyHealth(m.reviews.map(asTap));
  for (const r of m.reviews) if (r.ownerReply?.text != null) { r.ownerReply.text = hashReply(r.ownerReply.text); replies++; }
  const after = replyHealth(m.reviews.map(asTap));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`${f}: replyHealth changed\n${JSON.stringify(before)}\n${JSON.stringify(after)}`);
  m.$comment = `${m.$comment ?? ""} Owner-reply text is replaced by "#" + a hash of the normalized text (+ " 高評価" when it thanked for a high rating): duplicate and mismatched-thanks checks give the same results, the words are not in the repo.`.trim();
  backup(path, `direction2-meta-${f}`);
  writeFileSync(path, JSON.stringify(m, null, 1) + "\n");
}

const TEXT_KEYS = new Set(["text", "replyText", "reviewText"]);
let fields = 0;
function scrub(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(scrub);
  if (o && typeof o === "object") {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => {
      if (TEXT_KEYS.has(k) && typeof v === "string" && v !== "[removed]") { fields++; return [k, "[removed]"]; }
      return [k, scrub(v)];
    }));
  }
  return o;
}
const research = JSON.parse(readFileSync(RESEARCH, "utf8"));
const clean = scrub(research) as Record<string, unknown>;
if (fields) {
  backup(RESEARCH, "direction2-research.json");
  clean.$comment = `${research.$comment ?? ""} Review and owner-reply text is removed ("[removed]"); field paths, counts and our notes stay.`.trim();
  writeFileSync(RESEARCH, JSON.stringify(clean, null, 1) + "\n");
}
console.log(`owner replies hashed: ${replies}; research text fields removed: ${fields}; originals in fixtures/private/`);
