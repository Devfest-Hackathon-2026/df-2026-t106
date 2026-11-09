# classify: Joren's cloud service (拡張機能 only)

The extension calls this service only while the popup's 拡張機能（クラウド） switch is on; it is off by default.
It runs on Cloud Run CPU in Tokyo (asia-northeast1), with request-based billing, and scales to zero.
It has two jobs:

1. **Review warnings.** Vertex AI `gemini-embedding-001` (asia-northeast1) plus our logistic heads (`heads.json`).
   The heads are trained by `apps/extension/scripts/d2-train-heads.py --model vertex:gemini-embedding-001` on a
   labelled review corpus. That corpus is verbatim Maps reviews, so it is not in the repo. Model choice and
   numbers: `apps/extension/fixtures/direction2-bench/model-compare.txt`.
2. **Shared votes.** Each Gemini Nano judgment becomes one vote per question, place and user. Votes are kept
   private; the service publishes a uid-free tally per place.

## API

Every POST needs `Authorization: Bearer <Firebase ID token>`; the extension uses Firebase anonymous auth.

| Endpoint | Body | Answer |
|---|---|---|
| `POST /classify` | `{"items": [{"id": "<review id>", "text": "..."}]}` (≤ 200) | `{"model", "verdicts": [{"id", "p": {price, surprise_charge, quality_decline, hygiene, service, improvement, staff_change}, "labels", "stance"}]}` |
| `POST /report` | `{"reports": [{"key": "<meal>~<fid>", "meal", "fid", "verdict", "v", "source"?, "yen"?, "yenSource"?}]}` (≤ 50) | `{"saved": n}` |
| `GET /health` | | `{"ok": true, "model", "categories"}` |

- **`stance`** is set only for `price` labels: 1 means unhappy about the rise, 0 means the writer accepts it.
- **Not `/healthz`:** Cloud Run reserves paths that end in "z", so they never reach the service.
- **Over the daily limit:** both POST endpoints answer `429 {"detail": "quota"}`.

## Firestore (only this service's account can read or write; see `firestore.rules`)

| Collection | What | Public? |
|---|---|---|
| `verdicts/h_<sha256(review id + "\0" + text)>` | Category probabilities for one review text. Never the text itself. | no |
| `reports/{meal~fid~uid}` | One vote. | no |
| `tallies/{meal~fid~v}` | Majority verdict, median ¥, `agree` / `total` counts. No uid. | read-only |
| `usage/{yyyymmdd~uid}`, `usage/{yyyymmdd~_all}` | Daily counters for the limits. | no |

**Verdict cache key.** The cache is keyed by the review id together with the text that was embedded. Made-up
text sent under a real review id therefore creates its own entry and never changes the verdict an honest client
gets. Entries written before this key existed (doc id = review id) are still read, but never written again.

**Tallies.** The extension uses a tally only when at least 2 users agree (`MIN_AGREE` in
`apps/extension/lib/lunchStore.ts`); otherwise it judges the place locally. Votes older than 30 days, and votes
made under another rules version (`v`), don't count.

## Limits (env vars; per UTC day)

| Env | Default | Counts |
|---|---|---|
| `CLASSIFY_PER_USER` / `CLASSIFY_PER_DAY` | 3,000 / 30,000 | new embeddings only (cache misses: the only part that costs money) |
| `REPORT_PER_USER` / `REPORT_PER_DAY` | 3,000 / 100,000 | votes |

On top of these limits, each request is capped (200 reviews, 3,000 characters embedded per review), and the
service runs on at most 3 instances.

## Tests (no network: in-memory store, fake Vertex)

```
pip install -r services/classify/requirements-dev.txt  # pinned to the live image + httpx for TestClient
python -m unittest discover -s services/classify -v     # from the repo root
```

The same tests run in CI (`.github/workflows/ci.yml`) on every push.

## Local run

```
gcloud auth application-default login   # once
REQUIRE_AUTH=0 STORE=memory uvicorn main:app --port 8080
curl -s localhost:8080/classify -H 'content-type: application/json' \
  -d '{"items":[{"id":"a","text":"ラーメンが1000円を超えた。前は800円だったのに。"}]}'
```

## Deploy (once per change)

```
gcloud iam service-accounts create classify-svc --project gmap-extension
gcloud projects add-iam-policy-binding gmap-extension --member serviceAccount:classify-svc@gmap-extension.iam.gserviceaccount.com --role roles/aiplatform.user
gcloud projects add-iam-policy-binding gmap-extension --member serviceAccount:classify-svc@gmap-extension.iam.gserviceaccount.com --role roles/datastore.user
gcloud run deploy classify --source . --region asia-northeast1 --project gmap-extension \
  --service-account classify-svc@gmap-extension.iam.gserviceaccount.com \
  --cpu 1 --memory 512Mi --concurrency 40 --timeout 60 --min-instances 0 --max-instances 3 --allow-unauthenticated
```

`--allow-unauthenticated` applies at the Cloud Run level only; the app itself requires a Firebase ID token.

**Cost:** Vertex charges $0.15 per 1M input tokens, about $0.002 per store of 100 reviews. Cloud Run CPU is billed
only while a request runs, so an idle service costs $0. A billing budget alert on the project notifies the owner
(it never stops the service).
