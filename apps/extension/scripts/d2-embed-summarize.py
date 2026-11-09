"""Summarise the v2 benchmark files: tables per condition, paired differences within and across models."""
import glob
import json
import sys

import numpy as np
from sklearn.metrics import average_precision_score

folder = sys.argv[1]
R, S = {}, {}
for f in sorted(glob.glob(folder + "/v2-*.json")):
    d = json.load(open(f, encoding="utf-8"))
    for name, m in d["models"].items():
        short = name.split("/")[-1].replace("Qwen3-Embedding-", "Q")
        R[short] = m
        S[short] = np.load(f.replace(".json", ".scores.npz"))
order = [o for o in ["Q0.6B", "Q4B", "Q8B", "ruri-v3-310m"] if o in R]
qwen = [o for o in order if o.startswith("Q")]
any_m = R[order[0]]["run"]
cats = any_m["categories"]
print("n =", any_m["n"], "| categories:", {c: any_m["label_counts"][c] for c in cats}, "| none:", any_m["label_counts"]["none"])
print("speed texts/s, dim:", {o: (R[o]["texts_per_sec"], R[o]["dim"]) for o in order})


def row(m, rl, il, mode):
    for r in m["run"]["rows"]:
        if (r["review"], r["instr"], r["mode"]) == (rl, il, mode):
            return r


conds = [("ja", "none"), ("ja", "ja"), ("ja", "en"), ("ja", "zh"), ("en", "none"), ("en", "en"), ("en", "ja"), ("en", "zh")]
for base, mode in [("zs_none", "zs_gen"), ("pr_none", "pr_gen"), ("zs_none", "zs_cat"), ("zs_none", "zs_spec"), ("pr_none", "pr_spec")]:
    print("\n##", mode, "(macro AP [95% interval] | mean false-alarm rate on random reviews at 80% recall)")
    print("review instr | " + " | ".join(order))
    for rl, il in conds:
        cells = []
        for o in order:
            r = row(R[o], rl, il, base if il == "none" else mode)
            if not r:
                cells.append("        -        ")
                continue
            fa = r.get("false_alarm_at_recall80") or {}
            fa_txt = f"{np.mean(list(fa.values())):.3f}" if fa else "  -  "
            cells.append(f"{r['macro_ap']:.2f} [{r['ci95'][0]:.2f},{r['ci95'][1]:.2f}] fa {fa_txt}")
        print(f"{rl:4s} {il:5s}| " + " | ".join(cells))


def dif(m, a, b):
    for x in m["run"]["diffs"]:
        if tuple(x["a"]) == a and tuple(x["b"]) == b:
            return x


print("\n## paired differences in macro AP (first minus second); * = 95% interval excludes 0")
pairs = [
    ("instruction vs none, ja/ja, zero-shot", ("ja", "ja", "zs_gen"), ("ja", "none", "zs_none")),
    ("instruction vs none, ja/ja, probe", ("ja", "ja", "pr_gen"), ("ja", "none", "pr_none")),
    ("cond 2 (en instr + ja review) vs cond 1, zero-shot", ("ja", "en", "zs_gen"), ("ja", "ja", "zs_gen")),
    ("cond 2 vs cond 1, probe", ("ja", "en", "pr_gen"), ("ja", "ja", "pr_gen")),
    ("cond 3 (en instr + en review) vs cond 1, zero-shot", ("en", "en", "zs_gen"), ("ja", "ja", "zs_gen")),
    ("cond 3 (en + en) vs cond 1, probe", ("en", "en", "pr_gen"), ("ja", "ja", "pr_gen")),
    ("cond 3 (ja instr + en review) vs cond 1, zero-shot", ("en", "ja", "zs_gen"), ("ja", "ja", "zs_gen")),
    ("cond 3 (ja + en) vs cond 1, probe", ("en", "ja", "pr_gen"), ("ja", "ja", "pr_gen")),
    ("zh instr + ja review vs cond 1, zero-shot", ("ja", "zh", "zs_gen"), ("ja", "ja", "zs_gen")),
    ("zh instr + ja review vs cond 1, probe", ("ja", "zh", "pr_gen"), ("ja", "ja", "pr_gen")),
    ("specific instr vs none, ja/ja, zero-shot", ("ja", "ja", "zs_spec"), ("ja", "none", "zs_none")),
    ("specific instr vs none, ja/ja, probe", ("ja", "ja", "pr_spec"), ("ja", "none", "pr_none")),
]
print(f"{'':52s}| " + " | ".join(f"{o:22s}" for o in qwen))
for label, a, b in pairs:
    cells = []
    for o in qwen:
        x = dif(R[o], a, b)
        star = "*" if x and (x["ci95"][0] > 0 or x["ci95"][1] < 0) else " "
        cells.append(f"{x['diff']:+.2f} [{x['ci95'][0]:+.2f},{x['ci95'][1]:+.2f}]{star}" if x else "-")
    print(f"{label:52s}| " + " | ".join(f"{c:22s}" for c in cells))

# cross-model and cross-mode paired bootstrap on saved scores
y = S[order[0]]["y"]
n = len(y)
rng = np.random.default_rng(0)
idxs = [rng.integers(0, n, n) for _ in range(1000)]


def macro(score, ix=None):
    yy, ss = (y, score) if ix is None else (y[ix], score[ix])
    return np.mean([average_precision_score(yy == c, ss[:, j]) for j, c in enumerate(cats) if (yy == c).sum() > 0])


def paired(sa, sb):
    d = np.array([macro(sa, ix) - macro(sb, ix) for ix in idxs])
    lo, hi = np.percentile(d, [2.5, 97.5])
    return f"{macro(sa) - macro(sb):+.3f} [{lo:+.3f},{hi:+.3f}]" + ("*" if lo > 0 or hi < 0 else " ")


print("\n## across models and modes (same resamples), ja instruction + ja review")
k_zs, k_pr = "ja|ja|zs_gen", "ja|ja|pr_gen"
checks = []
for a, b in [("Q4B", "Q0.6B"), ("Q8B", "Q4B"), ("Q8B", "Q0.6B")]:
    if a in S and b in S:
        checks.append((f"{a} vs {b}, zero-shot", S[a][k_zs], S[b][k_zs]))
        checks.append((f"{a} vs {b}, probe", S[a][k_pr], S[b][k_pr]))
for o in qwen:
    checks.append((f"{o}: probe vs zero-shot", S[o][k_pr], S[o][k_zs]))
    if "ruri-v3-310m" in S:
        checks.append((f"{o} probe vs ruri probe (no prefix)", S[o][k_pr], S["ruri-v3-310m"]["ja|none|pr_none"]))
        checks.append((f"{o} zero-shot vs ruri zero-shot (no prefix)", S[o][k_zs], S["ruri-v3-310m"]["ja|none|zs_none"]))
for label, sa, sb in checks:
    print(f"  {label:46s} {paired(sa, sb)}")

print("\n## per category, ja instruction + ja review: AP | false-alarm rate on random reviews at 80% recall")
print(f"{'':24s}" + "".join(f"{c[:14]:>16s}" for c in cats))
print(f"{'positives':24s}" + "".join(f"{any_m['label_counts'][c]:>16d}" for c in cats))
for mode, il in [("zs_none", "none"), ("zs_gen", "ja"), ("pr_none", "none"), ("pr_gen", "ja")]:
    for o in order:
        r = row(R[o], "ja", il, mode)
        if r:
            fa = r.get("false_alarm_at_recall80") or {}
            print(f"{mode:8s} {o:15s}" + "".join(f"{r['per_class'][c]:>9.2f}|{fa.get(c, float('nan')):>5.2f} " for c in cats))

print("\n## price-hike stance (unhappy vs accepting), AUROC [95% interval]")
for o in qwen:
    st = R[o]["stance_price_hike"]
    print(f"  {o} n={st['n']} unhappy={st['unhappy']} accepting={st['accepting']}")
    for r in st["rows"]:
        print(f"    review={r['review']} instr={r['instr']:4s} zero-shot {r['zs_auc']:.2f} {r['zs_ci95']}  probe {r['probe_auc']:.2f} {r['probe_ci95']}")
