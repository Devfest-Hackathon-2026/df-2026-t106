#!/usr/bin/env python
"""
Direction-2 benchmark: instruction language x review language for Qwen3-Embedding.

Question: with an instruction-aware embedding model, which combination finds warning signs in
Maps reviews best?
  1. Japanese instruction + Japanese review
  2. English instruction  + Japanese review
  3. instruction in ja / en / zh + Google's English translation of the review

Corpus: fixtures/direction2-corpus.json (verbatim Maps reviews, hand-labelled by category, each
with Google's English translation).

Five ways of using the embeddings, each scored as macro average precision over warning categories
(one-vs-rest ranking of all reviews; 1.0 = every review stating the warning ranks above the rest):
  zs_cat    zero-shot, the category description is the query (instruction on the category side),
            reviews embedded WITHOUT instruction -> one cached vector per review serves all categories
  zs_gen    zero-shot, review embedded with one generic instruction, compared to plain descriptions
  zs_spec   zero-shot, review embedded with a category-specific instruction (one vector per category)
  pr_gen    linear probe on generic-instruction review vectors (cross-validated, folds grouped by store)
  pr_spec   linear probe on category-specific-instruction review vectors
Rows with instr=none are the baselines (zs_none, pr_none).

Labels are topic level: a review that states "prices went up" is price_hike whether or not the
writer minds. The stance test then asks, among price_hike reviews only, whether the vectors
separate "unhappy about it" from "still satisfied".

Run on a GPU box:
  python d2-embed-bench.py --corpus direction2-corpus.json --out result.json \
      --models Qwen/Qwen3-Embedding-0.6B Qwen/Qwen3-Embedding-4B Qwen/Qwen3-Embedding-8B
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold

WARN = ["price_hike", "portion", "quality_decline", "staff_or_owner_change", "service",
        "hygiene", "surprise_charge", "review_for_reward", "improvement"]
CATS = WARN + ["none"]

# Category descriptions: the "document" side in zs_gen / zs_spec, the "query" side in zs_cat.
DESC = {
    "ja": {
        "price_hike": "値上げされた。以前より値段が高くなった。",
        "portion": "量が減った。以前より少なくなった、小さくなった。",
        "quality_decline": "味が落ちた。以前より美味しくなくなった、質が下がった。",
        "staff_or_owner_change": "店主や料理人、スタッフが変わって、店が変わってしまった。",
        "service": "店員の態度が悪い。接客がひどい。",
        "hygiene": "不衛生。店内や食器が汚い、料理に髪の毛や虫が入っていた。",
        "surprise_charge": "会計が不明瞭。お通し代やチャージ、サービス料を勝手に取られた。ぼったくり、キャッチ。",
        "review_for_reward": "クチコミを投稿すると一品サービスや割引がもらえる。",
        "improvement": "以前より良くなった。改善された。",
    },
    "en": {
        "price_hike": "The restaurant raised its prices; it has become more expensive than before.",
        "portion": "The portions have become smaller than before.",
        "quality_decline": "The food tastes worse than before; the quality has declined.",
        "staff_or_owner_change": "The owner, chef or staff changed, and the restaurant is different now.",
        "service": "The staff were rude or the service was bad.",
        "hygiene": "The restaurant is dirty or unhygienic: hair or insects in the food, dirty tableware.",
        "surprise_charge": "Unexpected charges on the bill: a cover charge, table charge or service fee, or a rip-off by a street tout.",
        "review_for_reward": "The restaurant gives a free item or a discount in exchange for posting a review.",
        "improvement": "The restaurant has improved; it is better than before.",
    },
    "zh": {
        "price_hike": "這家店漲價了，比以前貴。",
        "portion": "份量變少了，比以前小。",
        "quality_decline": "味道變差了，品質不如以前。",
        "staff_or_owner_change": "老闆、廚師或店員換人了，店變得不一樣。",
        "service": "店員態度差，服務很糟。",
        "hygiene": "不衛生，店內或餐具很髒，食物裡有頭髮或蟲。",
        "surprise_charge": "帳單有沒說明的費用：小菜費、座位費、服務費，或被拉客的坑錢。",
        "review_for_reward": "寫評論就送一道菜或折扣。",
        "improvement": "這家店進步了，比以前好。",
    },
}

# One generic instruction for the review side.
GENERIC = {
    "ja": "この飲食店のクチコミが指摘している不満や変化の種類を分類する",
    "en": "Classify the type of complaint or change that this restaurant review reports",
    "zh": "判斷這則餐廳評論提到的是哪一種抱怨或變化",
}
# Instruction for the category side (the category description is the query, reviews are documents).
RETRIEVE = {
    "ja": "飲食店への不満の種類が与えられたとき、その不満を述べているクチコミを検索する",
    "en": "Given a type of complaint about a restaurant, retrieve reviews that make this complaint",
    "zh": "給定一種對餐廳的抱怨類型，檢索提出這種抱怨的評論",
}
# Category-specific instruction for the review side ("specify the topic").
SPECIFIC = {
    "ja": {
        "price_hike": "この飲食店のクチコミが、値上げされたと述べているかを判定する",
        "portion": "この飲食店のクチコミが、量が減ったと述べているかを判定する",
        "quality_decline": "この飲食店のクチコミが、味や質が以前より落ちたと述べているかを判定する",
        "staff_or_owner_change": "この飲食店のクチコミが、店主・料理人・スタッフが変わったと述べているかを判定する",
        "service": "この飲食店のクチコミが、接客や店員の態度への不満を述べているかを判定する",
        "hygiene": "この飲食店のクチコミが、衛生面への不満を述べているかを判定する",
        "surprise_charge": "この飲食店のクチコミが、会計に想定外の料金があったと述べているかを判定する",
        "review_for_reward": "この飲食店のクチコミが、クチコミ投稿と引き換えの特典に触れているかを判定する",
        "improvement": "この飲食店のクチコミが、店が以前より良くなったと述べているかを判定する",
    },
    "en": {
        "price_hike": "Determine whether this restaurant review says that prices have gone up",
        "portion": "Determine whether this restaurant review says that portions have become smaller",
        "quality_decline": "Determine whether this restaurant review says the taste or quality has declined",
        "staff_or_owner_change": "Determine whether this restaurant review says the owner, chef or staff changed",
        "service": "Determine whether this restaurant review complains about the service or staff attitude",
        "hygiene": "Determine whether this restaurant review complains about hygiene",
        "surprise_charge": "Determine whether this restaurant review complains about unexpected charges on the bill",
        "review_for_reward": "Determine whether this restaurant review mentions a reward given for posting a review",
        "improvement": "Determine whether this restaurant review says the restaurant has improved",
    },
    "zh": {
        "price_hike": "判斷這則餐廳評論是否說這家店漲價了",
        "portion": "判斷這則餐廳評論是否說份量變少了",
        "quality_decline": "判斷這則餐廳評論是否說味道或品質變差了",
        "staff_or_owner_change": "判斷這則餐廳評論是否說老闆、廚師或店員換人了",
        "service": "判斷這則餐廳評論是否在抱怨服務或店員態度",
        "hygiene": "判斷這則餐廳評論是否在抱怨衛生",
        "surprise_charge": "判斷這則餐廳評論是否在抱怨帳單上有意外的費用",
        "review_for_reward": "判斷這則餐廳評論是否提到寫評論可以換贈品",
        "improvement": "判斷這則餐廳評論是否說這家店比以前好",
    },
}

# Stance test on reviews that mention a price hike: unhappy about it, or accepting it?
STANCE = {
    "ja": "値上げについて、このクチコミの書き手が不満を持っているか、受け入れているかを判定する",
    "en": "Determine whether the reviewer is unhappy about the price increase or accepts it",
    "zh": "判斷寫評論的人對漲價是不滿，還是可以接受",
}
STANCE_DESC = {  # (unhappy, accepting)
    "ja": ("値上げに不満がある。高くなって残念だ。", "値上げしたが、それでも満足している。"),
    "en": ("Unhappy about the price increase; it is too expensive now.", "Prices went up, but still satisfied; it is still worth it."),
    "zh": ("對漲價不滿，現在太貴了。", "雖然漲價了，還是很滿意，仍然值得。"),
}

MINPOS = 5        # a category is scored only if it has at least this many positives
BOOT = 1000       # bootstrap resamples for the 95% intervals
PROBE_C = 10.0    # fixed, not tuned per condition


def load_corpus(path):
    """Label = the category the review states (topic level). Whether the writer complains about it
    (is_complaint) is kept separately and used only by the price-hike stance test."""
    raw = json.load(open(path, encoding="utf-8"))
    items = raw if isinstance(raw, list) else raw["items"]
    out = []
    for it in items:
        cat = it.get("category")
        if cat not in CATS:
            continue
        out.append({
            "text": (it.get("text") or "").strip(),
            "text_en": (it.get("text_en") or "").strip(),
            "lang": (it.get("lang") or "").lower(),
            "label": cat,
            "complaint": bool(it.get("is_complaint")),
            "store": it.get("storeTag") or it.get("store") or "",
            "stream": it.get("picked_by") or "v1",  # v1 | keyword | random (random = natural mix)
        })
    return [o for o in out if o["text"]]


class VertexClient:
    """Vertex AI text embeddings over REST (gcloud credentials). `task` is the API's task_type.
    Vectors are cached on disk so a re-run costs nothing. gemini-embedding-001 takes one text per
    request; the text-*-embedding models take up to 250."""

    def __init__(self, model, project="gmap-extension"):
        self.model = model
        self.region = os.environ.get("VERTEX_REGION", "asia-northeast1")
        self.url = (f"https://{self.region}-aiplatform.googleapis.com/v1/projects/{project}/locations/"
                    f"{self.region}/publishers/google/models/{model}:predict")
        self.batch = 1 if "gemini" in model else 100
        self.cache_path = f"vertex-cache-{model}.json"
        self.cache = json.load(open(self.cache_path, encoding="utf-8")) if os.path.exists(self.cache_path) else {}
        self.token = None
        self.chars = 0

    def _token(self):
        if self.token is None:
            self.token = subprocess.check_output([shutil.which("gcloud"), "auth", "print-access-token"], text=True).strip()
        return self.token

    def _call(self, texts, task):
        body = {"instances": [({"content": t, "task_type": task} if task else {"content": t}) for t in texts]}
        for attempt in range(6):
            req = urllib.request.Request(self.url, data=json.dumps(body).encode(), method="POST",
                                         headers={"Authorization": "Bearer " + self._token(), "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    preds = json.load(r)["predictions"]
                return [p["embeddings"]["values"] for p in preds]
            except urllib.error.HTTPError as e:
                msg = e.read().decode()[:300]
                if e.code == 401:
                    self.token = None
                elif e.code not in (429, 500, 503):
                    raise RuntimeError(f"vertex {e.code}: {msg}")
                time.sleep(2 ** attempt)
        raise RuntimeError("vertex: gave up after retries")

    def embed(self, texts, task=None):
        keys = [hashlib.sha1(f"{task}|{t}".encode()).hexdigest() for t in texts]
        todo = [(k, t) for k, t in zip(keys, texts) if k not in self.cache]
        if todo:
            chunks = [todo[i:i + self.batch] for i in range(0, len(todo), self.batch)]
            with ThreadPoolExecutor(8) as ex:
                for chunk, vecs in zip(chunks, ex.map(lambda c: self._call([t for _, t in c], task), chunks)):
                    for (k, _), v in zip(chunk, vecs):
                        self.cache[k] = v
            self.chars += sum(len(t) for _, t in todo)
            json.dump(self.cache, open(self.cache_path, "w", encoding="utf-8"))
        return np.array([self.cache[k] for k in keys], dtype=np.float32)


class Encoder:
    """Qwen3-Embedding: 'Instruct: ... Query:'; EmbeddingGemma: 'task: ... | query: ' (document prompt
    when no instruction); ruri: fixed prefixes; vertex:<model>: task_type in place of an instruction."""

    def __init__(self, name, device):
        self.name = name
        self.is_qwen = "Qwen3-Embedding" in name
        self.is_gemma = "embeddinggemma" in name.lower()
        self.is_vertex = name.startswith("vertex:")
        self.instructable = self.is_qwen or self.is_gemma
        self.model = None
        self.sec = 0.0
        self.n = 0
        if self.is_vertex:
            self.vertex = VertexClient(name.split(":", 1)[1])
            return
        import torch
        from sentence_transformers import SentenceTransformer

        tok = {"padding_side": "left"} if self.is_qwen else {}
        dtype = torch.bfloat16 if self.is_gemma else torch.float16  # Gemma overflows in float16 (NaN vectors)
        self.model = SentenceTransformer(name, device=device, model_kwargs={"torch_dtype": dtype}, tokenizer_kwargs=tok)
        self.model.max_seq_length = 1024

    def encode(self, texts, instruction=None, prefix=None):
        t0 = time.perf_counter()
        if self.is_vertex:
            e = self.vertex.embed(texts, instruction)
            e = e / np.linalg.norm(e, axis=1, keepdims=True)
        else:
            if self.is_qwen:
                prompt = None if instruction is None else "Instruct: " + instruction + "\nQuery:"
            elif self.is_gemma:
                prompt = "title: none | text: " if instruction is None else "task: " + instruction + " | query: "
            else:
                prompt = prefix  # ruri-style fixed prefix
            e = self.model.encode(texts, prompt=prompt, batch_size=32, normalize_embeddings=True,
                                  convert_to_numpy=True, show_progress_bar=False)
        self.sec += time.perf_counter() - t0
        self.n += len(texts)
        return np.asarray(e, dtype=np.float32)


def class_aps(score, y, cats):
    """score: n x len(cats). Average precision per category."""
    return {c: float(average_precision_score(y == c, score[:, j])) for j, c in enumerate(cats)}


def false_alarms(score, y, stream, cats, recall=0.8):
    """Per category: set the threshold that catches `recall` of the true cases, then count how many
    randomly drawn reviews of other kinds would be flagged. This is the false-alarm rate a user sees."""
    rnd = stream == "random"
    out = {}
    for j, c in enumerate(cats):
        pos = np.sort(score[y == c, j])
        thr = pos[int(np.floor((1 - recall) * len(pos)))]
        neg = score[rnd & (y != c), j]
        out[c] = float((neg >= thr).mean())
    return out


def oof_binary(X, pos, groups, seeds=2):
    """Out-of-fold probability of a binary linear probe. Folds are grouped by store (a probe must
    not score by recognising one store's vocabulary) and the split is repeated."""
    k = int(min(5, len(set(groups[pos]))))
    p = np.zeros(len(pos))
    for s in range(seeds):
        cv = StratifiedGroupKFold(n_splits=k, shuffle=True, random_state=s)
        for tr, te in cv.split(X, pos, groups):
            if pos[tr].sum() == 0:
                continue
            clf = LogisticRegression(C=PROBE_C, max_iter=3000, class_weight="balanced")
            clf.fit(X[tr], pos[tr])
            p[te] += clf.predict_proba(X[te])[:, 1]
    return p / seeds


def auc_ci(t, s, rng):
    vals = []
    for _ in range(BOOT):
        ix = rng.integers(0, len(t), len(t))
        if 0 < t[ix].sum() < len(ix):
            vals.append(roc_auc_score(t[ix], s[ix]))
    return [round(float(np.percentile(vals, 2.5)), 3), round(float(np.percentile(vals, 97.5)), 3)]


def stance_test(enc, items, review_langs, instr_langs):
    """Reviews that mention a price hike: can the vectors tell unhappy from accepting? AUROC, 0.5 = no."""
    sub = [o for o in items if o["label"] == "price_hike"]
    t = np.array([o["complaint"] for o in sub])
    groups = np.array([o["store"] for o in sub])
    if t.sum() < 3 or (~t).sum() < 3:
        return None
    rng = np.random.default_rng(1)
    rows = []

    def add(rl, il, R, d_lang):
        D = enc.encode(list(STANCE_DESC[d_lang]))
        zs = R @ D[0] - R @ D[1]
        pr = oof_binary(R, t, groups)  # folds grouped by store
        rows.append({"review": rl, "instr": il, "zs_auc": round(float(roc_auc_score(t, zs)), 3), "zs_ci95": auc_ci(t, zs, rng),
                     "probe_auc": round(float(roc_auc_score(t, pr)), 3), "probe_ci95": auc_ci(t, pr, rng)})

    for rl in review_langs:
        texts = [o["text"] if rl == "ja" else o["text_en"] for o in sub]
        add(rl, "none", enc.encode(texts), rl)
        for il in instr_langs:
            if enc.is_vertex:
                add(rl, il, enc.encode(texts, il), rl)  # il = task_type
            elif il != "canon":
                add(rl, il, enc.encode(texts, STANCE[il]), il)
    return {"n": len(sub), "unhappy": int(t.sum()), "accepting": int((~t).sum()), "rows": rows}


def run_subset(enc, items, review_langs, instr_langs, tag):
    y = np.array([o["label"] for o in items])
    groups = np.array([o["store"] for o in items])
    stream = np.array([o["stream"] for o in items])
    cats = [c for c in WARN if (y == c).sum() >= MINPOS and len(set(groups[y == c])) >= 2]
    rows = {}

    def add(key, score):
        aps = class_aps(score, y, cats)
        fa = false_alarms(score, y, stream, cats) if (stream == "random").sum() >= 50 else {}
        rows[key] = {"score": score, "macro_ap": float(np.mean(list(aps.values()))), "per_class": aps, "false_alarm": fa}

    def probe(R):
        return np.stack([oof_binary(R, y == c, groups) for c in cats], 1)

    for rl in review_langs:
        texts = [o["text"] if rl == "ja" else o["text_en"] for o in items]
        if enc.instructable:
            R_none = enc.encode(texts)
            # baselines: no instruction anywhere, descriptions in the review's language
            add((rl, "none", "zs_none"), R_none @ enc.encode([DESC[rl][c] for c in cats]).T)
            add((rl, "none", "pr_none"), probe(R_none))
            for il in instr_langs:
                # "canon" = EmbeddingGemma's own classification prompt ("task: classification"), English descriptions
                dl = "en" if il == "canon" else il
                D = enc.encode([DESC[dl][c] for c in cats])
                Q = enc.encode([DESC[dl][c] for c in cats], "search result" if il == "canon" else RETRIEVE[il])
                add((rl, il, "zs_cat"), R_none @ Q.T)
                R_gen = enc.encode(texts, "classification" if il == "canon" else GENERIC[il])
                add((rl, il, "zs_gen"), R_gen @ D.T)
                add((rl, il, "pr_gen"), probe(R_gen))
                if il == "canon":
                    continue
                zs, pr = [], []
                for j, c in enumerate(cats):
                    R_c = enc.encode(texts, SPECIFIC[il][c])
                    zs.append(R_c @ D[j])
                    pr.append(oof_binary(R_c, y == c, groups))
                add((rl, il, "zs_spec"), np.stack(zs, 1))
                add((rl, il, "pr_spec"), np.stack(pr, 1))
        elif enc.is_vertex and rl == "ja":
            # Vertex has no free-text instruction, only task_type; the instr column holds the task type
            names = [DESC["ja"][c] for c in cats]
            R_none = enc.encode(texts)
            add(("ja", "none", "zs_none"), R_none @ enc.encode(names).T)
            add(("ja", "none", "pr_none"), probe(R_none))
            for task in instr_langs:
                R = enc.encode(texts, task)
                q_task = "RETRIEVAL_QUERY" if task == "RETRIEVAL_DOCUMENT" else task
                add(("ja", task, "zs_gen"), R @ enc.encode(names, q_task).T)
                add(("ja", task, "pr_gen"), probe(R))
        elif rl == "ja":
            # ruri reference: fixed prefixes, Japanese only
            R_plain = enc.encode(texts, prefix="")
            R_topic = enc.encode(texts, prefix="トピック: ")
            R_doc = enc.encode(texts, prefix="検索文書: ")
            names = [DESC["ja"][c] for c in cats]
            add(("ja", "none", "zs_none"), R_plain @ enc.encode(names, prefix="").T)
            add(("ja", "none", "pr_none"), probe(R_plain))
            add(("ja", "ja", "zs_cat"), R_doc @ enc.encode(names, prefix="検索クエリ: ").T)
            add(("ja", "ja", "zs_gen"), R_topic @ enc.encode(names, prefix="トピック: ").T)
            add(("ja", "ja", "pr_gen"), probe(R_topic))

    # bootstrap over reviews: shared resamples, so differences between conditions are paired
    rng = np.random.default_rng(0)
    n = len(items)
    idxs = [rng.integers(0, n, n) for _ in range(BOOT)]
    boots = {}
    for key, r in rows.items():
        vals = []
        for ix in idxs:
            yy = y[ix]
            aps = [average_precision_score(yy == c, r["score"][ix, j]) for j, c in enumerate(cats) if (yy == c).sum() > 0]
            vals.append(np.mean(aps))
        boots[key] = np.array(vals)
        r["ci95"] = [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]

    out = {"tag": tag, "n": n, "categories": cats, "label_counts": {k: int(v) for k, v in Counter(y).items()}, "rows": [], "diffs": []}
    for (rl, il, mode), r in rows.items():
        out["rows"].append({"review": rl, "instr": il, "mode": mode, "macro_ap": round(r["macro_ap"], 4),
                            "ci95": [round(v, 4) for v in r["ci95"]],
                            "per_class": {c: round(v, 4) for c, v in r["per_class"].items()},
                            "false_alarm_at_recall80": {c: round(v, 4) for c, v in r["false_alarm"].items()}})
    # raw scores, so different models can be compared on the same resamples afterwards
    out["_scores"] = {"|".join(k): r["score"] for k, r in rows.items()}
    out["_y"] = y
    out["_stream"] = stream

    def diff(a, b):
        if a in boots and b in boots:
            d = boots[a] - boots[b]
            out["diffs"].append({"a": list(a), "b": list(b), "diff": round(rows[a]["macro_ap"] - rows[b]["macro_ap"], 4),
                                 "ci95": [round(float(np.percentile(d, 2.5)), 4), round(float(np.percentile(d, 97.5)), 4)]})

    # each condition against condition 1 (ja instruction + ja review) in the same mode,
    # and each instructed mode against its no-instruction baseline
    for mode in ("zs_cat", "zs_gen", "zs_spec", "pr_gen", "pr_spec"):
        base = "zs_none" if mode.startswith("zs") else "pr_none"
        for rl in review_langs:
            for il in instr_langs:
                if (rl, il) != ("ja", "ja"):
                    diff((rl, il, mode), ("ja", "ja", mode))
                diff((rl, il, mode), (rl, "none", base))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--models", nargs="+", required=True)
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()

    items = load_corpus(args.corpus)
    ja = [o for o in items if o["lang"] == "ja" and o["text_en"]]
    print(f"corpus {len(items)} | japanese originals with an English translation {len(ja)}", flush=True)
    print("labels:", dict(Counter(o["label"] for o in ja)), flush=True)

    result = {"corpus": {"total": len(items), "ja_with_en": len(ja)}, "minpos": MINPOS, "boot": BOOT,
              "probe_C": PROBE_C, "models": {}}
    for name in args.models:
        print(f"\n=== {name}", flush=True)
        enc = Encoder(name, args.device)
        if enc.is_qwen:
            rls, ils = ["ja", "en"], ["ja", "en", "zh"]
        elif enc.is_gemma:
            rls, ils = ["ja"], ["ja", "en", "zh", "canon"]
        elif enc.is_vertex:
            rls, ils = ["ja"], ["CLASSIFICATION", "SEMANTIC_SIMILARITY", "RETRIEVAL_DOCUMENT"]
        else:
            rls, ils = ["ja"], ["ja"]
        run = run_subset(enc, ja, rls, ils, "ja originals + Google English translation")
        stance = stance_test(enc, ja, rls, ils) if (enc.instructable or enc.is_vertex) else None
        # one .scores.npz per model: with several --models, the file name carries the model name
        npz = args.out.replace(".json", "") + ("" if len(args.models) == 1 else "." + name.split("/")[-1].replace(":", "-")) + ".scores.npz"
        np.savez_compressed(npz, y=run.pop("_y"), stream=run.pop("_stream"), cats=np.array(run["categories"]), **run.pop("_scores"))
        result["models"][name] = {"run": run, "stance_price_hike": stance, "texts_per_sec": round(enc.n / max(enc.sec, 1e-9), 1),
                                  "texts": enc.n, "dim": int(enc.encode(["x"]).shape[1]),
                                  "vertex_chars_billed": enc.vertex.chars if enc.is_vertex else None}
        print(f"-- n={run['n']} cats={run['categories']}")
        for r in sorted(run["rows"], key=lambda r: (r["mode"], r["review"], r["instr"])):
            fa = r["false_alarm_at_recall80"]
            fa_txt = f" false-alarm@80%recall={np.mean(list(fa.values())):.3f}" if fa else ""
            print(f"{r['mode']:8s} review={r['review']} instr={r['instr']:4s} mAP={r['macro_ap']:.3f} [{r['ci95'][0]:.3f},{r['ci95'][1]:.3f}]{fa_txt}", flush=True)
        if stance:
            print(f"-- price-hike stance n={stance['n']} (unhappy {stance['unhappy']}, accepting {stance['accepting']})")
            for r in stance["rows"]:
                print(f"stance   review={r['review']} instr={r['instr']:4s} zs_auc={r['zs_auc']:.2f} {r['zs_ci95']} probe_auc={r['probe_auc']:.2f} {r['probe_ci95']}", flush=True)
        print(f"speed {result['models'][name]['texts_per_sec']} texts/s over {enc.n} texts", flush=True)
        json.dump(result, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        if enc.model is not None:
            import torch

            del enc
            torch.cuda.empty_cache()
    print("BENCH_DONE", flush=True)


if __name__ == "__main__":
    main()
