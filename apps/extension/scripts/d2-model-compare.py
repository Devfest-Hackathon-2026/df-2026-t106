"""Model choice table for direction 2: every v2-*.json benchmark file side by side, Japanese reviews.
For each model: the best zero-shot and best trained-head condition, per-category head scores,
false alarms, price-hike stance, speed; plus paired bootstrap differences against a reference on the
same resamples (the .scores.npz files).  python d2-model-compare.py fixtures/direction2-bench [ref model]"""
import glob
import json
import os
import sys

import numpy as np
from sklearn.metrics import average_precision_score

folder = sys.argv[1]
ref_name = sys.argv[2] if len(sys.argv) > 2 else "Q4B"
R, S = {}, {}
for f in sorted(glob.glob(os.path.join(folder, "v2-*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    for name, m in d["models"].items():
        short = name.split("/")[-1].replace("Qwen3-Embedding-", "Q").replace("vertex:", "")
        R[short] = m
        npz = f.replace(".json", ".scores.npz")
        if os.path.exists(npz):
            S[short] = np.load(npz)
cats = next(iter(R.values()))["run"]["categories"]


def best(m, mode):
    """Best Japanese-review row of this kind, with or without instruction (zs_gen also covers zs_none)."""
    modes = {mode, mode.replace("_gen", "_none")}
    rows = [r for r in m["run"]["rows"] if r["mode"] in modes and r["review"] == "ja"]
    return max(rows, key=lambda r: r["macro_ap"]) if rows else None


def fa(r):
    v = r.get("false_alarm_at_recall80") or {}
    return np.mean(list(v.values())) if v else float("nan")


print("## best condition per model (Japanese reviews); macro AP [95% interval], false-alarm rate on random reviews at 80% recall")
print(f"{'model':32s} {'dim':>5s} {'txt/s':>7s} | {'zero-shot (instr)':40s} | {'trained head (instr)':40s}")
for o, m in R.items():
    z, p = best(m, "zs_gen"), best(m, "pr_gen")
    zt = f"{z['macro_ap']:.2f} [{z['ci95'][0]:.2f},{z['ci95'][1]:.2f}] fa {fa(z):.3f} ({z['instr']})"
    pt = f"{p['macro_ap']:.2f} [{p['ci95'][0]:.2f},{p['ci95'][1]:.2f}] fa {fa(p):.3f} ({p['instr']})"
    print(f"{o:32s} {m['dim']:5d} {m['texts_per_sec']:7.0f} | {zt:40s} | {pt:40s}")

print("\n## all conditions, Japanese reviews (zero-shot / trained head)")
for o, m in R.items():
    rows = {(r["instr"], r["mode"]): r for r in m["run"]["rows"] if r["review"] == "ja"}
    instrs = []
    for r in m["run"]["rows"]:
        if r["review"] == "ja" and r["instr"] not in instrs:
            instrs.append(r["instr"])
    for il in instrs:
        z = rows.get((il, "zs_gen")) or rows.get((il, "zs_none"))
        p = rows.get((il, "pr_gen")) or rows.get((il, "pr_none"))
        extra = "".join(f"  {mode} {rows[(il, mode)]['macro_ap']:.2f}" for mode in ("zs_cat", "zs_spec", "pr_spec") if (il, mode) in rows)
        print(f"  {o:30s} instr={il:20s} zs {z['macro_ap']:.2f}  head {p['macro_ap']:.2f}{extra}")

print("\n## per category, best trained-head condition: AP")
print(f"{'model':32s}" + "".join(f"{c[:13]:>14s}" for c in cats))
for o, m in R.items():
    p = best(m, "pr_gen")
    print(f"{o:32s}" + "".join(f"{p['per_class'][c]:14.2f}" for c in cats))

print("\n## price-hike stance (unhappy vs accepting), best AUROC: zero-shot / trained head")
for o, m in R.items():
    st = m.get("stance_price_hike")
    if st:
        z = max(st["rows"], key=lambda r: r["zs_auc"])
        p = max(st["rows"], key=lambda r: r["probe_auc"])
        print(f"  {o:30s} zs {z['zs_auc']:.2f} {z['zs_ci95']} ({z['instr']})   head {p['probe_auc']:.2f} {p['probe_ci95']} ({p['instr']})")

if ref_name in S:
    y = S[ref_name]["y"]
    n = len(y)
    rng = np.random.default_rng(0)
    idxs = [rng.integers(0, n, n) for _ in range(1000)]

    def macro(score, ix):
        yy, ss = y[ix], score[ix]
        return np.mean([average_precision_score(yy == c, ss[:, j]) for j, c in enumerate(cats) if (yy == c).sum() > 0])

    def key_of(m, mode):
        b = best(m, mode)
        return f"{b['review']}|{b['instr']}|{b['mode']}"

    print(f"\n## paired bootstrap vs {ref_name} (best condition each, same resamples); * = 95% interval excludes 0")
    for o in R:
        if o == ref_name or o not in S:
            continue
        for mode in ("zs_gen", "pr_gen"):
            a, b = S[o][key_of(R[o], mode)], S[ref_name][key_of(R[ref_name], mode)]
            d = np.array([macro(a, ix) - macro(b, ix) for ix in idxs])
            lo, hi = np.percentile(d, [2.5, 97.5])
            full = macro(a, np.arange(n)) - macro(b, np.arange(n))
            print(f"  {o:30s} {mode}: {full:+.3f} [{lo:+.3f},{hi:+.3f}]{'*' if lo > 0 or hi < 0 else ''}")
