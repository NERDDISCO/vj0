#!/usr/bin/env python3
"""Compare identical saved production fixtures across Torch stacks, untimed."""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def manifest(root):
    p = root / 'result.json'
    if p.exists():
        return json.loads(p.read_text())
    return json.loads(gzip.decompress(p.with_suffix('.json.gz').read_bytes()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old', type=Path, required=True)
    parser.add_argument('--new', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists(), 'Use a new evidence directory'
    old, new = manifest(args.old), manifest(args.new)
    assert old['status'] == new['status'] == 'complete'
    assert old['source_sha256'] == new['source_sha256'], 'Fixture/worker source mismatch'
    for key in ('diffusers', 'numpy', 'pillow'):
        assert old['versions'][key] == new['versions'][key], key
    assert old['initial_torch_threads'] == new['initial_torch_threads'] == 128
    args.output.mkdir(parents=True)
    rows = []
    for width, height in ((512, 288), (768, 448), (1024, 576)):
        for phase in range(3):
            name = f'{width}x{height}-phase{phase}-optimized.png'
            paths = (args.old / name, args.new / name)
            pictures = [Image.open(p).convert('RGB') for p in paths]
            assert all(p.size == (width, height) for p in pictures)
            a, b = [np.asarray(p, dtype=np.float64) for p in pictures]
            mse = float(np.mean((a - b) ** 2))
            row = {
                'fixture': name, 'pixels_equal': bool(np.array_equal(a, b)),
                'mse': mse, 'psnr_db': None if mse == 0 else 10 * math.log10(255 ** 2 / mse),
                'fraction_changed': float(np.mean(a != b)),
                'max_absolute_error': float(np.max(np.abs(a - b))),
                'png_sha256': [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths],
            }
            preview = Image.new('RGB', (width * 2, height + 28), 'black')
            draw = ImageDraw.Draw(preview)
            for index, picture in enumerate(pictures):
                label = ('Torch2.11 / CUDA12.8', 'Torch2.13 / CUDA13.2')[index]
                draw.text((index * width + 8, 7), label, fill='white')
                preview.paste(picture, (index * width, 28))
            row['paired_preview'] = name.replace('.png', '-stack-pair.webp')
            preview.save(args.output / row['paired_preview'], lossless=True)
            rows.append(row)
    result = {
        'status': 'compared', 'purpose': 'Cross-stack visual assessment; no timing or automatic acceptance',
        'old_versions': old['versions'], 'new_versions': new['versions'],
        'common_source_sha256': old['source_sha256'], 'rows': rows,
        'all_pixels_equal': all(row['pixels_equal'] for row in rows),
        'limitations': 'Nine fixed production fixtures, one prompt and seed; different physical GPU. Scalar metrics do not accept visual or temporal quality.',
    }
    (args.output / 'result.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'fixtures': len(rows), 'all_pixels_equal': result['all_pixels_equal']}))


if __name__ == '__main__':
    main()
