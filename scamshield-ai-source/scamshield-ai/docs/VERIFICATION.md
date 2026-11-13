# Release 0.2.0 verification

Verified on 7 November 2026. All 27 JavaScript tests and 15 Python tests passed. JavaScript syntax and whitespace checks passed. The automated suites cover model arithmetic and authored Python/JavaScript fixtures, malformed artifacts, input bounds, storage whitelists, version filtering, review confirmation, missing labels, abstention, frozen-reference comparisons and error calculations.

Manual browser verification observed:

- The trained English model and all research artifacts load successfully.
- Account-alert assessment produces an 80.6% calibrated score. The internship example defers at 72.8% and expands its separate warning rules.
- Proposed labels remain excluded. Explicit confirmation adds a reviewed outcome and records its arrival time.
- An unknown-vocabulary input defers with zero recognized word tokens.
- The 60-row synthetic demo stays separate from the real session; returning preserves the session counts.
- Model Lab displays the measured test and simulation results.
- A downloaded schema-2 session export contains the expected two checks and one confirmed label, with a strict derived-field record schema and no raw message, URL, excerpt or learned-feature explanation.
- Analyzer and Model Lab were checked at 375-pixel width without horizontal page overflow. The temporary viewport override was reset.
- The final browser log contained no errors or warnings.

Model-loading fallback and history clearing were inspected in code; the final browser pass did not simulate network failure or delete existing history. These checks establish behavior in the tested conditions, not production security or real-world scam prevention. Detection effectiveness is evaluated separately in the final report. Machine-readable evidence is in `docs/results/release-verification.json`.
