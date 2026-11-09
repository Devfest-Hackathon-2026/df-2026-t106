#!/usr/bin/env python
"""
Train the classifier heads that the classify service ships with (direction 2).

Input : fixtures/direction2-corpus-v2.json (verbatim Maps reviews labelled by category)
Model : --model vertex:gemini-embedding-001 (the chosen Google model, no task_type: one vector per review
        serves both the category heads and the stance head) or Qwen/Qwen3-Embedding-4B with one generic
        Japanese instruction (the benchmark winner, kept for reference)
Output: heads.json  - per-category logistic weights (one-vs-rest = multi-label at inference), a
                      threshold per category, and the price-stance head (unhappy vs accepting)
        heads-eval.json - cross-validated scores (folds grouped by store) for the record

Categories shipped (the benchmark's 8 regrouped, see direction2-review-warnings memory):
  price            = price_hike + portion   ("less for the money"; stance head applies)
  surprise_charge, quality_decline, hygiene, service   (warnings)
  improvement                                          (positive)
  staff_change     = staff_or_owner_change             (attribute, not a warning)

Run:
  python d2-train-heads.py --corpus direction2-corpus-v2.json --out heads.json --model vertex:gemini-embedding-001
  (Vertex vectors are cached in ./vertex-cache-<model>.json by VertexClient from d2-embed-bench.py)
"""
import argparse
import importlib.util
import json
import os

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold

QWEN = "Qwen/Qwen3-Embedding-4B"
INSTRUCTION = "この飲食店のクチコミが指摘している不満や変化の種類を分類する"
STANCE_INSTRUCTION = "値上げについて、このクチコミの書き手が不満を持っているか、受け入れているかを判定する"
REGROUP = {
    "price_hike": "price", "portion": "price",
    "surprise_charge": "surprise_charge", "quality_decline": "quality_decline",
    "hygiene": "hygiene", "service": "service", "improvement": "improvement",
    "staff_or_owner_change": "staff_change", "none": "none",
}
CATS = ["price", "surprise_charge", "quality_decline", "hygiene", "service", "improvement", "staff_change"]
C = 10.0
TARGET_RECALL = 0.8


def load(path):
    raw = json.load(open(path, encoding="utf-8"))
    out = []
    for it in raw["items"]:
        cat = REGROUP.get(it.get("category"))
        text = (it.get("text") or "").strip()
        if not cat or not text:
            continue
        out.append({"text": text, "label": cat, "orig": it["category"], "complaint": bool(it.get("is_complaint")),
                    "store": it.get("storeTag") or it.get("store") or "", "stream": it.get("picked_by") or "v1",
                    "lang": (it.get("lang") or "").lower()})
    return out


class Embedder:
    """Qwen: instruction prompt on a GPU. Vertex: REST client from d2-embed-bench.py, no task_type."""

    def __init__(self, model, device):
        self.vertex = model.startswith("vertex:")
        if self.vertex:
            spec = importlib.util.spec_from_file_location("bench", os.path.join(os.path.dirname(os.path.abspath(__file__)), "d2-embed-bench.py"))
            bench = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(bench)
            self.client = bench.VertexClient(model.split(":", 1)[1])
            self.model = model
        else:
            import torch
            from sentence_transformers import SentenceTransformer

            self.model = SentenceTransformer(model, device=device, model_kwargs={"torch_dtype": torch.float16},
                                             tokenizer_kwargs={"padding_side": "left"})
            self.model.max_seq_length = 1024

    def __call__(self, texts, instruction):
        if self.vertex:
            e = self.client.embed(texts)
            return e / np.linalg.norm(e, axis=1, keepdims=True)
        e = self.model.encode(texts, prompt="Instruct: " + instruction + "\nQuery:", batch_size=32,
                              normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
        return np.asarray(e, dtype=np.float32)


def fit(X, y):
    clf = LogisticRegression(C=C, max_iter=5000, class_weight="balanced")
    clf.fit(X, y)
    return clf


def oof(X, y, groups, seeds=2):
    """Out-of-fold probabilities, folds grouped by store, averaged over repeated splits."""
    k = int(min(5, len(set(groups[y]))))
    p = np.zeros(len(y))
    for s in range(seeds):
        cv = StratifiedGroupKFold(n_splits=k, shuffle=True, random_state=s)
        for tr, te in cv.split(X, y, groups):
            if y[tr].sum() == 0:
                continue
            p[te] += fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    return p / seeds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--out", default="heads.json")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--model", default="vertex:gemini-embedding-001")
    a = ap.parse_args()

    items = load(a.corpus)
    labels = np.array([i["label"] for i in items])
    groups = np.array([i["store"] for i in items])
    stream = np.array([i["stream"] for i in items])
    print("items", len(items), {c: int((labels == c).sum()) for c in CATS + ["none"]})

    embed = Embedder(a.model, a.device)
    X = embed([i["text"] for i in items], INSTRUCTION)
    print("embedded", X.shape)

    heads, evals = [], {}
    rnd = stream == "random"
    for c in CATS:
        y = labels == c
        p = oof(X, y, groups)
        ap_ = float(average_precision_score(y, p))
        pos = np.sort(p[y])
        thr = float(pos[int(np.floor((1 - TARGET_RECALL) * len(pos)))])
        flagged = p >= thr
        precision = float((y & flagged).sum() / max(1, flagged.sum()))
        false_alarm = float((p[rnd & ~y] >= thr).mean())
        clf = fit(X, y)
        heads.append({"name": c, "w": [round(float(v), 6) for v in clf.coef_[0]], "b": round(float(clf.intercept_[0]), 6),
                      "threshold": round(thr, 4)})
        evals[c] = {"n": int(y.sum()), "cv_ap": round(ap_, 3), "threshold": round(thr, 3),
                    "cv_precision_at_threshold": round(precision, 3), "cv_recall_at_threshold": TARGET_RECALL,
                    "false_alarm_on_random": round(false_alarm, 4)}
        print(f"{c:16s} n={y.sum():4d} AP {ap_:.3f} thr {thr:.3f} precision {precision:.2f} false-alarm {false_alarm:.3f}")
    evals["macro_ap"] = round(float(np.mean([evals[c]["cv_ap"] for c in CATS])), 3)

    # price stance: among reviews that state a price rise / smaller portion, unhappy vs accepting
    pi = [k for k, i in enumerate(items) if i["label"] == "price"]
    sy = np.array([items[k]["complaint"] for k in pi])
    sg = groups[pi]
    # Vertex has no instruction: the stance head reads the same vector as the category heads
    S = X[pi] if embed.vertex else embed([items[k]["text"] for k in pi], STANCE_INSTRUCTION)
    sp = oof(S, sy, sg)
    auc = float(roc_auc_score(sy, sp))
    sclf = fit(S, sy)
    stance = {"instruction": None if embed.vertex else STANCE_INSTRUCTION, "w": [round(float(v), 6) for v in sclf.coef_[0]], "b": round(float(sclf.intercept_[0]), 6)}
    evals["price_stance"] = {"n": len(pi), "unhappy": int(sy.sum()), "accepting": int((~sy).sum()), "cv_auroc": round(auc, 3)}
    print(f"stance n={len(pi)} unhappy={sy.sum()} AUROC {auc:.3f}")

    out = {"model": a.model, "dim": int(X.shape[1]), "instruction": None if embed.vertex else INSTRUCTION,
           "task_type": None, "max_seq_length": 1024, "normalize": True, "categories": heads, "stance": stance,
           "$comment": "p = sigmoid(w.x + b) on the L2-normalised embedding; label when p >= threshold (threshold = 80% recall in CV)"}
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(evals, open(a.out.replace(".json", "") + "-eval.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
