# Archived release 0.1 notes

Historical documentation only; see the current README and final report for release 0.2.

A final-year CSE project combining explainable message warning signals, an actual SMS spam research baseline, and DataGuard monitoring. This is **milestone 1: a working research prototype**, not a validated fraud-prevention service.

## Run locally

Requires Python 3.9+ to serve the app; Node.js 20+ to run the JavaScript tests. There are no package installation steps or API keys.

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8000 in your browser. An HTTP server is required for module imports and the model JSON; do not double-click index.html. Stop the server with Ctrl+C.

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s ml -p 'test_*.py'
```

## Try it

1. Choose a sample or paste an English message into **Analyzer**.
2. Check the message. The risk index adds up visible warning signals; it is not a probability. A low score does not establish safety.
3. Inspect the separate SMS spam model output and its token contributions. This model predicts spam/ham, not fraud.
4. Visit **DataGuard**. With no reviewed outcomes, performance metrics remain unavailable. With fewer than 40 checks, distribution comparison remains unavailable.
5. Load the synthetic demo to inspect monitoring and review flows immediately. Demo rows are isolated from your session and clearly marked synthetic.
6. Review a record's label explicitly before including it in local performance calculations. These are operator-reviewed labels, not independent ground truth. Record IDs do not preserve message content; review the result while its context is still available or consult a separately governed dataset.
7. Export the session's derived records, or clear local history.

## What is implemented

- Transparent, contextual warning rules for credential requests, upfront payments, urgency, account threats, unrealistic financial promises, unusual payments, and selected link patterns.
- Browser inference using a multinomial Naive Bayes model trained on the UCI SMS Spam Collection.
- Model arithmetic explanations and explicit separation of heuristic risk and spam score.
- Local feature-only history, manual review workflow, confusion matrix, and precision/recall/F1.
- Descriptive input-change comparisons between the first 20 and latest 20 checks once at least 40 exist.
- Isolated synthetic demo records, JSON exports, responsive UI, model card, and reproducible training pipeline.

## Architecture

```text
Message (memory only)
  |-- warning rules ------> risk index + matched evidence
  |-- SMS spam model -----> separate uncalibrated spam score
  `-- feature extraction -> browser-local derived history
                                 |-- DataGuard input-change comparisons
                                 `-- reviewed labels -> performance metrics
```

All application inference runs locally in the browser. No pasted messages are sent to an external AI service. The browser fetches the static application and model; hosting/access infrastructure still handles ordinary requests. Local storage contains derived numerical features, timestamps, model version, scores, and optional review labels. It does not contain message bodies, matched excerpts, URLs, or top tokens. Derived metadata can still be sensitive; use **Clear history** on shared devices. Model vocabulary is derived from the public research corpus, not visitor messages. No malicious links are opened or fetched.

## Project layout

- `dist/`: complete deployable browser application, inference code, and model artifacts.
- `ml/`: Python training/evaluation pipeline and model card.
- `tests/`: meaningful JavaScript behavior and inference tests.
- `docs/PROJECT_PLAN.md`: project scope, research protocol, milestones, and next implementation work.
- `.openai/hosting.json`: private Sites hosting configuration.

## Scientific boundaries

Rules may misread negation, quotations, warnings about scams, or legitimate fee requests. They cannot establish sender identity or intent. The heuristic threshold (55/100) is provisional and not fitted on a scam-labelled validation set. Descriptive drift flags use illustrative thresholds, not significance tests, adaptive thresholds, or proof of concept drift. Feature distribution shifts need not cause errors, and errors can increase without these features shifting. The monitoring module currently evaluates **the rule-based scam prediction**, not the independent spam baseline. Its local reviews are convenience labels and are not a publishable benchmark.

The trained spam baseline uses a deterministic, deduplicated random holdout of an old corpus. It has not been validated for modern scams, Indian-language messages, new sources, or adversarial text. Do not present its results as future performance. The browser UI reports these limitations.

See [ML documentation](ml/README.md) for data attribution, exact results, reproduction, and limitations. The source data is UCI's SMS Spam Collection (Almeida & Hidalgo, 2011), listed by UCI under CC BY 4.0. This project adapts that data into model parameters. The raw dataset is not included in this source package.

## Next milestone

Obtain an appropriately licensed, scam-labelled dataset; define the label policy and a leakage-resistant held-out evaluation before training the actual scam model. Then compare a simple text baseline and one stronger NLP model. A full research roadmap is in `docs/PROJECT_PLAN.md`.
