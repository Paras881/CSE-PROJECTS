# SMS spam research baseline

This folder trains the small model used in the browser's **SMS spam baseline** panel. It is a real multinomial Naive Bayes model trained on the public UCI SMS Spam Collection. It does not classify proven scams. Scam warning signs in the application are an independent, transparent heuristic; the two outputs must not be combined into a calibrated scam probability.

## Reproduce

Python 3.9+ is sufficient; there are no third-party dependencies. Run from the project root:

```sh
python3 ml/train_baseline.py --source-zip work/sms.zip --download
```

To use an already downloaded archive, omit `--download`. The default output is `dist/data/`. The archive is fetched only if missing. Its SHA-256 hash is recorded in the exported model and evaluation report. The default seed is `2030`.

For your own **spam/ham** labels:

```sh
python3 ml/train_baseline.py --csv path/to/messages.csv --source-name "My reviewed SMS dataset" --output-dir work/candidate
```

The CSV must have `text,label` columns and labels `spam` or `ham`. This command is not designed for unreviewed user feedback or scam labels. Confirm consent, licensing, and de-identification before collecting message data. Keep the deployed evaluation set fixed during model selection; the CLI is a starting baseline, not a hyperparameter-tuning pipeline.

## What the pipeline does

1. Tokenize with lowercase ASCII alphanumeric runs (`[a-z0-9]+`).
2. Deduplicate normalized token sequences before splitting. Drop conflicting-label groups and empty-token rows.
3. Stratify a deterministic 80/20 random train/test split.
4. Fit a vocabulary on training data only (minimum document frequency 2).
5. Train multinomial Naive Bayes with Laplace smoothing (`alpha=1`).
6. Evaluate once at the fixed 0.5 threshold and export the model, test metrics, and inference parity fixtures.

`spam-model.json` contains log priors and per-token class log likelihoods. Browser inference sums the same terms as Python. `topTokens` contains signed log-odds contributions; positive values support spam, negative values support ham. These describe the model's arithmetic, not the sender's intentions.

## Data attribution

Almeida, T. & Hidalgo, J. (2011). *SMS Spam Collection* [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CC84.

- Repository: https://archive.ics.uci.edu/dataset/228/sms+spam+collection
- Archive: https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip
- License listed by UCI: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Adaptation: normalized, deduplicated, randomly split, and transformed into Naive Bayes parameters for this prototype.
- The repository describes 5,574 instances; use the actual parsed counts in `baseline-metrics.json` rather than assuming the archive matches that metadata count.

## Limitations and next research steps

- **Spam is not scam.** Advertising can be spam without fraud; a dangerous scam can resemble ordinary conversation.
- The historical corpus combines different sources and is not chronologically sorted. A random holdout does not measure future scam detection or drift performance.
- Deduplication reduces direct leakage but does not eliminate near-duplicate templates or shared campaign patterns. Later research should group by campaign/source and collect an independently labelled external test set.
- Scores are uncalibrated. Naive Bayes can be extremely confident when its assumptions are wrong. Do not display them as a likelihood that a user will be harmed.
- Unknown words are ignored. Non-English input, obfuscation, and novel vocabulary can make the prediction weak or misleading.
- Precision, recall, false alarms, and missed spam are all reported. Accuracy alone is not a sufficient measure on an imbalanced dataset.
- This first model establishes a transparent baseline. A later transformer comparison requires its own training/validation/test protocol and an actual scam-labelled benchmark.
