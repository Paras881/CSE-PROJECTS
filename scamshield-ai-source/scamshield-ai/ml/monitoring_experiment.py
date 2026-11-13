#!/usr/bin/env python3
"""Controlled monitoring experiments; synthetic results are not field validation.

Parameters are fixed below before looking at outcomes. Run with the research
environment: python ml/monitoring_experiment.py --output dist/data/monitoring-results.json
"""
import argparse
import hashlib
import json
import math
import platform
from pathlib import Path

import numpy as np

SEED = 2030
RUNS = 200
LENGTH = 500
ONSET = 250  # zero-based event index, 251st observed message
REFERENCE_N = 600
WINDOW = 50
INPUT_EVERY = 10
ALPHA = 0.05
BASE_ERROR = 0.10
CHANGED_ERROR = 0.35
EWMA_LAMBDA = 0.10
Z = 3
LABEL_DELAY = 25
ERROR_REFERENCE_N = 200


def ks_distance(a, b):
    a, b = np.sort(a), np.sort(b)
    locations = np.unique(np.concatenate([a, b]))
    return float(np.max(np.abs(np.searchsorted(a, locations, side="right") / len(a)
                               - np.searchsorted(b, locations, side="right") / len(b))))


def summary(alarms, changed, onset=ONSET, observed_length=LENGTH):
    """Each run supplies all alert arrival indices; no reset/re-tuning after alarms."""
    any_alarm = sum(bool(a) for a in alarms)
    pre_alarm = sum(any(t < onset for t in a) for a in alarms)
    delays = [min(t for t in a if t >= onset) - onset for a in alarms if any(t >= onset for t in a)]
    return {
        "runs": len(alarms), "anyAlarmRate": any_alarm / len(alarms),
        "preChangeFalseAlarmRate": pre_alarm / len(alarms) if changed else None,
        "stableRunFalseAlarmRate": any_alarm / len(alarms) if not changed else None,
        "detectedAfterChange": len(delays) if changed else None,
        "undetectedAfterChange": len(alarms) - len(delays) if changed else None,
        "detectionRate": len(delays) / len(alarms) if changed else None,
        "medianDelayEventsAmongDetected": float(np.median(delays)) if changed and delays else None,
        "p90DelayEventsAmongDetected": float(np.quantile(delays, .9)) if changed and delays else None,
        "horizonEvents": observed_length,
    }


def error_experiments():
    # Fixed raw-threshold error reference, not estimated using evaluation streams.
    fixed_limit = BASE_ERROR + Z * math.sqrt(BASE_ERROR * (1 - BASE_ERROR) / WINDOW)
    ewma_limit = BASE_ERROR + Z * math.sqrt(BASE_ERROR * (1 - BASE_ERROR) * EWMA_LAMBDA / (2 - EWMA_LAMBDA))
    result = {}
    for scenario_index, scenario in enumerate(("stable", "abrupt", "gradual")):
        alarms = {"fixed_window": [], "ewma": [], "ewma_delayed_labels": [], "hoeffding_snapshot": []}
        for trial in range(RUNS):
            rng = np.random.default_rng(SEED + 10000 * scenario_index + trial)
            probability = np.full(LENGTH, BASE_ERROR)
            if scenario == "abrupt":
                probability[ONSET:] = CHANGED_ERROR
            elif scenario == "gradual":
                probability[ONSET:] = np.minimum(CHANGED_ERROR, BASE_ERROR + (np.arange(LENGTH-ONSET)+1) * (CHANGED_ERROR-BASE_ERROR) / 100)
            error = (rng.random(LENGTH) < probability).astype(float)
            # Independent finite reference for the added conservative diagnostic.
            # Keep existing evaluation streams unchanged for honest comparison.
            ref_rng = np.random.default_rng(SEED + 300000 + 10000*scenario_index + trial)
            ref_error = float(np.mean(ref_rng.random(ERROR_REFERENCE_N) < BASE_ERROR))
            bound = ref_error + math.sqrt(math.log(2/ALPHA)/(2*ERROR_REFERENCE_N)) + math.sqrt(math.log(2/ALPHA)/(2*WINDOW))
            fixed_alarms, ewma_alarms, bound_alarms = [], [], []
            ewma = BASE_ERROR
            for i, value in enumerate(error):
                ewma = EWMA_LAMBDA * value + (1-EWMA_LAMBDA) * ewma
                if i + 1 >= WINDOW:
                    if float(np.mean(error[i-WINDOW+1:i+1])) > fixed_limit:
                        fixed_alarms.append(i)
                    if ewma > ewma_limit:
                        ewma_alarms.append(i)
                    if float(np.mean(error[i-WINDOW+1:i+1])) > bound:
                        bound_alarms.append(i)
            alarms["fixed_window"].append(fixed_alarms)
            alarms["ewma"].append(ewma_alarms)
            # Reviews arrive exactly 25 events later. We observe messages only to
            # index 499, so late reviews outside that horizon are not fabricated.
            alarms["ewma_delayed_labels"].append([i+LABEL_DELAY for i in ewma_alarms if i+LABEL_DELAY<LENGTH])
            alarms["hoeffding_snapshot"].append(bound_alarms)
        result[scenario] = {name: summary(a, scenario != "stable") for name, a in alarms.items()}
    return {"baselineError": BASE_ERROR, "postChangeError": CHANGED_ERROR,
            "fixedWindow": WINDOW, "fixedThreshold": fixed_limit,
            "ewmaLambda": EWMA_LAMBDA, "ewmaThreshold": ewma_limit,
            "warmupLabels": WINDOW, "labelDelayEvents": LABEL_DELAY,
            "hoeffdingReferenceRows": ERROR_REFERENCE_N, "hoeffdingSnapshotAlpha": ALPHA,
            "hoeffdingMargin": math.sqrt(math.log(2/ALPHA)/(2*ERROR_REFERENCE_N)) + math.sqrt(math.log(2/ALPHA)/(2*WINDOW)),
            "scenarios": result}


def draw_features(rng, n, shift=None):
    if shift is None:
        shift = np.zeros(n)
    words = np.maximum(1, np.rint(rng.normal(20 + 15*shift, 5, n)))
    length = np.maximum(words, np.rint(words * 5 + rng.normal(0, 6, n)))
    urls = (rng.random(n) < (0.1 + 0.4*shift)).astype(float)
    return np.column_stack([length, words, urls])


def input_experiments():
    threshold = math.sqrt(math.log(12/ALPHA)/(2*REFERENCE_N)) + math.sqrt(math.log(12/ALPHA)/(2*WINDOW))
    result = {}
    for scenario_index, scenario in enumerate(("stable", "abrupt", "gradual")):
        all_alarms, first_snapshot_flags = [], 0
        for trial in range(RUNS):
            rng = np.random.default_rng(SEED + 100000 + 10000*scenario_index + trial)
            reference = draw_features(rng, REFERENCE_N)
            shift = np.zeros(LENGTH)
            if scenario == "abrupt":
                shift[ONSET:] = 1
            elif scenario == "gradual":
                shift[ONSET:] = np.minimum(1, (np.arange(LENGTH-ONSET)+1)/100)
            current = draw_features(rng, LENGTH, shift)
            alerts = []
            for end in range(WINDOW, LENGTH+1, INPUT_EVERY):
                distances = [ks_distance(reference[:, j], current[end-WINDOW:end, j]) for j in range(3)]
                if max(distances) > threshold:
                    alerts.append(end-1)
                    if end == WINDOW:
                        first_snapshot_flags += 1
            all_alarms.append(alerts)
        result[scenario] = {**summary(all_alarms, scenario != "stable"),
                            "firstStableSnapshotFlagRate": first_snapshot_flags/RUNS}
    return {"referenceRows": REFERENCE_N, "window": WINDOW, "checkEveryEvents": INPUT_EVERY,
            "featureCount": 3, "snapshotAlpha": ALPHA, "dkwThreshold": threshold,
            "shiftDefinition": "Word-count mean rises from 20 to 35; length follows word count; URL probability rises from 0.1 to 0.5. Gradual shift takes 100 events.",
            "scenarios": result}


def heldout_replay():
    """Permute actual held-out errors; do not invent a time axis or injected errors."""
    root = Path(__file__).resolve().parents[1]
    observations_path = root / "docs/results/test-observations.json"
    reference_path = root / "dist/data/monitoring-reference.json"
    if not observations_path.exists() or not reference_path.exists():
        return {"status": "unavailable", "reason": "Held-out observations or calibration reference are missing."}
    payload = observations_path.read_bytes()
    data = json.loads(payload)
    reference = json.loads(reference_path.read_text())
    records = data["records"]
    if data["modelVersion"] != reference["modelVersion"]:
        raise ValueError("Replay must not combine different model versions")
    if any(r["target"] not in (0, 1) or r["binaryPrediction"] not in (0, 1) for r in records):
        raise ValueError("Replay needs binary held-out targets and predictions")
    errors = np.asarray([r["target"] != r["binaryPrediction"] for r in records], dtype=float)
    n = len(errors)
    p0 = reference["errorRate"]
    ref_n = reference["errorRateRows"]
    margin = math.sqrt(math.log(2/ALPHA)/(2*ref_n)) + math.sqrt(math.log(2/ALPHA)/(2*WINDOW))
    threshold = min(1., p0 + margin)
    ewma_p = min(.98, max(.02, p0))
    ewma_limit = min(1., ewma_p + Z * math.sqrt(ewma_p*(1-ewma_p)*EWMA_LAMBDA/(2-EWMA_LAMBDA)))
    events = {"hoeffding_immediate": [], "hoeffding_delayed": [], "ewma_immediate": [], "ewma_delayed": []}
    permutations = 100
    for trial in range(permutations):
        order = np.random.default_rng(SEED+500000+trial).permutation(n)
        sequence = errors[order]
        bound_alerts, ewma_alerts, ewma = [], [], ewma_p
        for i, e in enumerate(sequence):
            ewma = EWMA_LAMBDA*e+(1-EWMA_LAMBDA)*ewma
            if i+1>=WINDOW:
                if np.mean(sequence[i-WINDOW+1:i+1]) > threshold:
                    bound_alerts.append(i)
                if ewma > ewma_limit:
                    ewma_alerts.append(i)
        events["hoeffding_immediate"].append(bound_alerts)
        events["ewma_immediate"].append(ewma_alerts)
        events["hoeffding_delayed"].append([t+LABEL_DELAY for t in bound_alerts if t+LABEL_DELAY<n])
        events["ewma_delayed"].append([t+LABEL_DELAY for t in ewma_alerts if t+LABEL_DELAY<n])
    return {
        "status": "complete", "modelVersion": data["modelVersion"],
        "observationsSha256": hashlib.sha256(payload).hexdigest(),
        "source": "Actual binary predictions and labels from the frozen grouped test split",
        "protocol": "100 seeded permutations without replacement of the same held-out rows. No change point, no invented errors and no chronological claim. Different orders are not independent new datasets. Delayed reviews arrive exactly 25 event slots later and stop at the original message horizon.",
        "rows": n, "actualErrors": int(np.sum(errors)), "actualErrorRate": float(np.mean(errors)),
        "calibrationErrorRate": p0, "calibrationRows": ref_n,
        "permutations": permutations, "seedBase": SEED+500000, "labelDelayEvents": LABEL_DELAY,
        "availableLabelsAtHorizonWithDelay": max(0,n-LABEL_DELAY),
        "labelCoverageAtHorizonWithDelay": max(0,n-LABEL_DELAY)/n,
        "defaultThreshold": threshold, "ewmaThreshold": ewma_limit,
        "methods": {name: {"ordersWithAnyAlert": sum(bool(x) for x in runs),
                            "orderingAlertRate": sum(bool(x) for x in runs)/permutations}
                    for name, runs in events.items()},
        "interpretation": "Ordering sensitivity diagnostic only. These alert frequencies are neither field false-alarm estimates nor drift detection rates. Calibration fitting reused its reference labels; actual future label delay and review selection are unknown.",
    }


def run():
    return {"experimentVersion": "dataguard-simulation-1", "synthetic": True,
            "seed": SEED, "runsPerScenario": RUNS, "streamLength": LENGTH,
            "onsetIndexZeroBased": ONSET,
            "protocol": "Original fixed-window, EWMA and DKW parameters were fixed before observing results. After EWMA showed excessive stable-run alerts, an analytical Hoeffding snapshot diagnostic was added as an engineering safeguard and evaluated on the same streams. No numeric parameter tuning was performed; this addition is not an independent confirmation of superiority. Each detector can alert repeatedly; summaries use first qualifying alert per run. Error and input experiments use separate streams.",
            "limitations": [
                "Controlled simulation only; no claim of real-world fraud accuracy or validated deployment alarm rates.",
                "The DKW bound is per snapshot under independent sampling; repeated rolling looks are not family-wise controlled across time.",
                "EWMA three-sigma limits are exploratory; 200 finite streams do not establish a guaranteed false-alarm rate.",
                "Fixed-window and EWMA compare raw binary errors. Abstained cases still have raw binary decisions for research diagnostics.",
                "A delayed alarm can follow the change onset even if its errors arose before the change. We report arrival-time delay, not causal attribution.",
                "The web dashboard uses a learned model's calibration error reference, selective human reviews and retained history; the simulation uses a known stationary baseline and complete labels.",
                "The added Hoeffding diagnostic uses an independent 200-outcome reference in the simulation. In the app, sigmoid calibration fitting reuses that reference split, so the mathematical independence assumptions do not establish a deployment guarantee.",
            ],
            "environment": {"python": platform.python_version(), "numpy": np.__version__},
            "inputMonitoring": input_experiments(), "errorMonitoring": error_experiments(), "heldoutReplay": heldout_replay()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("dist/data/monitoring-results.json"))
    args = parser.parse_args()
    result = run()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "inputMonitoring": result["inputMonitoring"]["scenarios"], "errorMonitoring": result["errorMonitoring"]["scenarios"], "heldoutReplay": result["heldoutReplay"]}, indent=2))
