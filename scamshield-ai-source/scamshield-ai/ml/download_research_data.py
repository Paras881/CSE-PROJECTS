"""Fetch only the pinned research CSV, outside the published application."""
import argparse
import hashlib
from pathlib import Path
from urllib.request import Request, urlopen

COMMIT = '116a8c827741e0572563f678d25ed04306b1e3ff'
URL = f'https://raw.githubusercontent.com/yizhu-joy/SmishX/{COMMIT}/data/dataset.csv'
SHA256 = '8d65e373b17477c34e8f1c619e6f59d249e8fca21276cabdd03a55d11a469285'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True, help='Research work directory outside dist and version control')
    args = parser.parse_args()
    target = args.out.resolve() / 'dataset.csv'
    repo = Path(__file__).resolve().parents[1]
    if target == repo or repo in target.parents:
        parser.error('Store raw research data outside the source repository and static site.')
    if target.exists():
        data = target.read_bytes()
    else:
        req = Request(URL, headers={'User-Agent':'ScamShield-Research/1.0'})
        with urlopen(req, timeout=60) as response:
            data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError('Unexpected dataset size')
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError('Dataset digest does not match the pinned research release; no file overwritten.')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        tmp = target.with_suffix('.download')
        tmp.write_bytes(data)
        tmp.replace(target)
    print(f'Verified pinned dataset: {target}')

if __name__ == '__main__':
    main()
