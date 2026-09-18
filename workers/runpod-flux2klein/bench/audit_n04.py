#!/usr/bin/env python3
"""Recompute N04 rejected-candidate metrics from preserved stage arrays and PNGs."""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def read_json(path):
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes())


def compare(a, b):
    delta=a.astype(np.float64)-b.astype(np.float64)
    return {'exact':bool(np.array_equal(a,b) and a.tobytes()==b.tobytes()),
            'shape':list(a.shape),'mse':float(np.mean(delta*delta)),
            'max_abs_error':float(np.max(np.abs(delta))),
            'fraction_changed':float(np.mean(a!=b)),
            'finite':bool(np.isfinite(a).all() and np.isfinite(b).all())}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    data=read_json(args.input)
    assert data['status']=='complete'
    assert data['torch_threads']==128
    records=data['records'];rows=[]
    variants={'channels-last','conv-1x1-as-mm'}
    quality=[r for r in records if r['status']=='quality']
    assert len(quality)==6 and {r['candidate'] for r in quality}==variants
    assert not any(r['status']=='measured' for r in records)
    for record in quality:
        assert record['size']==[512,288] and record['steps']==2
        assert record['global_rng_unchanged'] and record['traced_and_untraced_paths']
        assert not record['exact'] and not record['all_jpeg_exact']
        prefix=f"{record['candidate']}-512x288-steps2-phase{record['phase']}"
        base=args.input.parent
        with np.load(base/f'{prefix}-baseline-stages.npz') as a,np.load(base/f'{prefix}-candidate-stages.npz') as b:
            stages={key:compare(a[key],b[key]) for key in a.files}
        assert stages==record['stage_comparisons']
        with Image.open(base/f'{prefix}-baseline.png') as a,Image.open(base/f'{prefix}-candidate.png') as b:
            pixels=compare(np.asarray(a),np.asarray(b))
        assert pixels==record['pixel_comparisons'][0]
        assert pixels==record['pixel_comparisons'][2]
        assert record['pixel_comparisons'][1]['exact']
        assert all(item['finite'] for item in stages.values()) and pixels['finite']
        assert not stages['encoded_latents']['exact']
        rows.append({'candidate':record['candidate'],'phase':record['phase'],
                     'first_differing_stage':'encoded_latents','pixels':pixels,
                     'pixel_psnr_db':10*math.log10(255**2/pixels['mse']),
                     'stage_arrays_recomputed':True,'png_recomputed':True,
                     'traced_untraced_baseline_exact':True,
                     'traced_untraced_candidate_match_against_baseline_metrics':True})
    assert len([r for r in records if r['status']=='candidate-complete' and r['rejected']])==2
    assert len([r for r in records if r['status']=='untimed-profile' and r['frames']==3])==2
    audit={'status':'passed','source_result_sha256':hashlib.sha256(args.input.read_bytes()).hexdigest(),
           'fixtures':rows,'timing_cells':0,'promotions':[],
           'scope':'Recomputed saved stage arrays and traced PNGs. Untraced pixel/JPEG/RNG assertions are independently inspected records, not replayed GPU calls.',
           'conclusion':'Both variants failed exact-output gate; visual differences are quantified, not asserted to be perceptually worse. No FPS benefit measured or claimed.'}
    args.output.write_text(json.dumps(audit,indent=2)+'\n')
    print(json.dumps({'status':audit['status'],'fixtures':len(rows),'timing_cells':0}))


if __name__=='__main__':main()
