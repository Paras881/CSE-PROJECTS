# ScamShield AI

**Release 0.2.0 — English SMS phishing assessment and DataGuard monitoring.**

This release adds a trained smishing classifier, a frozen MiniLM comparison, calibrated review decisions, versioned input/error monitoring, controlled experiments and a professional final technical report. See [the final report](docs/FINAL_REPORT.md), [model card and reproduction](ml/MODEL_V2.md), [data audit](docs/DATA_AUDIT.md), [monitoring results](docs/MONITORING.md) and [robustness diagnostics](docs/ROBUSTNESS.md).

The deployed text model obtained **86.21% precision and 55.56% recall** at a 0.5 threshold on 219 grouped held-out messages. With the displayed review policy, 19 of 45 phishing cases were flagged, 24 deferred and 2 missed. This is a bounded research tool, not a safety verdict or autonomous fraud-prevention service. English is the only supported scope.

## Run the current release

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8000. Browser inference needs no package installation, backend or API key. Test the JavaScript with Node.js 20 or newer:

```sh
node --test tests/*.test.mjs
```

The offline research suite requires the environment described in `ml/MODEL_V2.md`; run its Python tests in that environment, not a bare system Python. Raw data and downloaded encoder weights stay outside this repository. Reproduction scripts pin source and encoder revisions and preserve the frozen split manifest.

## Current application

- Analyzer: trained English smishing score, review/abstention behavior, numerical feature explanations and separate warning-rule evidence.
- DataGuard: frozen training-reference comparison; delayed confirmed-label diagnostics; accepted decisions, binary metrics and abstentions kept distinct.
- Model Lab: actual grouped test results, simulation results and authored diagnostic failures, plus the archived UCI spam benchmark.
- Privacy: pasted text stays in memory; retained history and exports use a strict derived-field whitelist. Clear history removes current and legacy project stores. Device-local metadata can still be sensitive.
- Reliability: invalid artifacts and missing references have explicit fallback states; model loads time out and can be retried. Model versions are never pooled in current monitoring.

The owner-private hosted app is [ScamShield AI](https://scamshield-ai.obito-2318.chatgpt.site). Release 0.2.0 preserves owner-only access. The accompanying release manifest records the published source revision and deployment result. The original report is delivered separately as Word and PDF; the source copy is `docs/FINAL_REPORT.md`. No presentation is included.
