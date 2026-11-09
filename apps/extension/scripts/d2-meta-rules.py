"""Offline check of no-language-model rules on fixtures/direction2-meta: review bursts and canned owner replies."""
import collections
import glob
import json
import re
import statistics
import sys
from datetime import datetime, timedelta

folder = sys.argv[1]
stores = []
for f in sorted(glob.glob(folder + "/*.json")):
    if f.replace("\\", "/").split("/")[-1].startswith("_"):
        continue
    d = json.load(open(f, encoding="utf-8"))
    stores.append(d)


def dt(s):
    return datetime.fromisoformat(s)


def norm_reply(t, store):
    t = re.sub(r"\s+", "", t)
    t = t.replace(re.sub(r"\s+", "", store), "<店>")
    t = re.sub(r"[0-9０-９]+", "0", t)
    return t


print("== BURST features (30-day sliding window with the most reviews)")
print(f"{'store':22s} {'sus':5s} {'n':>4s} {'mon':>4s} | {'peak30':>6s} {'rest/30d':>8s} {'ratio':>5s} {'maxday':>6s} | {'newbie_peak':>11s} {'newbie_rest':>11s} | {'5*_peak':>7s} {'5*_rest':>7s} | {'notext5_peak':>12s}")
rows = []
for d in stores:
    rs = sorted(d["reviews"], key=lambda r: r["publishedAt"])
    ts = [dt(r["publishedAt"]) for r in rs]
    span_days = max(1, (ts[-1] - ts[0]).days)
    # best 30-day window
    best, bi, bj, j = 0, 0, 0, 0
    for i in range(len(ts)):
        while ts[i] - ts[j] > timedelta(days=30):
            j += 1
        if i - j + 1 > best:
            best, bi, bj = i - j + 1, j, i
    peak = rs[bi:bj + 1]
    rest = rs[:bi] + rs[bj + 1:]
    rest_days = max(1, span_days - 30)
    rest_rate = len(rest) / rest_days * 30
    days = collections.Counter(t.date() for t in ts)
    maxday = max(days.values())

    def share(xs, fn):
        return sum(1 for x in xs if fn(x)) / len(xs) if xs else float("nan")

    newbie = lambda r: (r["reviewer"]["reviewCount"] or 0) <= 2
    five = lambda r: r["stars"] == 5
    notext5 = lambda r: r["stars"] == 5 and not r["hasText"]
    row = dict(store=d["store"][:20], sus=d.get("burst_suspect"), n=len(rs), mon=round(span_days / 30.4, 1), peak=best,
               rest_rate=rest_rate, ratio=best / max(rest_rate, 0.5), maxday=maxday,
               nb_peak=share(peak, newbie), nb_rest=share(rest, newbie), f_peak=share(peak, five), f_rest=share(rest, five),
               nt_peak=share(peak, notext5))
    rows.append(row)
for r in sorted(rows, key=lambda r: -r["ratio"]):
    print(f"{r['store']:22s} {str(r['sus']):5s} {r['n']:4d} {r['mon']:4.1f} | {r['peak']:6d} {r['rest_rate']:8.1f} {r['ratio']:5.1f} {r['maxday']:6d} | {r['nb_peak']:11.2f} {r['nb_rest']:11.2f} | {r['f_peak']:7.2f} {r['f_rest']:7.2f} | {r['nt_peak']:12.2f}")

print()
print("== candidate rule: peak 30 days >= 30 reviews AND >= 3x the store's usual 30-day rate AND newbie share in peak >= 0.35")
for r in rows:
    r["rule"] = r["peak"] >= 30 and r["ratio"] >= 3 and r["nb_peak"] >= 0.35
tab = collections.Counter((str(r["sus"]), r["rule"]) for r in rows)
for k in sorted(tab):
    print("  labelled", k[0], "| rule fires:", k[1], "|", tab[k], "stores")
print("  fired on:", [r["store"] for r in rows if r["rule"]])

print()
print("== OWNER REPLIES")
print(f"{'store':22s} {'replies':>7s} {'rate':>5s} | {'exact_dup':>9s} {'top_dup':>7s} | {'same text on <=2* and 5*':>24s} | {'high-rating thanks on <=2*':>26s}")
cross = collections.defaultdict(set)
for d in stores:
    rs = d["reviews"]
    reps = [(r, norm_reply(r["ownerReply"]["text"], d["store"])) for r in rs if r.get("ownerReply") and r["ownerReply"].get("text")]
    if not reps:
        print(f"{d['store'][:20]:22s} {0:7d}")
        continue
    cnt = collections.Counter(t for _, t in reps)
    dup = sum(c for c in cnt.values() if c > 1) / len(reps)
    top = cnt.most_common(1)[0][1]
    low = {t for r, t in reps if r["stars"] <= 2}
    high = {t for r, t in reps if r["stars"] == 5}
    both = len(low & high)
    thanks_low = sum(1 for r, t in reps if r["stars"] <= 2 and re.search("高評価|高い評価|星5|★5", r["ownerReply"]["text"]))
    n_low = sum(1 for r, t in reps if r["stars"] <= 2)
    for t in cnt:
        if len(t) >= 40:
            cross[t].add(d["store"][:14])
    print(f"{d['store'][:20]:22s} {len(reps):7d} {len(reps) / len(rs):5.2f} | {dup:9.2f} {top:7d} | {both:24d} | {thanks_low:10d} of {n_low:4d} low-star replies")
shared = {t: s for t, s in cross.items() if len(s) > 1}
print()
print("== identical reply text (after removing store name and digits) used by more than one store:", len(shared), "texts")
pairs = collections.Counter(tuple(sorted(s)) for s in shared.values())
for p, c in pairs.most_common(10):
    print("  ", c, "shared texts:", " + ".join(p))

print()
print("== reply delay and sub-rating coverage")
for d in stores[:0]:
    pass
allr = [r for d in stores for r in d["reviews"]]
print("reviews total", len(allr), "| with sub-ratings", round(sum(1 for r in allr if r.get("food")) / len(allr), 2),
      "| with price per person", round(sum(1 for r in allr if r.get("pricePerPerson")) / len(allr), 2),
      "| with owner reply", round(sum(1 for r in allr if r.get("ownerReply")) / len(allr), 2),
      "| edited", round(sum(1 for r in allr if r["lastEditedAt"] != r["publishedAt"]) / len(allr), 2))
print("pricePerPerson values:", collections.Counter(r["pricePerPerson"] for r in allr if r.get("pricePerPerson")).most_common(8))
