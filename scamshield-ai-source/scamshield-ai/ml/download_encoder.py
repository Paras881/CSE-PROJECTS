"""Download the pinned comparison encoder; weights stay outside the source tree."""
import argparse
import json
from pathlib import Path
from huggingface_hub import snapshot_download

REPO='sentence-transformers/all-MiniLM-L6-v2'
REVISION='1110a243fdf4706b3f48f1d95db1a4f5529b4d41'

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path,required=True)
    args=parser.parse_args()
    cache=args.cache.resolve()
    source=Path(__file__).resolve().parents[1]
    if cache==source or source in cache.parents: parser.error('Keep downloaded weights outside the source repository.')
    snapshot=snapshot_download(REPO,revision=REVISION,cache_dir=str(cache),allow_patterns=['*.json','*.safetensors','*.txt','1_Pooling/*','README.md'])
    print(json.dumps({'repo':REPO,'revision':REVISION,'snapshot':snapshot},indent=2))
