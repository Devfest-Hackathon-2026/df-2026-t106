# Direction 2: model research for review warning signs (2026-11-06)

What this note covers: which models and services could flag warning signs in Google Maps reviews over time, and which of those to benchmark against Gemini Nano. The signs are price hikes, smaller portions, quality decline, owner or staff changes, bad service, hygiene, surprise charges and touts, reviews written for a reward, improvement or recovery, and the tone of owner replies. The models must also reject look-alikes such as 「値上げしても安い」.

Ground rules:

- Every fact about a model, a price or a limit has a link.
- "Unverified" means I could not confirm it on a primary page.
- Anything marked "estimate" is my own arithmetic. It is not a measurement.
- No accuracy on our task is known for any option. Nothing here was run, and no option has been tested on real Maps sentences yet.

Baseline today: Chrome's built-in Gemini Nano. It takes about 2 to 4 s per review, one review per prompt, queued. That makes 300 reviews take about 10 to 20 min (see memory note `gemini-nano-measurements`).

---

## 1. Off-the-shelf models

### 1a. Japanese sentiment classifiers (polarity only)

| Model | Task / labels | Lang | Size | License | Freshness / adoption | Covers without training |
|---|---|---|---|---|---|---|
| [christian-phu/bert-finetuned-japanese-sentiment](https://huggingface.co/christian-phu/bert-finetuned-japanese-sentiment) | 3-class positive / neutral / negative. Fine-tuned from cl-tohoku/bert-base-japanese-v2 on about 20k Amazon JP review sentences. Card reports acc 0.813 (split not stated). | ja | BERT-base, about 110M (inferred from the base model) | CC BY-SA 4.0 | lastModified 2023-04-07, about 255k downloads/month ([API](https://huggingface.co/api/models/christian-phu/bert-finetuned-japanese-sentiment)) | Generic negativity only |
| [koheiduck/bert-japanese-finetuned-sentiment](https://huggingface.co/koheiduck/bert-japanese-finetuned-sentiment) | No model card. Labels, data and base model are not stated. | ja | BERT (size not stated) | **Not stated** | lastModified 2022-12-20, about 8.3k downloads/month ([API](https://huggingface.co/api/models/koheiduck/bert-japanese-finetuned-sentiment/revision/main)) | Generic negativity only. Unusable without a license. |
| [jarvisx17/japanese-sentiment-analysis](https://huggingface.co/jarvisx17/japanese-sentiment-analysis) | Trained on **chABSA, which is securities-report text, not reviews**. Labels are not listed. | ja | 111M params | Not stated | lastModified 2024-01-20, about 2.5k downloads/month ([API](https://huggingface.co/api/models/jarvisx17/japanese-sentiment-analysis)) | Domain mismatch. Skip. |
| [Mizuiro-sakura/luke-japanese-large-sentiment-analysis-wrime](https://huggingface.co/Mizuiro-sakura/luke-japanese-large-sentiment-analysis-wrime) | 8 Plutchik emotions (joy, sadness, anticipation, surprise, anger, fear, disgust, trust), trained on WRIME (social media posts) | ja | about 0.4B | MIT (but WRIME itself is CC BY-NC-ND) | about 860 downloads/month, 44 likes | Anger or disgust might proxy bad service or hygiene (unknown) |
| [llm-book/bert-base-japanese-v3-wrime-sentiment](https://huggingface.co/llm-book/bert-base-japanese-v3-wrime-sentiment) | No model card (textbook example). WRIME polarity by name only. | ja | BERT-base | Not stated | about 1.1k downloads/month | Generic negativity |

### 1b. Multilingual sentiment (ja + zh + en + ko)

| Model | Labels | Training data | Size | License | Adoption |
|---|---|---|---|---|---|
| [tabularisai/multilingual-sentiment-analysis](https://huggingface.co/tabularisai/multilingual-sentiment-analysis) | 5-class, Very Negative to Very Positive | **Synthetic LLM-generated data only.** 23 languages including ja, ko, zh. | distilbert-multilingual, about 0.1B. ONNX copy exists ([onnx-community](https://huggingface.co/onnx-community/multilingual-sentiment-analysis-ONNX)). | **CC BY-NC 4.0** | about 111k downloads/month. Last news 2025-08. |
| [clapAI/modernBERT-base-multilingual-sentiment](https://huggingface.co/clapAI/modernBERT-base-multilingual-sentiment) | Examples show positive and negative only (neutral not mentioned) | [clapAI/MultiLingualSentiment](https://huggingface.co/datasets/clapAI/MultiLingualSentiment): 3.93M rows, 336k of them ja, with restaurant, hotel and product domains | about 150M. Test F1 80.16 on its own split. | Apache-2.0 | about 1.9k downloads/month. Sibling sizes exist: roberta-base/large, modernBERT-large, mmBERT-small. |
| [lxyuan/distilbert-base-multilingual-cased-sentiments-student](https://huggingface.co/lxyuan/distilbert-base-multilingual-cased-sentiments-student) | positive / neutral / negative. Distilled from MoritzLaurer mDeBERTa zero-shot (88% teacher agreement). | 12 languages including ja | about 0.1B | Apache-2.0 | about 757k downloads/month. Trained 2023. |
| [cardiffnlp/twitter-xlm-roberta-base-sentiment](https://huggingface.co/cardiffnlp/twitter-xlm-roberta-base-sentiment) | positive / neutral / negative | Tweets in 8 languages, **ja not among them** | XLM-R base | Not stated on card | about 766k downloads/month |

What sentiment models can do: they give overall polarity per sentence. None of them names the category, the direction of change, or whether a price remark is a complaint. A look-alike such as 「値上げしても安い」 may well come out positive. That would be the right outcome for us ("not a complaint"), but it is untested. At best they work as a cheap pre-filter or a "tone" feature.

### 1c. Aspect-based sentiment (ABSA)

| Model | Notes |
|---|---|
| [yangheng/deberta-v3-base-absa-v1.1](https://huggingface.co/yangheng/deberta-v3-base-absa-v1.1) | Input is a (sentence, aspect) pair. Output is Negative / Neutral / Positive. Trained on SemEval-2014/2016 and MAMS (about 30k samples). Title lists en, zh, ar, nl, fr, ru, es, tr. **Japanese not listed.** MIT, about 0.2B, about 50k downloads/month. The aspect is free text, so you could pass 「値段」 or 「量」, but it only gives polarity toward the aspect. It cannot tell "the price went up" from "the price is high". |
| [PyABSA](https://arxiv.org/pdf/2208.01368) multilingual checkpoints | Multilingual ATEPC and APC checkpoints exist. No Japanese checkpoint found ([checkpoint list](https://huggingface.co/spaces/yangheng/PyABSA/blob/137c88e4db6475ee048bd17dd71c9877afc3df7b/checkpoints-v2.0.json)). |
| [tomaarsen/setfit-absa-bge-small-en-v1.5-restaurants-aspect](https://huggingface.co/tomaarsen/setfit-absa-bge-small-en-v1.5-restaurants-aspect) / -polarity | English only (SemEval restaurants). Useful as a recipe, not as a model. |
| Japanese ABSA on HF | Only stray uploads with no model card: [nosflotsuki/absa-bert-japanese-multilabel-2](https://huggingface.co/nosflotsuki/absa-bert-japanese-multilabel-2) (42 downloads) and [kit-nlp/bert-base-japanese-review-feature-multi-label-analysis](https://huggingface.co/kit-nlp/bert-base-japanese-review-feature-multi-label-analysis) (empty README, Apache-2.0, 51 downloads). **No usable Japanese restaurant ABSA model found.** |

### 1d. Zero-shot NLI classifiers (any label written as a hypothesis)

| Model | Langs | Size | License | Adoption | Notes |
|---|---|---|---|---|---|
| [MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7) | NLI fine-tuning in 27 languages, **ja included**, but the training data is mostly machine-translated. XNLI eval has no ja. | 0.3B | MIT | about 836k downloads/month | 3-way entail / neutral / contradict. About 877 to 1,887 texts/s on an A100 (per card). No FP16. ONNX copy: [Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7](https://huggingface.co/Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7). |
| [MoritzLaurer/bge-m3-zeroshot-v2.0](https://huggingface.co/MoritzLaurer/bge-m3-zeroshot-v2.0) (and `-c`) | Multilingual (bge-m3 base). Card says multilingual is weaker than English and suggests translating to English. | 0.6B | MIT model. Training data has mixed licenses incl. non-commercial. `-c` = commercial-safe data only. | about 81k downloads/month | Binary entailment / not_entailment. 8k context. |
| [MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli](https://huggingface.co/MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli) | XNLI's 15 languages, ja not fine-tuned | about 0.1B | MIT | about 25k downloads/month | About 6,000 texts/s on an A100. Average XNLI 0.713 (weaker). |

What NLI could cover: in principle every category, because the label is a sentence. For example 「この店は以前より値段が上がった」 or "The reviewer says portions got smaller", 「口コミを書くと特典がもらえた」, or 「店主が変わった」. This is the only no-training BERT-class route to "price hike" and "review for reward".

Cost: each label is one forward pass per sentence. 300 reviews × 12 hypotheses = 3,600 pairs. Japanese quality and negation handling (「量は減っていない」) are unknown.

### 1e. Embedding models (for a few-shot head, SetFit or logistic regression)

| Model | Langs | Params / dims | License | Adoption | Browser build |
|---|---|---|---|---|---|
| [cl-nagoya/ruri-v3-30m / 70m / 130m / 310m](https://huggingface.co/cl-nagoya/ruri-v3-310m) | ja (ModernBERT-ja base) | 37M / 70M / 132M / 315M params; 256 / 384 / 512 / 768 dims. JMTEB classification 74.8 / 77.0 / 77.2 / 78.7. Prefix `トピック: ` for classification. 8k context. | Apache-2.0 | 310m: about 830k downloads/month; 30m: about 135k ([API](https://huggingface.co/api/models?author=cl-nagoya&search=ruri-v3)) | [onnx-community/ruri-v3-30m-ONNX](https://huggingface.co/onnx-community/ruri-v3-30m-ONNX): int8 37 MB, fp16 74 MB ([files](https://huggingface.co/api/models/onnx-community/ruri-v3-30m-ONNX/tree/main/onnx)). 130m and 310m ONNX copies also exist. |
| [google/embeddinggemma-300m](https://huggingface.co/google/embeddinggemma-300m) | 100+ languages | about 300M, 768 dims (MRL down to 128), 2k context. MMTEB v2 mean 61.15. Prompt `task: classification \| query:`. No fp16 activations. | Gemma terms (gated) | about 1.24M downloads/month | [onnx-community/embeddinggemma-300m-ONNX](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX): q4f16 about 167 MB, q4 about 188 MB, q8 about 295 MB ([files](https://huggingface.co/api/models/onnx-community/embeddinggemma-300m-ONNX/tree/main/onnx)) |
| [google/embeddinggemma-2](https://huggingface.co/google/embeddinggemma-2) | 100+ languages, multimodal | 740M total, text path about 270M. 768 dims, 8k context. MMTEB v2 61.36. Paper about 2026-10. | Apache-2.0 (per label) | about 473k downloads/month | `onnx-community/embeddinggemma-2-ONNX` exists ([search](https://huggingface.co/api/models?search=embeddinggemma)). Size not checked. |
| [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (also base, large) | about 100 languages | small: about 118M (fp32 ONNX is 470 MB). base from xlm-roberta-base, large from xlm-roberta-large ([mE5 report](https://arxiv.org/html/2402.05672v1)) | MIT | small: about 9.3M downloads/month, lastModified 2026-04-02 ([API](https://huggingface.co/api/models/intfloat/multilingual-e5-small)) | [Xenova/multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small): int8 118 MB ([files](https://huggingface.co/api/models/Xenova/multilingual-e5-small/tree/main/onnx)) |
| [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) | 100+ languages | 1024 dims, 8k context (about 568M per TEI table) | MIT | about 30M downloads/month, lastModified 2024-07 | ONNX tag present (large for a browser) |
| Gemini Embedding API (`gemini-embedding-001`, `gemini-embedding-2`) | multilingual | Hosted | Paid API | n/a | $0.15 and $0.20 per 1M input tokens. Batch at half price. Free tier on Standard ([pricing](https://aistudio.google.com/docs/pricing)). |

What embeddings could cover: every category, given labeled examples. SetFit claims that 8 examples per class are competitive with full fine-tuning on a sentiment task ([SetFit docs](https://huggingface.co/docs/setfit/index)). The open risk is that embeddings group by topic. 「値上げしても安い」 and 「値上げした」 may land close together, so look-alike separation is the thing to benchmark.

### 1f. Owner-reply tone: politeness, toxicity

| Model / API | Labels | Langs | Size | License | Notes |
|---|---|---|---|---|---|
| [textdetox/xlmr-large-toxicity-classifier-v2](https://huggingface.co/textdetox/xlmr-large-toxicity-classifier-v2) | binary neutral / toxic | 15 languages, **ja F1 0.877 (card)** | about 0.6B | OpenRAIL++ | about 5.8k downloads/month. Catches insults, not "defensive". |
| [Alnusjaponica/toxicity-classification-multi-class](https://huggingface.co/Alnusjaponica/toxicity-classification-multi-class) | toxicity multi-class (ROC AUC 0.845 per search summary, unverified) | ja (LINE DistilBERT base) | small | unverified | Used by LangCheck ([source](https://langcheck.readthedocs.io/en/v0.4.0/_modules/langcheck/metrics/ja/reference_free_text_quality.html)) |
| [Ishraq99/keigo-evaluator](https://huggingface.co/Ishraq99/keigo-evaluator) | 4 politeness levels (最高敬語 / 敬語 / 丁寧語 / 普通語). Trained on the KeiCO corpus (10k sentences). | ja | BERT-base (tohoku v3) | MIT | 21 downloads/month, **no accuracy reported**. Measures formality, not attitude. |
| Cloud Natural Language moderation | 16 categories, including Toxic, Insult, Derogatory and Profanity. Confidence scores, not severity. | ja supported | API | — | [docs](https://docs.cloud.google.com/natural-language/docs/moderating-text) |

**Nothing off the shelf labels "defensive" or "argumentative" owner replies.** A defensive reply is often perfectly polite keigo (「ご指摘の件ですが、当店では…」), so politeness and toxicity models only cover the extremes.

### 1g. Coverage matrix (without training)

Legend: ● plausible direct coverage, ◐ partial or proxy, ○ none. "Plausible" is untested.

| Category | JA / multi sentiment | yangheng ABSA | Zero-shot NLI | Embeddings + few labels | Cloud NL API | Gemini Flash (prompt) |
|---|---|---|---|---|---|---|
| Price hike (値上げ) | ◐ negativity only | ◐ ("price" polarity, no "change") | ● (hypothesis) | ● (needs examples) | ◐ entity sentiment on 値段 | ● |
| Smaller portions | ◐ | ◐ | ● | ● | ◐ | ● |
| Taste / quality decline | ◐ | ◐ | ● | ● | ◐ | ● |
| Owner / staff changed | ○ | ○ | ● | ● | ○ | ● |
| Bad service | ◐ | ◐ | ● | ● | ◐ | ● |
| Hygiene | ◐ | ◐ | ● | ● | ◐ | ● |
| お通し / チャージ / ぼったくり / touts | ◐ | ○ | ● | ● | ○ | ● |
| Review for reward (口コミ特典) | ○ | ○ | ● | ● | ○ | ● |
| Improved / recovered | ◐ positivity | ○ | ● | ● | ◐ | ● |
| Owner reply tone | ◐ | ○ | ◐ | ● | ◐ moderation (insult/toxic only) | ● |
| Reject look-alikes | ? | ? | ? (negation) | ? (topic clustering) | ? | ? |

Checked: **no ready-made label exists for "price hike", "review for reward", "owner changed" or "defensive reply"** in any model found.

- Research on incentivized-review detection exists, for English and Amazon: Oak & Shafiq, [ICWSM 2025](https://ojs.aaai.org/index.php/ICWSM/article/view/35877), and [Jamshidi et al. 2018](https://ix.cs.uoregon.edu/~lijun/pubs/pdfs/jamshidi18amazon.pdf). No hosted checkpoint was found.
- Google's own policy treats incentivized reviews as prohibited fake engagement ([Business Profile help](https://support.google.com/business/answer/3474122?hl=en), [contribution policy](https://support.google.com/contributionpolicy/answer/7400114?hl=EN)). That makes them a strong pitch point.
- A nearby Japanese product exists. ステマップ (launched 2024-10-02) flags possible stealth marketing from the review counts of 5-star reviewers, not from text ([ASCII](https://ascii.jp/elem/000/004/225/4225794/)).

Suggestion: rewards, お通し and チャージ are often written literally (「口コミ投稿でドリンク1杯サービス」). A **keyword / regex baseline** belongs in the benchmark, because it may beat every model on precision for these.

---

## 2. Datasets for a cheap fine-tune

| Dataset | Domain | Size | Labels | License / access | Fit |
|---|---|---|---|---|---|
| [M-ABSA](https://huggingface.co/datasets/Multilingual-NLP/M-ABSA) ([paper, EMNLP 2025](https://arxiv.org/html/2502.11824v3), [GitHub](https://github.com/swaggy66/M-ABSA)) | 7 domains including **restaurant (from SemEval-2016)**, hotel and food. Machine-translated with human review into 21 languages **including ja, ko, zh**. | About 14.8k sentences per language (parallel) | Triplets: aspect term, aspect category (e.g. `service#general`, food, price…), pos / neu / neg | HF tag Apache-2.0, **but the paper's ethics section says research only, not commercial** | Best ready-made ja restaurant ABSA, translated. Categories are SemEval's (FOOD, SERVICE, PRICES, AMBIENCE…). No "change over time" labels. |
| SemEval-2016 Task 5 restaurants ([Pontiki et al.](https://aclanthology.org/S16-1002/)) | Restaurant reviews in en, es, fr, nl, ru, tr. No ja. | A few thousand sentences per language | Aspect category + polarity | Research use (license unverified) | Source of M-ABSA restaurant data |
| Rakuten Travel ABSA corpus ([LREC 2022, Nakayama et al.](https://aclanthology.org/2022.lrec-1.758/); [NII IDR](https://www.nii.ac.jp/dsc/idr/rakuten/)) | Japanese **hotel** reviews | About 53k to 70k sentences | 7 aspects + polarity | **Only for researchers at Japanese universities or public institutes, academic use only. Companies cannot apply.** | High quality JA, but access is gated and the domain is hotels |
| [chABSA](https://github.com/chakki-works/chABSA-dataset) | **Securities reports**, not reviews | 230 companies | Entity#attribute + polarity | CC BY 4.0 | Domain mismatch |
| [clapAI/MultiLingualSentiment](https://huggingface.co/datasets/clapAI/MultiLingualSentiment) | Mixed (restaurant, hotel, product, tweets…) | 3.93M rows, 336k ja | pos / neu / neg | Apache-2.0 | Polarity pretraining only |
| [WRIME](https://github.com/ids-cv/wrime) | JA social media posts | 43k posts (35k with polarity) | 8 emotions 0 to 3, polarity −2 to +2 | CC BY-NC-ND 4.0 | Emotion / tone signal, non-commercial |
| MARC-ja ([JGLUE](https://github.com/yahoojapan/JGLUE)) | Amazon JP reviews | 187k train | pos / neg | **No longer distributed** (Amazon withdrew MARC) | Unavailable |
| [LLM-jp Toxicity Dataset v2](https://llm-jp.nii.ac.jp/en/llm/2025/03/19/llm-jp-toxicity-dataset-v2.html) | JA web text | 3,847 texts | Toxicity categories | CC BY 4.0 (v1 on HF) | Owner-reply extremes only |
| [KeiCO corpus](https://huggingface.co/Ishraq99/keigo-evaluator) | JA honorific sentences | 10k | 4 politeness levels | See authors' GitHub (unverified) | Owner-reply formality |
| Google Local Reviews (UCSD) ([UCI derivative](https://archive.ics.uci.edu/dataset/1276)) | Google Maps reviews with owner responses, **US / English** | 666M reviews | Stars only | License of the original unverified. UCI derivative is CC BY 4.0. | Could supply English owner-reply examples |

**Conclusion:** no dataset has our core labels (change over time, rewards, touts, owner change, defensive reply). Any fine-tune needs our own labels, most cheaply produced by an LLM and then spot-checked (section 6). M-ABSA (ja) could add generic food / service / price aspect polarity.

---

## 3. Serving on Google Cloud

| | Cloud Run, CPU (ONNX / int8) | Cloud Run, GPU (L4) | Vertex AI endpoint / Model Garden |
|---|---|---|---|
| Region | asia-northeast1 is a Tier 1 price region ([pricing via search](https://cloud.google.com/run/pricing)) | **No GPU in asia-northeast1.** L4 is in asia-southeast1, europe-west1/4, us-central1, us-east4. RTX PRO 6000 is in asia-southeast1 and others ([GPU docs](https://docs.cloud.google.com/run/docs/configuring/services/gpu)). | Any Vertex region with the machine type |
| Scale to zero | Yes | Yes | **Preview** ([autoscaling docs](https://docs.cloud.google.com/vertex-ai/docs/predictions/autoscaling)). Needs min_replica 0 on the v1beta1 API. Idle period of at least 5 min (default 1 h). **While at zero, requests get HTTP 429 and are dropped, not queued.** Auto-undeployed after 30 days at zero. |
| Cold start | Container start + model load. Startup CPU boost doubles CPU during startup ([Google blog 2026-05-28](https://cloud.google.com/blog/topics/developers-practitioners/a-guide-to-ai-cold-starts-on-cloud-run/)). Idle instances stay warm about 15 min (same blog). Estimate for a 40 to 600 MB model: about 5 to 20 s. | About 5 s to attach the GPU and drivers ([GPU docs](https://docs.cloud.google.com/run/docs/configuring/services/gpu)), plus model load. Estimate for a sub-1 GB encoder: about 10 to 30 s. | VM provisioning + container + model load (no figure in docs). Expect minutes (unverified). |
| Billing | Request-based Tier 1: $0.000024/vCPU-s, $0.0000025/GiB-s, $0.40 per 1M requests. Free tier 180k vCPU-s, 360k GiB-s and 2M requests a month (per search summaries of the [pricing page](https://cloud.google.com/run/pricing), which did not render for me). Instance-based rate about $0.000018/vCPU-s (unverified). | Instance-based billing is mandatory ([docs](https://docs.cloud.google.com/run/docs/configuring/services/gpu)). L4 GPU costs $0.0001867/s without zonal redundancy and $0.0002909/s with it (per search of the pricing page). A full 4 vCPU / 16 GiB L4 instance is about $1.05/h in europe-west1 ([third party, 2026-10](https://exodus.elim.io/blog/gpus-on-cloud-run)). No free tier for GPUs. Min 4 vCPU and 16 GiB. Default quota 3 L4 per region. | Per node-hour while deployed: n1-standard-4 about $0.2185/h (about $158/month always on), e2-standard-4 about $0.154/h ([Vertex pricing via search](https://cloud.google.com/vertex-ai/pricing)). GPU nodes cost more. |
| Latency for 300 reviews (estimate) | Small encoder (ruri-v3-30m/70m, mE5-small int8) embed + head: about 2 to 10 s on 4 vCPU. Base or 300M classifier: about 10 to 60 s. NLI with 12 hypotheses (3,600 pairs): minutes, too slow. | Embed or classify: under 2 s. NLI 3,600 pairs: about 5 to 15 s, extrapolated from the card's about 1,400 pairs/s on an A100 ([card](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7)) with an L4 assumed 3 to 5× slower. | Same as the hardware you pick |
| Monthly cost, mostly idle (estimate) | About $0 (within the free tier) | $5 to 20 for a few dozen demo sessions (each wake-up keeps the instance alive for minutes). min-instances=1 for demo day is about $25/day. | $0 at zero (preview, 429s on cold), otherwise from about $110 to $160/month |
| Setup effort | Low. Dockerfile + ONNX Runtime or [TEI](https://huggingface.co/docs/text-embeddings-inference/en/supported_models). TEI serves embeddings (BERT, XLM-R, ModernBERT, Gemma3) and XLM-R / CamemBERT sequence classifiers on CPU. | Medium (quota, region, probes) | Medium. Model Garden one-click deploy picks a HF container ([Google dev forum](https://discuss.google.dev/t/open-models-on-vertex-ai-with-hugging-face-let-s-get-started/171944), [prebuilt containers](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/open-models/use-prebuilt-containers)). Classifiers go through the PyTorch inference container. |

Recommendation: for a mostly idle hackathon service, **Cloud Run CPU in asia-northeast1 with a small encoder** is the natural host. Cloud Run GPU is only worth it for NLI with many hypotheses or for 300M+ models. Vertex endpoints are a poor fit, because scale-to-zero is in preview and drops cold requests.

Firestore per-review caching means steady-state load approaches zero once popular places are cached.

---

## 4. Non-BERT baselines on Google's stack

### 4a. Gemini via Firebase AI Logic or Vertex AI (now "Agent Platform")

Current Gemini Developer API prices, per 1M tokens, from the [pricing page](https://aistudio.google.com/docs/pricing):

| Model | Input | Output | Batch / Flex | Notes |
|---|---|---|---|---|
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | $0.125 / $0.75 | Stable. 1M context, 65k output, JSON schema output, Batch API, thinking levels ([model page](https://aistudio.google.com/docs/models/gemini-3.1-flash-lite)). |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | $0.15 / $1.25 | Stable. Default cloud model of the Firebase AI Logic hybrid SDK. |
| `gemini-3.6-flash` / `gemini-3.8-flash` | $0.75 | $3.75 | $0.375 / $1.875 | **Price doubles on 2027-01-01** |
| `gemini-2.5-flash-lite` | $0.10 | $0.40 | $0.05 / $0.20 | Served "until further notice", **only for users who already used 2.5** ([models page](https://aistudio.google.com/docs/models)) |
| `gemini-2.5-flash` | — | — | — | Deprecated. From **2026-12-01** requests route to 3.5 Flash-Lite. |

- All Flash and Flash-Lite models have a free tier on the Developer API. Free-tier content is used to improve Google products (same page). That is a privacy point for review text, which is already public.
- Firebase AI Logic itself is free; you pay for the Gemini usage, and the Spark plan uses the free tier ([Firebase AI Logic pricing](https://firebase.google.com/docs/ai-logic/pricing)).

**Cost per 1,000 reviews (estimate).** Assumptions:

- About 150 Japanese chars per review, which I assume is about 100 to 150 tokens. The Japanese tokens-per-character ratio is unverified.
- 40 reviews per call, with a 1.5k-token instruction amortized to about 40 tokens per review.
- About 50 output tokens per review (compact JSON flags), and thinking off or minimal.

| Model | Cost per 1,000 reviews |
|---|---|
| 3.1 Flash-Lite | 190k in × $0.25 + 50k out × $1.50 = **about $0.12** (about $0.06 with Batch, which is not interactive) |
| 3.8 Flash | about $0.33 (about $0.66 from 2027) |

Thinking tokens bill as output and could multiply the output cost.

**Latency (estimate):** 300 reviews as 8 parallel calls of about 40 reviews each, about 2k output tokens per call, comes to about 10 to 30 s end to end. This needs measuring.

**Extension integration:**

- The Firebase AI Logic web SDK is the obvious path, but App Check's reCAPTCHA provider loads remote scripts that MV3's CSP blocks. That is a user report ([thread](https://kaweah.freedombox.rocks/kiwix/content/stackoverflow.com_en_all_2023-11/questions/75927508/how-to-secure-a-firebase-backend-when-it-interacts-with-a-mv3-chrome-extension)), and there is no official word on `chrome-extension://` origins.
- Options are to skip App Check for the demo, write a custom App Check provider ([docs](https://firebase.google.com/docs/app-check/web-custom-provider)), or route through a small Cloud Run or Functions proxy that verifies the anonymous-auth ID token.
- **Hybrid mode** ([docs](https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference)): `PREFER_ON_DEVICE` uses Chrome's Nano (Chrome 139+) and falls back to `gemini-3.5-flash-lite`. It supports JSON / enum structured output on device. The docs only mention web apps on Chrome desktop, so extension contexts are unverified. It would let "Nano first, cloud fallback" share one code path.

### 4b. Cloud Natural Language API

Language support ([languages page](https://docs.cloud.google.com/natural-language/docs/languages)):

| Feature | ja | zh | zh-Hant | ko | en |
|---|---|---|---|---|---|
| Sentiment (document + per-sentence score −1..1, magnitude) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Entity analysis | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Entity sentiment** | **✓** | ✗ | ✗ | ✗ | ✓ |
| Content classification v2 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Text moderation | ✓ | ✓ | ✗ | ✓ | ✓ |

- Sentiment ranges are from the [basics page](https://docs.cloud.google.com/natural-language/docs/basics). Classification needs at least 20 tokens and returns topical categories (e.g. food & drink), **not complaint types**.
- Moderation returns 16 categories (Toxic, Insult, Derogatory, Profanity, Finance, Legal, …) ([docs](https://docs.cloud.google.com/natural-language/docs/moderating-text)).
- Prices: sentiment is free for 5k units/month, then $1.00 per 1,000 units, where a unit is up to 1,000 chars, so about $1 per 1,000 reviews. Moderation is 50k units free, then $0.0005 per 100-char unit. Both come from search snippets of the [pricing page](https://cloud.google.com/natural-language/pricing). Entity sentiment at about $2 per 1,000 units is **unverified** (2019 archive).
- Coverage: generic sentence polarity, polarity toward entities such as 「値段」, and toxic or insulting owner replies. It cannot express "went up", "smaller than before", rewards or owner change.

---

## 5. In-browser model (Transformers.js / ONNX Runtime Web in MV3)

Feasibility:

- **Feasible.** Hugging Face published an MV3 guide on 2026-04-23 ([blog](https://huggingface.co/blog/transformersjs-chrome-extension)). It runs `@huggingface/transformers` in the **background service worker** with `device: "webgpu"`. Models are cached once per extension origin.
- WebGPU has been available in service workers, including extension service workers, since Chrome 124 ([Chrome blog](https://developer.chrome.com/blog/new-in-webgpu-124)). An offscreen document is the alternative.
- `'wasm-unsafe-eval'` is needed in the extension CSP for WASM. That comes from a third-party guide and is unverified against Chrome docs ([guide](https://n1n-blog.pages.dev/blog/use-transformers-js-chrome-extension-guide-2026-04-25)).
- Transformers.js supports `text-classification`, `zero-shot-classification` and `feature-extraction`, with dtypes fp32 / fp16 / q8 / q4 and ModernBERT and DeBERTa-v2 architectures ([docs](https://huggingface.co/docs/transformers.js/index)).

Size limits:

- There is no hard limit. Chrome Extensions DevRel said about 500 MB "is a reasonable size", depending on device memory.
- In one report, three models totaling about 465 MB loaded one after another crashed ONNX Runtime WASM in an offscreen document ([chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/-4CNcu5bUGA)).
- Candidate download sizes: ruri-v3-30m int8 **37 MB**, mE5-small int8 118 MB, embeddinggemma-300m q4f16 167 MB, mDeBERTa NLI (ONNX exists, size not checked, about 0.3B so roughly 300 MB at q8).

Speed:

- Community benchmark of BERT-type embedding models, model unspecified ([Xenova WebGPU benchmark discussions](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/3)): at batch 32, WebGPU takes about 285 to 580 ms (about 55 to 110 sentences/s), and WASM takes about 12.6 to 17.3 s (about 2 sentences/s).
- **Estimate:** 300 reviews take about 3 to 6 s on WebGPU and minutes on WASM for a base-size model. A 30M model should be several times faster. Judges' laptops vary.
- Keeps the "nothing leaves the browser" pitch and costs $0. NLI with many hypotheses is likely too slow in the browser.

---

## 6. If we fine-tune: cheapest credible recipe

1. **Labels.** Run Gemini (3.1 Flash-Lite, or 3.8 Flash for higher-quality labels) over about 3k to 5k real Maps sentences with a fixed JSON schema: categories, direction (worse / better / none), is-look-alike, and reply tone. Oversample the rare classes by keyword search (値上げ, 量, 店主, お通し, チャージ, 口コミ, サービス). Hand-check about 300 to 500 as gold. The data amount is an estimate: SetFit reports strong results from 8 to 64 examples per class ([docs](https://huggingface.co/docs/setfit/index)), and a multi-label head over about 12 classes with rare positives usually needs a few hundred positives per class.
2. **Cheapest model.** A frozen embedding (ruri-v3) plus logistic regression or SetFit, multi-label. That means minutes on CPU or one GPU and no encoder training if frozen.
3. **Next step up.** Full fine-tune of a Japanese encoder with a multi-label head. Estimate: about 5k sentences × 128 tokens × 3 epochs on a 130M to 310M encoder is a few minutes on one modern GPU (about 6·N·T, roughly 4e15 FLOPs). Eight GPUs are unnecessary.
4. **Ship.** Export to ONNX int8 for Cloud Run CPU or Transformers.js.

Base encoders, verified:

| Model | Params | Context | License | Notes |
|---|---|---|---|---|
| [sbintuitions/modernbert-ja-30m/70m/130m/310m](https://huggingface.co/sbintuitions/modernbert-ja-310m) | 37M / 70M / 132M / 315M | 8k | MIT | No MeCab needed (SentencePiece). Card scores: MARC-ja 95.9 to 96.5, WRIME 91.6 to 95.2. 130m lastModified 2025-05-01 ([API](https://huggingface.co/api/models/sbintuitions/modernbert-ja-130m)). The base of ruri-v3. |
| [llm-jp/llm-jp-modernbert-base](https://huggingface.co/llm-jp/llm-jp-modernbert-base) | about 0.2B | 8k | Apache-2.0 | JGLUE average below modernbert-ja-310m (card table) |
| [tohoku-nlp/bert-base-japanese-v3](https://huggingface.co/tohoku-nlp/bert-base-japanese-v3) | about 110M | 512 | Apache-2.0 | 2023. Needs a MeCab/fugashi tokenizer (from common usage, unverified on card). |
| [jhu-clsp/mmBERT-base](https://huggingface.co/jhu-clsp/mmBERT-base) / small | 307M / 140M | 8k | MIT | 1800+ languages (2025-09). Card claims it beats XLM-R. Japanese not explicitly named on the card. |
| mDeBERTa-v3-base ([NLI variant](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7)) | 0.3B | 512 | MIT | No FP16 |
| [multilingual-e5](https://huggingface.co/intfloat/multilingual-e5-small) / [bge-m3](https://huggingface.co/BAAI/bge-m3) / [embeddinggemma](https://huggingface.co/google/embeddinggemma-300m) | see 1e | | MIT / MIT / Gemma | For multilingual (zh / ko / en reviews). EmbeddingGemma counts as Google tech for judging. |

---

## 7. Comparison and recommendation

| Approach | Covers | Training | 300 reviews (est.) | Cost | Setup | Main risk |
|---|---|---|---|---|---|---|
| Off-the-shelf sentiment (christian-phu, clapAI) | Negativity only | None | 1 to 10 s on CPU or browser | about $0 | Low | Cannot name category or change. Licenses (tabularisai NC, koheiduck none). |
| yangheng ABSA | Aspect polarity, no ja | None | similar | about $0 | Low | No Japanese, no "change" |
| Zero-shot NLI (mDeBERTa-2mil7, bge-m3-zeroshot) | All categories as hypotheses | None | 5 to 15 s on GPU, minutes on CPU | GPU $5 to 20/month | Medium | Machine-translated ja NLI, negation and contrast, compute scales with labels |
| Embeddings + few-shot head (ruri-v3, EmbeddingGemma, Gemini Embedding) | All, with examples | Light (tens to hundreds of labels) | 2 to 10 s CPU, 3 to 6 s WebGPU | about $0 | Low to medium | Topic clustering may not separate look-alikes |
| Gemini Flash-Lite API | All + reply tone + look-alikes | None | about 10 to 30 s | about $0.12 per 1k reviews | Low | Data leaves the browser, App Check in MV3, label consistency |
| Cloud Natural Language | Polarity, ja entity sentiment, toxic replies | None | a few s (parallel) | about $1 per 1k reviews | Low | No complaint or change categories |
| In-browser model | Same as embeddings, or small NLI | Same | 3 to 6 s WebGPU, minutes on WASM | $0 | Medium | Device variance, 40 to 200 MB download |
| Fine-tuned encoder (distilled from Gemini) | All | Yes (LLM labels + gold) | 2 to 10 s CPU or browser | about $0 serving | Medium to high | Label quality, rare classes |

Benchmark order:

1. **Gemini 3.1 Flash-Lite**, batched with JSON schema. It is also the labeler for every later step.
2. **ruri-v3 (ja) / EmbeddingGemma (multi) + few-shot head**, in the browser or on Cloud Run CPU.
3. **Zero-shot NLI** (mDeBERTa-2mil7 and bge-m3-zeroshot-v2.0), as the honest "existing BERT, no training" answer.

Also run: a keyword / regex baseline and Nano (current) on the same set.

### Open questions only a real-data benchmark can settle

- Per-category precision and recall on real Maps sentences. These are rare positives, so precision matters most.
- Look-alike rejection (「値上げしても安い」 「量は減っていない」 「値段の割に美味しい」) for each approach.
- Granularity: does sentence splitting lose cross-sentence context (「前は…今は…」)?
- How Gemini accuracy and latency change with batch size (10 vs 40 vs 100 reviews per call) and thinking level.
- Japanese NLI quality, and whether the hypothesis should be written in Japanese or English.
- How many labeled examples per class the embedding head needs. Ruri vs EmbeddingGemma vs mE5.
- Real WebGPU and WASM speed of each candidate on typical laptops inside the extension.
- Whether the owner-reply tone labels (polite / defensive / argumentative) are reproducible between annotators at all, and whether toxicity or politeness scores correlate with them.
- Mixed-language reviews: whether we classify the original text or Google's translation.
- Agreement between Gemini, Nano and human gold. That decides whether Gemini labels are good enough to distill.

---

## Addendum 2026-11-06: Qwen3-Embedding (instruction-aware embeddings)

Asked by the user after the main research. Checked on the model card, the paper and one third-party Japanese benchmark.

- **What it is:** Qwen3-Embedding 0.6B / 4B / 8B (Alibaba, paper 2025-06-05, arXiv 2506.05176). Apache-2.0, 100+ languages, 32k context. Output size 1024 / 2560 / 4096, and it can be cut down (0.6B: any size from 32 to 1024).
- **The instruction:** a one-sentence task description is put in front of the text to embed: `Instruct: {task}` then a newline then `Query:{text}`. Only the query side gets it; documents are embedded bare. The card says instructions usually help by 1% to 5% and should be written in English. The paper has no ablation that isolates the instruction, and gives no example for classification.
- **Scores:** MTEB multilingual classification 66.83 (0.6B), 72.33 (4B), 74.00 (8B); overall 64.33 / 69.45 / 70.58.
- **Japanese (third party, secon.dev, 2025-06-11, 0.6B only):** JMTEB classification 66.09 vs ruri-v3-30m 74.80 and ruri-v3-310m 78.66; retrieval 72.81 vs 78.08 and 81.89. Caveats: the instruction was only used for retrieval and reranking, not classification; the author says a setup error is possible; 4B and 8B were not measured on Japanese.
- **Serving:** sentence-transformers, vLLM, Text Embeddings Inference (CPU and GPU images). An ONNX build for Transformers.js exists (`onnx-community/Qwen3-Embedding-0.6B-ONNX`): int8 614 MB, q4f16 567 MB; fp32 (2.09 GB) and fp16 (1.2 GB) use external data files, which probably do not load in the browser (inferred from the sibling reranker repo, not confirmed).
- **Successor:** no Qwen3.5 embedding found; the 2026 release is the multimodal Qwen3-VL-Embedding (arXiv 2601.04720).
- **For our benchmark:** add 0.6B with and without an instruction per warning category, next to ruri-v3. It tests whether an instruction separates look-alikes ("値上げしても安い") that plain embeddings group by topic. Try 4B on the user's own GPU only if 0.6B shows the instruction helps.

Sources: https://huggingface.co/Qwen/Qwen3-Embedding-0.6B · https://arxiv.org/abs/2506.05176 · https://secon.dev/entry/2025/06/11/100000-qwen3-embedding-jmteb/ · https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX/tree/main/onnx · https://github.com/QwenLM/Qwen3-Embedding
