#!/usr/bin/env python3
"""Run same-pod clients serially against an already warm, exclusive service."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--jobs', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
jobs = json.loads(a.jobs.read_text())
if a.output.exists() and any(a.output.iterdir()):
    p.error('Output must be new or empty')
a.output.mkdir(parents=True, exist_ok=True)
progress = []


def persist():
    temporary = a.output/'progress.json.tmp'
    temporary.write_text(json.dumps(progress, indent=2)+'\n')
    temporary.replace(a.output/'progress.json')


for job in jobs:
    if not job['name'].replace('-', '').replace('_', '').isalnum():
        p.error('Invalid job name')
    output = a.output/(job['name']+'.json')
    if Path(job['output']).resolve() != output.resolve():
        p.error('Job output does not match this batch directory')
    config = a.output/(job['name']+'-config.json')
    config.write_text(json.dumps(job, indent=2)+'\n')
    record = {'name':job['name'], 'status':'running'}
    progress.append(record);persist()
    try:
        with (a.output/(job['name']+'.log')).open('w') as log:
            result = subprocess.run(['node', str(Path(__file__).with_name('samehost_transport.cjs')), str(config)],
                stdout=log, stderr=subprocess.STDOUT, timeout=job['seconds']+150)
        data = json.loads(output.read_text()) if output.exists() else {}
        if result.returncode or data.get('status') != 'measured':
            raise RuntimeError('Client failed or returned an invalid measurement')
        record.update(status='measured', receivedFps=data['receivedFps'])
    except Exception as error:
        record.update(status='failed', error=str(error));persist()
        raise
    persist();print(json.dumps(record), flush=True)
