#!/usr/bin/env python3
"""Add an experiment-only ordered drain barrier to a generated mailbox server."""
import argparse
import hashlib
import json
from pathlib import Path


def transform(source):
    required = ['let latestMailboxWaiting = null;', 'function configureLatestMailbox(',
                'let activeClientEpoch = 0;', 'let nextSourceSequence = 0;']
    for marker in required:
        if marker not in source:
            raise ValueError('Unsupported generated server: missing '+marker)
    before = '          const msg = JSON.parse(ev.data);'
    if source.count(before) != 1:
        raise ValueError('Expected one channel JSON handler')
    after = before + '''
          if (msg.type === 'vj0-input-barrier') {
            beginInputBenchmarkBarrier(channel, clientEpoch, msg.nonce);
            return;
          }'''
    source = source.replace(before, after)
    helper = Path(__file__).with_name('barrier_runtime.js').read_text()
    return source + '\n' + helper


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if a.output.exists():
        p.error('Refusing to overwrite generated server')
    original = a.source.read_text()
    generated = transform(original)
    a.output.write_text(generated)
    digest = lambda x: hashlib.sha256(x.encode()).hexdigest()
    print(json.dumps({'source':str(a.source), 'source_sha256':digest(original),
                      'generated_sha256':digest(generated),
                      'barrier_sha256':digest(Path(__file__).with_name('barrier_runtime.js').read_text())}))


if __name__ == '__main__':
    main()
