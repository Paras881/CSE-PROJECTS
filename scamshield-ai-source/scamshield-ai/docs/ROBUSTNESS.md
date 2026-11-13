# English robustness diagnostics

The suite contains 48 fictional authored messages: 42 with intended binary labels and six ambiguous cases. It was written before observing predictions, was not used for training, and is not an independently adjudicated real-world benchmark. No parameters or thresholds were tuned on it.

The classifier recorded TP 8, FP 0, TN 24 and FN 10 on labelled cases: 44.44% recall and 61.54% F1. The review policy accepted 27 of 42 labelled cases, with six errors among accepted decisions. It deferred 19 of all 48 cases, including four of six ambiguous cases. The other two ambiguous decisions have unknown correctness.

All six authored negated-warning examples received the intended negative decision. Direct credential requests and advance-fee scenarios exposed misses, including low-score mistakes after abstention. Of six paired transformations, one changed the binary prediction. Normalization helps only with the transformations implemented; arbitrary adversarial text can still bypass both model and rules.

The app highlights model/rule disagreements and expands strong rule evidence. That display behavior does not change model outputs or experiment metrics. Rules can themselves misread negation and quotations.

Run `node ml/stress_test.mjs`. Inputs: `ml/robustness_cases.json`. Results: `dist/data/robustness-results.json`. Local timing includes warmup and is not a browser benchmark. Report table: `docs/results/robustness-report-summary.md`.
