"""
Joren's cloud service (拡張機能 only; off by default in the extension). Three endpoints:

POST /classify  {"items": [{"id": "<review id>", "text": "<review text>"}, ...]}  (<= 200 items)
  -> {"model": MODEL_VERSION, "verdicts": [{"id", "p": {category: probability}, "labels": [...], "stance": float | null}]}
  Review-warning classifier: Vertex AI `gemini-embedding-001` embeds each review (one vector, no
  task_type); one logistic head per category gives independent probabilities, so a review may carry
  several labels; the stance head says, for reviews labelled `price`, how unhappy the writer is
  (1 = unhappy, 0 = "went up but still worth it"). Heads: apps/extension/scripts/d2-train-heads.py.

POST /report  {"reports": [{"key", "meal", "fid", "verdict", "v", "source"?, "yen"?, "yenSource"?}, ...]}  (<= 50)
  -> {"saved": n}
  One Gemini Nano judgment per (question, place, user). Votes are private (`reports/{key}~{uid}`,
  server-only); the server recomputes the public, uid-free aggregate `tallies/{key}~{v}` in the same
  transaction. Clients read only tallies (firestore.rules).

GET /health -> {"ok": true, ...}   (not /healthz: Cloud Run reserves paths ending in "z")

Security (see the threat model in the root README):
- Auth: a Firebase ID token (the extension's anonymous user) in `Authorization: Bearer`.
- Verdict cache `verdicts/h_<sha256(review id + text)>` (probabilities only, never the text): made-up
  text can only ever create its own entry, never change the verdict an honest client gets for a real
  review. Entries written before the hash key (doc id = review id) are still read, never written.
- Daily quotas per user and for everyone (`usage/{yyyymmdd}~{uid|_all}`): new embeddings and votes.
  Over the limit -> 429 "quota". Limits come from env vars.
"""
import asyncio
import hashlib
import json
import logging
import math
import os
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Literal, Optional

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_VERSION = "gemini-embedding-001/heads-v1"
HEADS_PATH = os.environ.get("HEADS_PATH", os.path.join(HERE, "heads.json"))
PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "gmap-extension")
REGION = os.environ.get("VERTEX_REGION", "asia-northeast1")
EMBED_MODEL = "gemini-embedding-001"
MAX_ITEMS = 200
MAX_CHARS = 3000
MAX_REPORTS = 50
THREADS = 16
REQUIRE_AUTH = os.environ.get("REQUIRE_AUTH", "1") == "1"
STORE = os.environ.get("STORE", "firestore")  # firestore | memory (local runs)

# Daily limits. "classify" counts new embeddings only (cache misses: the only part that costs money).
LIMITS = {
    "classify": (int(os.environ.get("CLASSIFY_PER_USER", "3000")), int(os.environ.get("CLASSIFY_PER_DAY", "30000"))),
    "report": (int(os.environ.get("REPORT_PER_USER", "3000")), int(os.environ.get("REPORT_PER_DAY", "100000"))),
}

# Shared votes. SHARED_IDS = the questions whose answer comes from Gemini Nano (apps/extension/lib/questions.ts;
# tests/lunch.test.ts checks both lists are the same).
SHARED_IDS = set(json.load(open(os.path.join(HERE, "shared_ids.json"), encoding="utf-8")))
SHARED_TTL_MS = 30 * 24 * 3600_000
FID = re.compile(r"0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16}")
VERSION = re.compile(r"[A-Za-z0-9._-]{1,16}")

log = logging.getLogger("classify")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
app = FastAPI(title="joren cloud")


class Quota(Exception):
    """A daily limit would be exceeded; nothing was counted."""


# ---------------------------------------------------------------- request shapes

class Item(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=20000)


class ClassifyIn(BaseModel):
    items: list[Item] = Field(max_length=MAX_ITEMS)


class Vote(BaseModel):
    """Mirrors `Report` in apps/extension/lib/lunchStore.ts. Unknown fields are refused."""
    model_config = ConfigDict(extra="forbid")
    key: str
    meal: str
    fid: str
    verdict: Literal["menu", "likely", "none", "closed"]
    v: str
    source: Optional[Literal["menu", "hours", "owner", "review"]] = None
    yen: Optional[int] = None
    yenSource: Optional[Literal["menu", "owner", "review"]] = None

    @model_validator(mode="after")
    def check(self):
        if self.meal not in SHARED_IDS:
            raise ValueError("meal")
        if not FID.fullmatch(self.fid):
            raise ValueError("fid")
        if self.key != f"{self.meal}~{self.fid}":
            raise ValueError("key")
        if not VERSION.fullmatch(self.v):
            raise ValueError("v")
        if self.yen is not None and not (500 <= self.yen <= 10000 and self.verdict in ("menu", "likely")):
            raise ValueError("yen")
        if self.yenSource is not None and self.yen is None:
            raise ValueError("yenSource")
        return self


class ReportIn(BaseModel):
    reports: list[Vote] = Field(min_length=1, max_length=MAX_REPORTS)


# ---------------------------------------------------------------- pure helpers

def cache_key(review_id: str, text: str) -> str:
    """Doc id of a verdict: bound to the exact text that was embedded, so other text can never reuse it."""
    return "h_" + hashlib.sha256(f"{review_id}\0{text}".encode("utf-8")).hexdigest()


def day(now_ms: int) -> str:
    return time.strftime("%Y%m%d", time.gmtime(now_ms / 1000))


def _median_yen(xs: list[int]) -> int:
    """Same as lib/lunchStore.ts: middle value; for an even count the mean rounded to 10 yen (half up, like Math.round)."""
    s = sorted(xs)
    m = len(s) // 2
    return s[m] if len(s) % 2 else math.floor((s[m - 1] + s[m]) / 20 + 0.5) * 10


def aggregate(votes: list[dict], v: str, now_ms: int) -> Optional[dict]:
    """
    Everyone's votes for one place -> the public tally for version `v`: majority verdict (ties -> the
    newest vote), ¥ = median of the agreeing votes. Votes of other versions or older than 30 days
    don't count. Each vote: {"uid", "verdict", "v", "at" (ms), "source"?, "yen"?, "yenSource"?}.
    """
    ok = sorted((x for x in votes if x["v"] == v and now_ms - x["at"] < SHARED_TTL_MS), key=lambda x: -x["at"])
    if not ok:
        return None
    counts = Counter(x["verdict"] for x in ok)
    top = max(counts.values())
    newest = next(x for x in ok if counts[x["verdict"]] == top)
    agree = [x for x in ok if x["verdict"] == newest["verdict"]]
    out = {"verdict": newest["verdict"], "agree": len(agree), "total": len(ok), "at": newest["at"]}
    if newest.get("source"):
        out["source"] = newest["source"]
    priced = [x for x in agree if x.get("yen") is not None]
    if priced:
        out["yen"] = _median_yen([x["yen"] for x in priced])
        srcs = [x["yenSource"] for x in priced if x.get("yenSource")]
        if srcs:
            out["yenSource"] = Counter(srcs).most_common(1)[0][0]
    return out


def vote_doc(vote: Vote, uid: str, now_ms: int) -> dict:
    d = {k: val for k, val in vote.model_dump().items() if val is not None}
    return {**d, "uid": uid, "at": now_ms}


def tally_doc(vote: Vote, agg: dict) -> dict:
    return {"key": vote.key, "meal": vote.meal, "fid": vote.fid, "v": vote.v, **agg}


def merge_place(existing: list[dict], vote: Vote, uid: str, now_ms: int) -> tuple[dict, Optional[dict]]:
    """One user's new vote replaces their old one; returns (vote doc, tally doc for the vote's version)."""
    mine = vote_doc(vote, uid, now_ms)
    votes = [x for x in existing if x["uid"] != uid] + [mine]
    agg = aggregate(votes, vote.v, now_ms)
    return mine, (tally_doc(vote, agg) if agg else None)


def check_quota(used_user: int, used_all: int, kind: str, n: int) -> bool:
    per_user, per_day = LIMITS[kind]
    return used_user + n <= per_user and used_all + n <= per_day


# ---------------------------------------------------------------- storage

class MemoryStore:
    """In-memory stand-in for Firestore (tests, local runs with STORE=memory)."""

    def __init__(self):
        self.verdicts: dict[str, dict] = {}
        self.usage: dict[str, Counter] = {}
        self.votes: dict[str, dict] = {}   # "{key}~{uid}" -> vote doc
        self.tallies: dict[str, dict] = {}  # "{key}~{v}" -> tally doc

    def get_verdicts(self, ids):
        return {i: self.verdicts[i] for i in ids if i in self.verdicts}

    def put_verdicts(self, items):
        self.verdicts.update({k: {"model": MODEL_VERSION, **v} for k, v in items.items()})

    def take(self, uid, kind, n, now_ms):
        u = self.usage.setdefault(f"{day(now_ms)}~{uid}", Counter())
        a = self.usage.setdefault(f"{day(now_ms)}~_all", Counter())
        if not check_quota(u[kind], a[kind], kind, n):
            raise Quota(kind)
        u[kind] += n
        a[kind] += n

    def save_votes(self, uid, votes, now_ms):
        for vote in votes:
            existing = [x for k, x in self.votes.items() if x["key"] == vote.key]
            mine, tally = merge_place(existing, vote, uid, now_ms)
            self.votes[f"{vote.key}~{uid}"] = mine
            if tally:
                self.tallies[f"{vote.key}~{vote.v}"] = tally


class FirestoreStore:
    """Firestore through the service account (firebase-admin). Clients can't touch these collections."""

    def __init__(self):
        self._db = None

    def db(self):
        if self._db is None:
            import firebase_admin
            from firebase_admin import firestore

            if not firebase_admin._apps:
                firebase_admin.initialize_app(options={"projectId": PROJECT})
            self._db = firestore.client()
        return self._db

    def get_verdicts(self, ids):
        db, found = self.db(), {}
        for i in range(0, len(ids), 100):
            refs = [db.collection("verdicts").document(x) for x in ids[i:i + 100]]
            for snap in db.get_all(refs):
                if snap.exists:
                    found[snap.id] = snap.to_dict()
        return found

    def put_verdicts(self, items):
        from firebase_admin import firestore

        db, keys = self.db(), list(items)
        for i in range(0, len(keys), 400):
            batch = db.batch()
            for k in keys[i:i + 400]:
                batch.set(db.collection("verdicts").document(k), {"model": MODEL_VERSION, **items[k], "at": firestore.SERVER_TIMESTAMP})
            batch.commit()

    def take(self, uid, kind, n, now_ms):
        from firebase_admin import firestore

        db = self.db()
        mine = db.collection("usage").document(f"{day(now_ms)}~{uid}")
        everyone = db.collection("usage").document(f"{day(now_ms)}~_all")

        @firestore.transactional
        def txn(t):
            u, a = (s.to_dict() or {} for s in (mine.get(transaction=t), everyone.get(transaction=t)))
            if not check_quota(u.get(kind, 0), a.get(kind, 0), kind, n):
                raise Quota(kind)
            t.set(mine, {kind: firestore.Increment(n)}, merge=True)
            t.set(everyone, {kind: firestore.Increment(n)}, merge=True)

        txn(db.transaction())

    def save_votes(self, uid, votes, now_ms):
        from firebase_admin import firestore
        from google.cloud.firestore_v1.base_query import FieldFilter

        db = self.db()
        for vote in votes:
            q = db.collection("reports").where(filter=FieldFilter("key", "==", vote.key))

            @firestore.transactional
            def txn(t):
                existing = [_vote_from_doc(s.to_dict()) for s in q.stream(transaction=t)]
                mine, tally = merge_place([x for x in existing if x], vote, uid, now_ms)
                doc = {k: val for k, val in mine.items() if k != "at"}
                doc["checkedAt"] = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)
                t.set(db.collection("reports").document(f"{vote.key}~{uid}"), doc)
                if tally:
                    t.set(db.collection("tallies").document(f"{vote.key}~{vote.v}"), tally)

            txn(db.transaction())


def _vote_from_doc(d: dict) -> Optional[dict]:
    """A stored vote (checkedAt = Firestore timestamp) in aggregate()'s shape; old docs may carry `geo`, ignored."""
    try:
        at = int(d["checkedAt"].timestamp() * 1000)
        out = {"uid": d["uid"], "verdict": d["verdict"], "v": d["v"], "at": at}
    except (KeyError, AttributeError, TypeError):
        return None
    for k in ("source", "yen", "yenSource"):
        if d.get(k) is not None:
            out[k] = d[k]
    return out


store = MemoryStore() if STORE == "memory" else FirestoreStore()


# ---------------------------------------------------------------- model

class Heads:
    def __init__(self, path):
        h = json.load(open(path, encoding="utf-8"))
        self.cats = [c["name"] for c in h["categories"]]
        self.W = np.array([c["w"] for c in h["categories"]], dtype=np.float32)  # cats x dim
        self.b = np.array([c["b"] for c in h["categories"]], dtype=np.float32)
        self.thr = np.array([c["threshold"] for c in h["categories"]], dtype=np.float32)
        self.sw = np.array(h["stance"]["w"], dtype=np.float32)
        self.sb = float(h["stance"]["b"])
        self.dim = h["dim"]

    def apply(self, X):
        """X: n x dim, L2-normalised. Returns verdict dicts (without ids)."""
        P = 1 / (1 + np.exp(-(X @ self.W.T + self.b)))
        S = 1 / (1 + np.exp(-(X @ self.sw + self.sb)))
        out = []
        for i in range(len(X)):
            labels = [c for j, c in enumerate(self.cats) if P[i, j] >= self.thr[j]]
            out.append({"p": {c: round(float(P[i, j]), 4) for j, c in enumerate(self.cats)}, "labels": labels,
                        "stance": round(float(S[i]), 4) if "price" in labels else None})
        return out


class Vertex:
    """gemini-embedding-001 over REST with the service account's credentials; one text per request."""

    def __init__(self):
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        self.session = AuthorizedSession(creds)
        self.url = (f"https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}"
                    f"/publishers/google/models/{EMBED_MODEL}:predict")
        self.pool = ThreadPoolExecutor(THREADS)

    def _one(self, text):
        for attempt in range(5):
            r = self.session.post(self.url, json={"instances": [{"content": text}]}, timeout=30)
            if r.status_code == 200:
                return r.json()["predictions"][0]["embeddings"]["values"]
            if r.status_code not in (429, 500, 503):
                raise RuntimeError(f"vertex {r.status_code}: {r.text[:200]}")
            time.sleep(0.5 * 2 ** attempt)
        raise RuntimeError("vertex: gave up after retries")

    def embed(self, texts):
        X = np.array(list(self.pool.map(self._one, texts)), dtype=np.float32)
        return X / np.linalg.norm(X, axis=1, keepdims=True)


heads = Heads(HEADS_PATH)
_lazy = {}


def vertex():
    if "vertex" not in _lazy:
        _lazy["vertex"] = Vertex()
    return _lazy["vertex"]


def firebase():
    if "fb" not in _lazy:
        import firebase_admin

        _lazy["fb"] = firebase_admin._apps.get("[DEFAULT]") or firebase_admin.initialize_app(options={"projectId": PROJECT})
    return _lazy["fb"]


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------- endpoints

async def require_user(request: Request) -> str:
    if not REQUIRE_AUTH:
        return "dev"
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "missing token")
    from firebase_admin import auth as fb_auth

    try:
        firebase()
        claims = await asyncio.to_thread(fb_auth.verify_id_token, auth[7:])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(401, f"bad token: {e.__class__.__name__}") from e
    return claims["uid"]


def classify_sync(uid: str, items: list[Item]):
    texts = [it.text.strip()[:MAX_CHARS] for it in items]
    keys = [cache_key(it.id, t) for it, t in zip(items, texts)]
    found = {k: v for k, v in store.get_verdicts(sorted(set(keys))).items() if v.get("model") == MODEL_VERSION}
    # entries from before the hash key (doc id = review id): read-only, the service no longer writes them
    legacy_ids = sorted({it.id for it, k in zip(items, keys) if k not in found and "/" not in it.id})
    legacy = {k: v for k, v in store.get_verdicts(legacy_ids).items() if v.get("model") == MODEL_VERSION} if legacy_ids else {}
    todo = {}  # key -> text, each new text embedded once
    for it, t, k in zip(items, texts, keys):
        if k not in found and it.id not in legacy:
            todo.setdefault(k, t)
    fresh = {}
    if todo:
        store.take(uid, "classify", len(todo), now_ms())
        fresh = dict(zip(todo, heads.apply(vertex().embed(list(todo.values())))))
        try:
            store.put_verdicts(fresh)
        except Exception as e:  # noqa: BLE001  (a cache miss next time is fine)
            log.warning("cache write failed: %s", e)
    out = []
    for it, k in zip(items, keys):
        v = found.get(k) or legacy.get(it.id) or fresh[k]
        out.append({"id": it.id, "p": v["p"], "labels": v["labels"], "stance": v.get("stance")})
    return out, len(todo)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_VERSION, "categories": heads.cats}


@app.post("/classify")
async def classify(body: ClassifyIn, uid: str = Depends(require_user)):
    items = [it for it in body.items if it.text.strip()]
    if not items:
        return {"model": MODEL_VERSION, "verdicts": []}
    t0 = time.perf_counter()
    try:
        verdicts, n_new = await asyncio.to_thread(classify_sync, uid, items)
    except Quota:
        log.info("uid=%s classify quota", uid[:8])
        raise HTTPException(429, "quota")
    log.info("uid=%s n=%d new=%d %.2fs", uid[:8], len(items), n_new, time.perf_counter() - t0)
    return {"model": MODEL_VERSION, "verdicts": verdicts}


@app.post("/report")
async def report(body: ReportIn, uid: str = Depends(require_user)):
    votes = list({v.key: v for v in body.reports}.values())  # one vote per place per request (the last)
    t = now_ms()
    try:
        await asyncio.to_thread(store.take, uid, "report", len(votes), t)
    except Quota:
        log.info("uid=%s report quota", uid[:8])
        raise HTTPException(429, "quota")
    await asyncio.to_thread(store.save_votes, uid, votes, t)
    log.info("uid=%s votes=%d", uid[:8], len(votes))
    return {"saved": len(votes)}
