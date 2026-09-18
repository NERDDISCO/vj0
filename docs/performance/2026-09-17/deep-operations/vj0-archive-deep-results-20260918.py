#!/usr/bin/env python3
"""Archive completed synthetic benchmark evidence, retaining source byte hashes."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path('/Users/nerddisco/.t3/worktrees/vj0/t3code-78489133/docs/performance/2026-09-17')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def archive(source, destination):
    if destination.exists():
        raise RuntimeError('Refusing to overwrite archive: ' + str(destination))
    destination.mkdir(parents=True)
    rows = []
    for path in sorted(source.rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts:
            continue
        relative = path.relative_to(source)
        data = path.read_bytes()
        compressed = len(data) > 128 * 1024 and path.suffix in ('.json', '.jsonl', '.log', '.txt')
        saved = gzip.compress(data, compresslevel=6, mtime=0) if compressed else data
        target = destination / (str(relative) + ('.gz' if compressed else ''))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(saved)
        recovered = gzip.decompress(target.read_bytes()) if compressed else target.read_bytes()
        assert recovered == data
        rows.append({'original': str(relative), 'archive': str(target.relative_to(destination)),
                     'bytes': len(data), 'sha256': sha(data), 'archive_bytes': len(saved),
                     'archive_sha256': sha(saved)})
    (destination / 'archive.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps({'source': str(source), 'destination': str(destination), 'files': len(rows),
                      'source_bytes': sum(x['bytes'] for x in rows),
                      'archive_bytes': sum(x['archive_bytes'] for x in rows)}), flush=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('destination_name')
    a = p.parse_args()
    assert a.source.is_dir()
    assert '/' not in a.destination_name and a.destination_name not in ('.', '..')
    archive(a.source, ROOT / a.destination_name)

if __name__ == '__main__':
    main()
