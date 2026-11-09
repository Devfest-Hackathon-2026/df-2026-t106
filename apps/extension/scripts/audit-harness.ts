/*
 * Dev harness for auditing verdicts: fetches the given places in the current Maps tab and dumps what
 * the lunch rules saw (categories, hours, menu, owner/review text), so wrong verdicts can be found by eye.
 * Build: npx esbuild scripts/audit-harness.ts --bundle --minify --format=iife --outfile=.output/audit-harness.js
 * Set window.__gmapAuditFids = ["0x…:0x…", …] before injecting. Results land in window.__gmapAudit.
 */
import { fetchPlace } from "../lib/mapsData";
import { extractFacts, hoursSummary, ruleVerdict } from "../lib/lunch";
import { lunchPrice } from "../lib/lunchPrice";

const T: any = ((window as any).__gmapAudit = { phase: "fetch", places: [] as any[], errors: [] as any[] });
const todo: string[] = [...((window as any).__gmapAuditFids ?? [])];
const short = (s: string, n = 90) => s.replace(/\s+/g, " ").slice(0, n);

(async () => {
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let fid = todo.shift(); fid; fid = todo.shift()) {
      try {
        const f = extractFacts(await fetchPlace("x", fid));
        T.places.push({
          fid, name: f.name, cats: f.categories.slice(0, 3), hours: hoursSummary(f),
          moreHours: f.moreHours.map((h) => h.type),
          rule: ruleVerdict(f).verdict, price: lunchPrice(f)?.yen ?? null,
          menuSections: f.menuSections.slice(0, 8),
          menuRows: f.menuRows.length, menuSample: f.menuRows.slice(0, 5).map((r) => `${r.name} ${r.price}`),
          owner: f.ownerText.length, ownerSample: f.ownerText.slice(0, 2).map((s) => short(s)),
          reviews: f.reviewText.length, reviewSample: f.reviewText.slice(0, 3).map((s) => short(s, 70)),
        });
      } catch (e) { T.errors.push({ fid, error: String(e) }); }
    }
  }));
  T.phase = "done";
})();
