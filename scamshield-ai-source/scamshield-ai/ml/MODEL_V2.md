# English smishing model card

Version `smishing-tfidf-v1`, evaluated 7 November 2026. Intended use: a local, inspectable research assessment of English SMS with human review. Not intended for automatic blocking, sender verification, transaction approval or a safety verdict.

## Data and task

SmishX source revision `116a8c827741e0572563f678d25ed04306b1e3ff`, CSV SHA-256 `8d65e373b17477c34e8f1c619e6f59d249e8fca21276cabdd03a55d11a469285`. From 1,200 rows, remove 93 normalized duplicates and 11 inspected non-English/corrupted rows. No conflicting-label groups were found. Retain 1,096 messages: 604 legitimate, 267 spam and 225 smishing. The positive class is smishing; both legitimate and spam map to non-smishing. Negative is not safe.

Approximate grouping creates 948 template components using masked identifier templates and word-trigram Jaccard at least 0.8. These are not verified campaigns. StratifiedGroupKFold with seed 2030 assigns fold 0 test, fold 1 calibration and folds 2-4 training. Sizes: 658 train, 219 calibration, 219 test; group counts 571/191/186. No group overlaps. The frozen manifest is in `docs/results/split-manifest.json`. No time or source-held-out claim is possible.

## Model and selection

Word unigrams/bigrams and character sequences of 3-5 characters use min document frequency 2, sublinear term frequency, smooth IDF and independent L2 normalization. Vocabularies fit only on training rows, capped at 12,000/20,000 terms. Logistic regression uses C = 1, liblinear, max_iter = 2,000, seed 2030. Preprocessing applies NFKC, lowercase, zero-width removal, escaped whitespace cleanup, URL/email/number masking and ASCII cleanup.

Regularized Platt sigmoid calibration fits C = 1 logistic regression to calibration-set logits. The calibration set is separate from classifier training, but its error reference is optimistic because the mapping reuses these labels. Brier improvement on test is sample-specific, not a universal probability guarantee.

The browser lexical model was chosen before evaluation for compact local inference. A frozen English MiniLM encoder plus logistic head is an offline comparison, not a fine-tuned transformer. Both candidates use the same partitions and fixed C = 1. There was no test-based parameter or threshold search. The comparison encoder revision is `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`, normalized 384-dimensional embeddings, maximum 256 word pieces, CPU with 2 threads.

## Held out results

| Metric | Lexical deployed | Frozen MiniLM |
| --- | ---: | ---: |
| Precision at 0.5 | 86.21% | 74.19% |
| Recall at 0.5 | 55.56% | 51.11% |
| F1 at 0.5 | 67.57% | 60.53% |
| Average precision | 89.40% | 80.70% |
| Brier after calibration | 0.0607 | 0.0791 |
| TP / FP / TN / FN | 25 / 4 / 170 / 20 | 23 / 8 / 166 / 22 |
| Coverage of accepted decisions | 81.74% | 80.37% |
| Errors among accepted | 2 / 179 | 6 / 176 |

The model defers when fewer than 3 processed words, lexical coverage below 20%, or score strictly between 0.25 and 0.75. For the deployed policy, of 45 test phishing messages, 19 were flagged, 24 deferred and 2 missed. The 40 total referrals include 16 non-smishing cases. Accepted-only 98.88% accuracy does not describe all 219 messages. MiniLM uses the same lexical coverage gate for comparability; it is not an embedding uncertainty measure.

Lexical 95% Wilson intervals: precision 69.44-94.50%, recall 41.18-69.06%. Group-bootstrap F1 interval 44.89-90.00% using 1,000 resamples. Template dependence makes message-wise Wilson intervals approximate. The broad overlapping model intervals do not establish statistically significant superiority.

## Reproduce

From the repository root, using Python 3.12 and a work directory outside the repository:

```sh
python3 -m venv ../research-env
../research-env/bin/python -m pip install -r ml/requirements-research.txt
../research-env/bin/python ml/download_research_data.py --out ../research-work
../research-env/bin/python ml/download_encoder.py --cache ../research-work/hf-cache
../research-env/bin/python ml/audit_smishx.py --csv ../research-work/dataset.csv --out ../research-work
../research-env/bin/python ml/train_smishing.py --data ../research-work/cleaned.jsonl --encoder ../research-work/hf-cache/models--sentence-transformers--all-MiniLM-L6-v2/snapshots/1110a243fdf4706b3f48f1d95db1a4f5529b4d41
../research-env/bin/python ml/monitoring_experiment.py
node ml/stress_test.mjs
node --test tests/*.test.mjs
../research-env/bin/python -m unittest discover -s ml -p 'test_*.py'
```

To reproduce the UCI overlap count, pass `--uci-zip /path/to/sms.zip` to the audit. Without it, overlap is unknown rather than assumed zero. The source hash and split assignments remain the same. The optional overlap field does not change training. Download the original UCI archive as described in `ml/README.md`.

The trainer refuses a different frozen split manifest under the same protocol. Supply new output paths and a new model version for a changed dataset/protocol. Reproducing the same results is not a second independent test. Timings and machine descriptions will differ by host. Inference fixtures contain only authored examples. Raw corpus text and encoder weights are never copied into dist.

## Boundaries

Small curated data, inherited labels, active-URL selection, remaining templates and unknown pretraining overlap limit generalization. There is no new independent annotation or human usability study. The 48 authored stress cases expose misses and are not a representative benchmark. Word/character contributions describe arithmetic, not causal sender evidence. Rules remain independent and can misread negation. No learned parameter is tuned on the stress suite. Future evaluation needs a new untouched English corpus with reliable time/source metadata.
