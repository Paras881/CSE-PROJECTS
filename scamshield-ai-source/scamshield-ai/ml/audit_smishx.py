"""Reproducible aggregate audit; raw messages stay in the supplied work directory."""
import argparse
import csv
import hashlib
import json
import io
import re
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

PINNED_COMMIT = '116a8c827741e0572563f678d25ed04306b1e3ff'
ZERO_WIDTH = re.compile('[\u200b-\u200d\u2060\ufeff]')
URL = re.compile(r'''(?:https?://|www\.)[^\s<>"']+''', re.I)
EMAIL = re.compile(r'[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', re.I)
WORDS = re.compile('[a-z0-9]+')
LABELS = ('legitimate', 'spam', 'smishing')
# Manual source-only scope review, performed before any split or model evaluation.
NON_ENGLISH_IDS = set('''196a3da1984762566727a9bbfcc707d82bae90db5b33abbd619bc2606e82a020
1f922494520f935c8551b730f02c8f216cbc43a95adee5e8c58aa2b9d9623889
4ec01ba76322c934d449a8a0af297b832c93fa6ffb80771ca5b0e5dae1ee23de
16128aeac2170ec296b7d0136f1cf55e10392f4c47aa6f6854edf87bb7b399c6
4286f2c6625dc49f9023f50dc60c02720cc98f7ddc3e222ca4f4d23f6e11af73
b60c67a1c964b587db19515a91d46ff6b32b5bbcfcbae90728f0f89c5750fb39
374ddff8f7f55c3d31c39731b6e182f7a96ea784a2a8afba2cfbe99ff89814ac
e7bcc587fbdde6d7733953434358d9d800aee0f20bccc63507370b06ce2f4397
20f2d866bfaff818b5145532abfdc89ba94291cbddaed2d02bdbae570cfcd177
26740b6f179affadd13b16c7958daee242f06b0de24ec4c85d367a2d6ed50eee
ccf51f3de01a6a63df3b7b68599b0d9a696fd49c5fa39ddee4c860a16f600d3b'''.split())


def normalized(text):
    return ' '.join(ZERO_WIDTH.sub('', unicodedata.normalize('NFKC', text)).lower().split())


def preprocess(text):
    text = normalized(text)
    text = text.replace(r'\r', ' ').replace(r'\n', ' ').replace(r'\t', ' ')
    text = URL.sub(' zzurl ', text)
    text = EMAIL.sub(' zzemail ', text)
    text = re.sub('[0-9]+', ' zznumber ', text)
    text = re.sub(r'[^\x20-\x7e]', ' ', text)
    return ' '.join(text.split())


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def template_groups(rows, threshold=0.8):
    """Connected components of exact masked templates or >=.8 word3gram Jaccard."""
    parent = list(range(len(rows)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def join(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[max(a, b)] = min(a, b)
    features, exact = [], {}
    for i, row in enumerate(rows):
        words = WORDS.findall(preprocess(row['text']))
        template = ' '.join(words)
        if template in exact:
            join(i, exact[template])
        else:
            exact[template] = i
        features.append(set(zip(words, words[1:], words[2:])) if len(words) >= 6 else set())
    for i, a in enumerate(features):
        if not a:
            continue
        for j in range(i):
            b = features[j]
            if not b or min(len(a), len(b))/max(len(a), len(b)) < threshold:
                continue
            intersection = len(a & b)
            if intersection / (len(a) + len(b) - intersection) >= threshold:
                join(i, j)
    components = defaultdict(list)
    for i, row in enumerate(rows):
        components[find(i)].append(row['id'])
    ids = {i: digest('|'.join(sorted(items))) for i, items in components.items()}
    return [ids[find(i)] for i in range(len(rows))]


def audit(csv_path, output_dir, uci_zip=None):
    raw = csv_path.read_bytes()
    source = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
    by_text, invalid, empty = defaultdict(list), 0, 0
    for row in source:
        label, text = row.get('label', '').strip(), row.get('SMS', '')
        if label not in LABELS:
            invalid += 1
            continue
        key = normalized(text)
        if not key:
            empty += 1
            continue
        by_text[key].append((text, label))
    rows, conflict_rows, duplicates = [], 0, 0
    for key, items in sorted(by_text.items()):
        if len({label for _, label in items}) != 1:
            conflict_rows += len(items)
            continue
        duplicates += len(items) - 1
        rows.append({'id': digest(key), 'text': items[0][0], 'label': items[0][1]})
    deduplicated_rows = len(rows)
    language_exclusions = [row for row in rows if row['id'] in NON_ENGLISH_IDS]
    rows = [row for row in rows if row['id'] not in NON_ENGLISH_IDS]
    groups = template_groups(rows)
    for row, group in zip(rows, groups):
        row['group'] = group
    group_counts = Counter(groups)
    metadata_anomalies = {field: sum(row.get(field) not in ('0', '1') for row in source) for field in ('if_URL', 'if_phone', 'if_email')}
    uci_norm = set()
    if uci_zip:
        with zipfile.ZipFile(uci_zip) as z:
            filename = next(name for name in z.namelist() if name.endswith('SMSSpamCollection'))
            for line in z.read(filename).decode('utf-8').splitlines():
                if '\t' in line:
                    uci_norm.add(normalized(line.split('\t', 1)[1]))
    overlap = sum(normalized(row['text']) in uci_norm for row in rows) if uci_zip else None
    # Diagnostic script audit only, not an English-language detector.
    non_latin_letter_ids = [row['id'] for row in rows if any(ch.isalpha() and 'LATIN' not in unicodedata.name(ch, '') for ch in row['text'])]
    report = {
        'name': 'SmishX', 'source': 'https://github.com/yizhu-joy/SmishX',
        'pinnedCommit': PINNED_COMMIT, 'sha256': hashlib.sha256(raw).hexdigest(),
        'inputRows': len(source), 'inputLabels': dict(Counter(r['label'] for r in source)),
        'deduplicatedRows': deduplicated_rows, 'languageExcludedRows': len(language_exclusions),
        'languageExcludedLabels': dict(Counter(r['label'] for r in language_exclusions)),
        'uniqueRows': len(rows), 'labels': dict(Counter(r['label'] for r in rows)),
        'emptyRows': empty, 'invalidLabelRows': invalid, 'sameLabelDuplicatesRemoved': duplicates,
        'conflictingLabelRowsExcluded': conflict_rows, 'groups': len(group_counts),
        'multiMessageGroups': sum(n > 1 for n in group_counts.values()), 'largestGroup': max(group_counts.values()),
        'grouping': 'NFKC lowercase whitespace dedup; zero-width removed; URL/email/digit-masked word templates; word-trigram Jaccard>=0.8 for >=6words; connected components. Approximate templates, not verified campaigns.',
        'metadataAnomalies': metadata_anomalies, 'uciExactNormalizedOverlap': overlap,
        'nonLatinLetterRows': len(non_latin_letter_ids),
        'languageScope': 'English-only application; 11 manually inspected non-English/mojibake rows excluded before splitting. Script audit is not reliable language identification; short-text and transliteration uncertainty remain.',
        'dateAndSourceAvailability': 'No per-row time, source, or campaign identifiers. No temporal or source-held-out claim.',
        'rights': 'Authors release this research dataset in an MIT-licensed repository; underlying collected messages may have distinct rights. Raw messages are not redistributed by this project.'
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir/'cleaned.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=True)+'\n' for r in rows))
    (output_dir/'audit.json').write_text(json.dumps(report, indent=2)+'\n')
    (output_dir/'language-review-ids.json').write_text(json.dumps(non_latin_letter_ids, indent=2)+'\n')
    return report

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--csv', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--uci-zip', type=Path)
    a = p.parse_args()
    print(json.dumps(audit(a.csv, a.out, a.uci_zip), indent=2))
