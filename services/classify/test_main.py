"""
Tests for the cloud service without network: Firestore is MemoryStore, Vertex is a fake.
Run from the repo root:  python -m unittest discover -s services/classify -v
"""
import hashlib
import os
import unittest

os.environ.setdefault("STORE", "memory")
os.environ.setdefault("REQUIRE_AUTH", "1")

import numpy as np  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

DAY = 24 * 3600_000
FID = "0x6018b55de3df5aeb:0xb6e2b6457172feae"


class FakeVertex:
    """Deterministic unit vectors per text; counts what was embedded."""

    def __init__(self):
        self.seen: list[str] = []

    def embed(self, texts):
        self.seen += texts
        X = np.stack([np.random.default_rng(int(hashlib.sha256(t.encode()).hexdigest()[:8], 16)).normal(size=main.heads.dim) for t in texts])
        return (X / np.linalg.norm(X, axis=1, keepdims=True)).astype(np.float32)


async def uid_from_header(request: Request) -> str:
    return request.headers.get("x-test-uid", "u1")


class Base(unittest.TestCase):
    def setUp(self):
        main.store = main.MemoryStore()
        self.fake = FakeVertex()
        main._lazy["vertex"] = self.fake
        self.limits = dict(main.LIMITS)
        main.app.dependency_overrides[main.require_user] = uid_from_header
        self.client = TestClient(main.app)

    def tearDown(self):
        main.LIMITS.clear()
        main.LIMITS.update(self.limits)
        main.app.dependency_overrides.clear()

    def classify(self, items, uid="u1"):
        return self.client.post("/classify", json={"items": [{"id": i, "text": t} for i, t in items]}, headers={"x-test-uid": uid})

    def vote(self, who, **over):
        r = {"key": f"lunch~{FID}", "meal": "lunch", "fid": FID, "verdict": "menu", "v": "r6n2", **over}
        return self.client.post("/report", json={"reports": [r]}, headers={"x-test-uid": who})


class Endpoints(Base):
    def test_health_path_is_not_reserved(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

    def test_token_required(self):
        main.app.dependency_overrides.clear()
        self.assertEqual(self.classify([("r1", "x")]).status_code, 401)
        self.assertEqual(self.vote("u1").status_code, 401)


class Classify(Base):
    def test_made_up_text_never_changes_the_verdict_of_the_real_review(self):
        bad = self.classify([("r1", "店内にゴキブリがいた。不衛生。")], uid="attacker").json()["verdicts"][0]
        real = self.classify([("r1", "親子丼が美味しい。また来たい。")], uid="honest").json()["verdicts"][0]
        self.assertEqual(self.fake.seen, ["店内にゴキブリがいた。不衛生。", "親子丼が美味しい。また来たい。"], "the real text is embedded, not served from the attacker's entry")
        self.assertNotEqual(bad["p"], real["p"])
        self.assertEqual(len(main.store.verdicts), 2)
        self.assertTrue(all(k.startswith("h_") for k in main.store.verdicts))

    def test_same_review_and_text_is_embedded_once_for_everyone(self):
        self.classify([("r1", "値上げした。"), ("r1", "値上げした。")], uid="a")
        self.classify([("r1", " 値上げした。 ")], uid="b")  # same text after strip
        self.assertEqual(self.fake.seen, ["値上げした。"])

    def test_old_cache_entries_are_read_but_never_written(self):
        old = {"model": main.MODEL_VERSION, "p": {"hygiene": 0.9}, "labels": ["hygiene"], "stance": None}
        main.store.verdicts["rOld"] = old
        main.store.verdicts["rStale"] = {**old, "model": "qwen/heads-v0"}
        out = {v["id"]: v for v in self.classify([("rOld", "どんな文でも"), ("rStale", "古いモデル")]).json()["verdicts"]}
        self.assertEqual(out["rOld"]["labels"], ["hygiene"])
        self.assertEqual(self.fake.seen, ["古いモデル"], "an entry of another model version is not trusted")
        self.assertEqual(main.store.verdicts["rStale"]["model"], "qwen/heads-v0", "old-style ids are never written")

    def test_per_user_quota_counts_new_embeddings_only(self):
        main.LIMITS["classify"] = (2, 100)
        self.assertEqual(self.classify([("a", "1"), ("b", "2")]).status_code, 200)
        self.assertEqual(self.classify([("a", "1"), ("b", "2")]).status_code, 200, "cache hits are free")
        r = self.classify([("c", "3")])
        self.assertEqual((r.status_code, r.json()["detail"]), (429, "quota"))
        self.assertEqual(self.fake.seen, ["1", "2"], "nothing is embedded once over the limit")
        self.assertEqual(self.classify([("c", "3")], uid="other").status_code, 200, "the limit is per user")

    def test_daily_cap_for_everyone(self):
        main.LIMITS["classify"] = (100, 3)
        self.assertEqual(self.classify([("a", "1"), ("b", "2")], uid="x").status_code, 200)
        self.assertEqual(self.classify([("c", "3"), ("d", "4")], uid="y").status_code, 429)
        self.assertEqual(self.classify([("c", "3")], uid="y").status_code, 200)


class Reports(Base):
    def test_invalid_votes_are_refused(self):
        bad = [
            {"meal": "steak", "key": f"steak~{FID}"},                # not a shared question
            {"fid": "ChIJ123", "key": "lunch~ChIJ123"},              # not a Maps fid
            {"key": "lunch~0x1:0x2"},                                # key does not match
            {"verdict": "none", "yen": 900},                         # price on a "none" verdict
            {"yen": 120},                                            # price out of range
            {"yenSource": "menu"},                                   # source without a price
            {"geo": "xn76ur"},                                       # position is no longer accepted
            {"v": "r6/../x"},                                        # would break the tally doc id
            {"uid": "someone-else"},                                 # the server decides the uid
        ]
        for over in bad:
            with self.subTest(over=over):
                self.assertEqual(self.vote("u1", **over).status_code, 422)
        self.assertEqual(main.store.votes, {})
        many = [{"key": f"lunch~{FID}", "meal": "lunch", "fid": FID, "verdict": "menu", "v": "r6n2"}] * 51
        self.assertEqual(self.client.post("/report", json={"reports": many}).status_code, 422)

    def test_one_vote_per_user_and_the_public_tally_has_no_uid(self):
        self.assertEqual(self.vote("a", yen=1000, yenSource="menu", source="menu").status_code, 200)
        t = main.store.tallies[f"lunch~{FID}~r6n2"]
        self.assertEqual((t["verdict"], t["agree"], t["total"], t["yen"]), ("menu", 1, 1, 1000))
        self.vote("a", yen=1000, yenSource="menu")  # same user again: replaces, does not add
        self.assertEqual(main.store.tallies[f"lunch~{FID}~r6n2"]["agree"], 1)
        self.vote("b", yen=1200, yenSource="owner", source="owner")
        t = main.store.tallies[f"lunch~{FID}~r6n2"]
        self.assertEqual((t["agree"], t["total"], t["yen"], t["yenSource"], t["source"]), (2, 2, 1100, "owner", "owner"), "1–1 tie on yenSource: the newest vote, as in lunchStore.ts")
        self.assertEqual(sorted(main.store.votes), [f"lunch~{FID}~a", f"lunch~{FID}~b"])
        self.assertNotIn("uid", t)
        self.assertEqual(set(t), {"key", "meal", "fid", "v", "verdict", "agree", "total", "at", "source", "yen", "yenSource"})

    def test_votes_of_another_version_make_their_own_tally(self):
        self.vote("a")
        self.vote("b", v="r7n2", verdict="none")
        self.assertEqual(main.store.tallies[f"lunch~{FID}~r6n2"]["verdict"], "menu")
        self.assertEqual(main.store.tallies[f"lunch~{FID}~r7n2"]["verdict"], "none")

    def test_report_quota(self):
        main.LIMITS["report"] = (1, 100)
        self.assertEqual(self.vote("a").status_code, 200)
        self.assertEqual(self.vote("a", verdict="none").status_code, 429)
        self.assertEqual(main.store.votes[f"lunch~{FID}~a"]["verdict"], "menu")


class Aggregate(unittest.TestCase):
    def v(self, uid, verdict, at, **kw):
        return {"uid": uid, "verdict": verdict, "v": "r6", "at": at, **kw}

    def test_majority_ties_to_newest_and_median_of_agreeing(self):
        now = 10 * DAY
        a = main.aggregate([
            self.v("a", "menu", 1000, yen=1000, yenSource="menu"),
            self.v("b", "menu", 1100, yen=1215, yenSource="menu"),
            self.v("c", "none", 1900),
            {**self.v("d", "none", 1950), "v": "r0"},
        ], "r6", now)
        self.assertEqual((a["verdict"], a["agree"], a["total"], a["at"]), ("menu", 2, 3, 1100))
        self.assertEqual(a["yen"], 1110, "even count: mean rounded half-up to 10 yen, like Math.round in lunchStore.ts")
        tie = main.aggregate([self.v("a", "menu", 1000), self.v("b", "closed", 1500)], "r6", now)
        self.assertEqual(tie["verdict"], "closed")

    def test_old_votes_expire(self):
        self.assertIsNone(main.aggregate([self.v("a", "menu", 0)], "r6", 31 * DAY))
        self.assertIsNotNone(main.aggregate([self.v("a", "menu", 0)], "r6", 29 * DAY))

    def test_cache_key_is_bound_to_the_text(self):
        self.assertNotEqual(main.cache_key("r1", "a"), main.cache_key("r1", "b"))
        self.assertNotEqual(main.cache_key("r1", "a"), main.cache_key("r2", "a"))
        self.assertEqual(main.cache_key("r1", "a"), main.cache_key("r1", "a"))


if __name__ == "__main__":
    unittest.main()
