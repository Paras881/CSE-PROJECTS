# SMS NB baseline v1 — model card

**Intended use:** an interpretable academic baseline for historical English SMS spam classification, displayed separately from the application's scam-warning rules. **Not intended:** financial decisions, automatic blocking, fraud verification, multilingual evaluation, or a claim of contemporary scam-detection performance.

## Model and input

- Algorithm: multinomial Naive Bayes; Laplace smoothing 1; minimum training-document frequency 2.
- Input: text, converted to lowercase ASCII alphanumeric token counts. 3,277 vocabulary tokens.
- Output: an uncalibrated spam score and signed token contributions to spam-vs-ham log odds.
- Threshold: 0.5, fixed before evaluation. No search over test-set thresholds.
- Unknown words: ignored; coverage counts accompany predictions. A zero-coverage input returns the class prior, not a meaningful assessment.

## Provenance and evaluation

UCI SMS Spam Collection, Almeida & Hidalgo (2011), DOI https://doi.org/10.24432/C5CC84; [repository and license](https://archive.ics.uci.edu/dataset/228/sms+spam+collection). UCI lists CC BY 4.0. The source archive SHA-256 is `1587ea43e58e82b14ff1f5425c88e17f8496bfcdb67a583dbff9eefaf9963ce3`.

5,574 parsed messages were normalized before splitting. 443 duplicate rows and 2 empty-token rows were removed, leaving 5,129 messages. No conflicting-label groups were found. Stratified random split with seed 2030: 4,103 training messages (3,600 ham, 503 spam) and 1,026 test messages (900 ham, 126 spam). The vocabulary was fit only on the training partition.

| Metric on the internal SMS spam test split | Result |
| --- | ---: |
| Spam precision | 97.44% |
| Spam recall | 90.48% |
| Spam F1 | 93.83% |
| Accuracy | 98.54% |
| Always predict ham accuracy | 87.72% |
| False-positive rate | 0.33% |
| True positive / false positive | 114 / 3 |
| True negative / false negative | 897 / 12 |

These are a single internal random-holdout result, not an external benchmark or confidence interval. The dataset is historical and not chronologically sorted. Closely related templates and campaign patterns can remain across partitions despite normalized deduplication. Future work should add campaign/source grouping, an external contemporary scam-labelled dataset, calibration evaluation, and a genuinely temporal split where timestamps are trustworthy.

## Important boundaries

Spam is unsolicited messaging; scam is fraud. This model's labels only establish the former. Its output is kept distinct from rule-based scam warning signs. A high score does not establish fraud, and a low score does not establish safety.

The classifier's probability-like score is not calibrated. Token contributions show the model's arithmetic, not causal evidence about a sender. Short messages, vocabulary mismatch, non-English text, intentional obfuscation, and novel scams can all give unreliable results.

## Reproducibility

See [training instructions](README.md). The shipped artifact includes source hash, cleaning counts, split parameters, and metrics. `inference-fixtures.json` contains original illustrative messages (not corpus excerpts) with Python scores for JavaScript parity checks. The model requires no external inference API; the browser computes predictions locally.
