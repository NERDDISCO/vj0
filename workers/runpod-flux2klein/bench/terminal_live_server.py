#!/usr/bin/env python3
"""Compose the isolated terminal/thread/mailbox benchmark dispatcher.

Use with terminal_live_worker.py, on a separate test port. This generator
preserves the production server and records the exact composed source hashes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from latest_mailbox import transform as mailbox_transform


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--warmup-shapes', default='512x288,768x448,1024x576')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Refusing to overwrite an existing generated dispatcher')
    helper = Path(__file__).with_name('configurable_server.py')
    with tempfile.TemporaryDirectory(prefix='vj0-terminal-server-') as directory:
        intermediate = Path(directory) / 'configured.js'
        result = subprocess.run([sys.executable, str(helper), '--source', str(args.source),
            '--output', str(intermediate), '--compute-variants', '--worker-routing',
            '--warmup-shapes', args.warmup_shapes], check=True, capture_output=True, text=True)
        configured_identity = json.loads(result.stdout)
        generated = intermediate.read_text()

    def replace(before, after):
        nonlocal generated
        if generated.count(before) != 1:
            raise ValueError('Expected exactly one source anchor: ' + before[:100])
        generated = generated.replace(before, after)

    replace("'all-constants'", "'terminal-noop'")
    replace("activeWorkers = WORKER_COUNT} = req.body || {};",
        "activeWorkers = WORKER_COUNT, benchmarkThreads = 128} = req.body || {};\n"
        "  if (!Number.isInteger(benchmarkThreads) || benchmarkThreads < 1 || benchmarkThreads > 256) return res.status(400).json({error:'Invalid benchmark thread count'});")
    replace('broadcastState({benchmarkVariant});', 'broadcastState({benchmarkVariant, benchmarkThreads});')
    replace('maxOutboundBytes:MAX_OUTBOUND_BUFFER, benchmarkVariant, activeWorkers:',
        'maxOutboundBytes:MAX_OUTBOUND_BUFFER, benchmarkVariant, benchmarkThreads, activeWorkers:')
    generated = mailbox_transform(generated)
    replace('      framesDispatched: w.framesDispatched || 0,',
        '      framesDispatched: w.framesDispatched || 0,\n'
        '      compileStartedAt: w.compileStartedAt,\n'
        '      mailboxFlightSource: w.latestMailboxFlight?.source_seq ?? null,')
    args.output.write_text(generated)
    subprocess.run(['node', '--check', str(args.output)], check=True, capture_output=True)
    helpers = [helper, Path(__file__).with_name('latest_mailbox.py'),
               Path(__file__).with_name('latest_mailbox_runtime.js'), Path(__file__)]
    print(json.dumps({'source_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
        'generated_sha256': hashlib.sha256(generated.encode()).hexdigest(),
        'configured_identity': configured_identity, 'warmup_shapes': args.warmup_shapes,
        'helpers': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in helpers}}))


if __name__ == '__main__':
    main()
