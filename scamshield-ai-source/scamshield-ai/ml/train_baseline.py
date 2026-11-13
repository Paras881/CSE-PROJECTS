#!/usr/bin/env python3
"""Train an auditable SMS spam baseline using only the Python standard library.

This is a spam/ham classifier, NOT a scam classifier. The evaluation does not
establish performance on contemporary phishing, job scams, or other languages.
"""
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import random
import re
import urllib.request
import zipfile

SOURCE_URL = "https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip"
SOURCE_PAGE = "https://archive.ics.uci.edu/dataset/228/sms+spam+collection"
TOKEN_RE = re.compile(r"[a-z0-9]+")
LABELS = ("ham", "spam")


def tokenize(text):
    return TOKEN_RE.findall(text.lower())


def load_rows(path, csv_input=False):
    if csv_input:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames or not {"text", "label"}.issubset(reader.fieldnames):
                raise ValueError("CSV must contain text,label columns; labels must be ham or spam.")
            rows = [(row["label"].strip().lower(), row["text"]) for row in reader]
    else:
        with zipfile.ZipFile(path) as archive:
            member = next(name for name in archive.namelist() if Path(name).name == "SMSSpamCollection")
            lines = archive.read(member).decode("utf-8-sig").splitlines()
            rows = [tuple(line.split("\t", 1)) for line in lines if line.strip()]
    for row in rows:
        if len(row) != 2 or row[0] not in LABELS or not isinstance(row[1], str):
            raise ValueError("Every row must contain a text and a label of ham or spam.")
    return rows


def deduplicate(rows):
    groups = defaultdict(list)
    for label, text in rows:
        normalized = " ".join(tokenize(text))
        if normalized:
            groups[normalized].append((label, text))
    retained = []
    conflicts = 0
    duplicates = 0
    for normalized in sorted(groups):
        group = groups[normalized]
        if len({label for label, _ in group}) > 1:
            conflicts += len(group)
            continue
        retained.append(group[0])
        duplicates += len(group) - 1
    return retained, {
        "inputRows": len(rows), "uniqueRows": len(retained),
        "duplicateRowsRemoved": duplicates, "conflictingRowsRemoved": conflicts,
        "emptyTokenRowsRemoved": sum(not tokenize(text) for _, text in rows),
    }


def split_rows(rows, test_fraction=0.2, seed=2030):
    train, test = [], []
    generator = random.Random(seed)
    for label in LABELS:
        group = sorted((row for row in rows if row[0] == label), key=lambda row: " ".join(tokenize(row[1])))
        if len(group) < 5:
            raise ValueError("Need at least five unique messages in each class.")
        generator.shuffle(group)
        test_count = max(1, round(len(group) * test_fraction))
        test.extend(group[:test_count])
        train.extend(group[test_count:])
    generator.shuffle(train)
    generator.shuffle(test)
    assert not ({" ".join(tokenize(text)) for _, text in train} & {" ".join(tokenize(text)) for _, text in test})
    return train, test


def fit(train, min_df=2, alpha=1.0):
    document_frequency = Counter()
    for _, text in train:
        document_frequency.update(set(tokenize(text)))
    vocabulary = sorted(word for word, frequency in document_frequency.items() if frequency >= min_df)
    if not vocabulary:
        raise ValueError("Training vocabulary is empty; use more messages or --min-df 1.")
    allowed = set(vocabulary)
    counts = {label: Counter() for label in LABELS}
    documents = Counter(label for label, _ in train)
    for label, text in train:
        counts[label].update(token for token in tokenize(text) if token in allowed)
    denominators = {label: sum(counts[label].values()) + alpha * len(vocabulary) for label in LABELS}
    return {
        "schemaVersion": 1,
        "id": "sms-nb-v1",
        "name": "SMS spam baseline · Multinomial Naive Bayes",
        "task": "spam-vs-ham",
        "classes": list(LABELS),
        "threshold": 0.5,
        "tokenizer": "lowercase ASCII alphanumeric runs: [a-z0-9]+",
        "logPrior": [round(math.log(documents[label] / len(train)), 12) for label in LABELS],
        "vocabulary": {token: [round(math.log((counts[label][token] + alpha) / denominators[label]), 12)
                               for label in LABELS] for token in vocabulary},
        "parameters": {"alpha": alpha, "minDocumentFrequency": min_df},
        "limitations": [
            "Spam is not equivalent to scam. This model does not establish scam-detection accuracy.",
            "Scores are uncalibrated model outputs, not verified probabilities of harm.",
            "English SMS data is old and has no reliable chronological order; modern or multilingual inputs are out of scope.",
            "Unknown tokens are ignored. Low vocabulary coverage weakens the usefulness of the score.",
        ],
    }


def predict(text, model):
    tokens = tokenize(text)
    counts = Counter(tokens)
    scores = list(model["logPrior"])
    contributions = []
    known_count = 0
    for token, count in counts.items():
        weights = model["vocabulary"].get(token)
        if weights is None:
            continue
        known_count += count
        scores[0] += count * weights[0]
        scores[1] += count * weights[1]
        contributions.append({"token": token, "weight": count * (weights[1] - weights[0])})
    delta = scores[1] - scores[0]
    if delta >= 0:
        score = 1 / (1 + math.exp(-delta))
    else:
        exponential = math.exp(delta)
        score = exponential / (1 + exponential)
    contributions.sort(key=lambda item: (-abs(item["weight"]), item["token"]))
    return {"score": score, "topTokens": contributions[:8], "knownTokenCount": known_count,
            "totalTokenCount": len(tokens)}


def evaluate(test, model):
    confusion = {"truePositive": 0, "falsePositive": 0, "trueNegative": 0, "falseNegative": 0}
    log_loss = 0
    brier = 0
    for label, text in test:
        probability = predict(text, model)["score"]
        actual = label == "spam"
        predicted = probability >= model["threshold"]
        key = ("truePositive" if actual else "falsePositive") if predicted else ("falseNegative" if actual else "trueNegative")
        confusion[key] += 1
        clipped = max(1e-15, min(1 - 1e-15, probability))
        log_loss -= math.log(clipped if actual else 1 - clipped)
        brier += (probability - int(actual)) ** 2
    tp, fp, tn, fn = (confusion[key] for key in ("truePositive", "falsePositive", "trueNegative", "falseNegative"))
    precision = tp / (tp + fp) if tp + fp else 0
    recall = tp / (tp + fn) if tp + fn else 0
    return {
        "task": "spam-vs-ham only", "testSize": len(test), "positiveClass": "spam", "threshold": model["threshold"],
        "accuracy": (tp + tn) / len(test), "precision": precision, "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0,
        "falsePositiveRate": fp / (fp + tn) if fp + tn else 0,
        "alwaysHamAccuracy": sum(label == "ham" for label, _ in test) / len(test),
        "logLoss": log_loss / len(test), "brierScore": brier / len(test), "confusionMatrix": confusion,
        "warning": "These are internal, deduplicated random-holdout SMS spam results, not scam accuracy or temporal generalization results.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-zip", type=Path, help="UCI SMS Spam Collection zip")
    source.add_argument("--csv", type=Path, help="CSV with text,label; labels ham or spam")
    parser.add_argument("--download", action="store_true", help="Download official UCI zip to --source-zip path if absent")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "dist" / "data")
    parser.add_argument("--seed", type=int, default=2030)
    parser.add_argument("--test-fraction", type=float, default=0.2)
    parser.add_argument("--min-df", type=int, default=2)
    parser.add_argument("--source-name", default="User-provided labelled CSV")
    args = parser.parse_args()
    if not 0 < args.test_fraction < 1 or args.min_df < 1:
        parser.error("test-fraction must be between zero and one; min-df must be positive.")
    path = args.csv or args.source_zip
    if args.download:
        if not args.source_zip:
            parser.error("--download requires --source-zip")
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(SOURCE_URL, timeout=45) as response:
                path.write_bytes(response.read())
    rows, cleaning = deduplicate(load_rows(path, bool(args.csv)))
    train, test = split_rows(rows, args.test_fraction, args.seed)
    model = fit(train, min_df=args.min_df)
    provenance = {
        "name": args.source_name if args.csv else "UCI SMS Spam Collection",
        "url": None if args.csv else SOURCE_PAGE,
        "downloadUrl": None if args.csv else SOURCE_URL,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "license": "Verify rights for this input" if args.csv else "CC BY 4.0 (UCI repository)",
        "citation": None if args.csv else "Almeida, T. & Hidalgo, J. (2011). SMS Spam Collection [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CC84.",
    }
    split = {"method": "stratified random split after token-normalized deduplication; vocabulary fit on training only",
             "seed": args.seed, "testFraction": args.test_fraction,
             "trainRows": len(train), "testRows": len(test),
             "trainClasses": dict(Counter(label for label, _ in train)),
             "testClasses": dict(Counter(label for label, _ in test))}
    metrics = evaluate(test, model)
    model.update({"source": provenance, "cleaning": cleaning, "split": split, "evaluation": metrics})
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "spam-model.json").write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    report = {"modelId": model["id"], "source": provenance, "cleaning": cleaning, "split": split,
              "vocabularySize": len(model["vocabulary"]), "metrics": metrics}
    (args.output_dir / "baseline-metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    examples = ["Meet me at the library after class.", "Congratulations! Claim your free prize now by calling this number.",
                "Your internship is confirmed. Pay a refundable registration fee immediately to secure your position.",
                "", "xyzzyquux flibbertigibbet", "FREE free FrEe 123!", "Café — réunion demain à 10h"]
    golden = [{"text": text, **predict(text, model)} for text in examples]
    (args.output_dir / "inference-fixtures.json").write_text(json.dumps(golden, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
