# DataGuard monitoring and experiments

Release 0.2 uses `monitorResearchRecords` from `dist/monitoring.mjs`. Input monitoring compares length, word count and URL count with the frozen 658-row training distribution. It waits for 30 current-version records and uses up to the latest 50.

Each feature uses empirical CDF distance. The threshold is `sqrt(log(4*k/alpha)/(2*n)) + sqrt(log(4*k/alpha)/(2*m))`, with three features and alpha 0.05. This is a union of two one-sample DKW bounds and a Bonferroni adjustment across features. It applies to one snapshot under independent sampling, not lifetime control of repeated rolling alerts. Related templates and convenience sampling weaken its deployment interpretation.

Labels require explicit confirmation and valid arrival timestamps. Accepted-decision metrics exclude abstentions; separate binary metrics evaluate all reviewed score-threshold predictions. Unknown labels never count as successes. Old versions and invalid records are excluded.

The default error warning compares the latest 50 reviewed binary errors with the calibration reference. Its margin is `sqrt(log(2/alpha)/(2*n_ref)) + sqrt(log(2/alpha)/(2*n_current))`, accounting for both finite samples with one-sided Hoeffding bounds. The reference is 15 errors in 219 rows (6.85%) and reuses the sigmoid-fitting split. That optimism and dependence limit its interpretation. EWMA with lambda 0.1 is diagnostic only.

## Controlled experiments

Seed 2030; 200 streams per scenario; 500 events; onset index 250. Inputs change abruptly or over 100 events. Error probability changes from 0.10 to 0.35. The conservative detector uses an independent 200-label reference. Delayed reviews arrive 25 events later and stop at the original observation horizon.

Input monitoring flagged 1% of stable streams and detected all injected abrupt/gradual changes, with median delays of 19/49 events. These are large synthetic changes, not evidence about unmeasured or subtle field drift.

| Error method | Stable alerts | Abrupt detected | Abrupt delay | Gradual detected | Gradual delay |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fixed window | 10.5% | 200/200 | 26 | 200/200 | 72 |
| EWMA | 75.5% | 200/200 | 9 | 200/200 | 50 |
| EWMA with delayed labels | 73.0% | 200/200 | 34 | 200/200 | 74 |
| Conservative snapshot | 0% | 188/200 | 62 | 180/200 | 139.5 |

Delays are medians among detected streams. The conservative method misses 12 abrupt and 20 gradual streams. EWMA's high false-alarm rate is an unfavorable finding. The analytical conservative bound was added after observing that failure, without numerical tuning, and evaluated on the same streams. This is an engineering safeguard, not independently validated superiority.

## Actual error replay

The 219 held-out predictions contain 24 binary errors. One hundred seeded permutations replay these errors without invented changes or natural chronology. The conservative method alerts in none of the orders. EWMA alerts in 98 immediate-label orders and 93 delayed-label orders. A 25-slot delay leaves 194 of 219 labels available at the horizon. These are ordering-sensitivity results, not field false alarms or drift-detection rates.

Full results: `dist/data/monitoring-results.json`. Reproduce with `python ml/monitoring_experiment.py` in the research environment. References: [NIST EWMA](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm), [DKW](https://arxiv.org/abs/1107.5356), [Hoeffding](https://doi.org/10.1080/01621459.1963.10500830).
