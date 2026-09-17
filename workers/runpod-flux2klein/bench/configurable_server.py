#!/usr/bin/env python3
"""Generate a test-only dispatcher with bounded queue/buffer controls.

The production dispatcher is unchanged. Use a separate port and record both
source hashes; controls are applied before warmup, never during a timed trial.
"""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--compute-variants', action='store_true', help='For use only with the generated configurable worker')
p.add_argument('--worker-routing', action='store_true', help='Compare one/two active GPUs with both workers already warm')
p.add_argument('--warmup-shapes', help='Explicit fallback worker warmup shapes for this test dispatcher')
a = p.parse_args()
if a.output.exists():
    p.error('Refusing to overwrite an existing generated dispatcher')
source = a.source.read_text()
generated = source
for name in ['MAX_PENDING_PER_WORKER', 'MAX_OUTBOUND_BUFFER']:
    needle = f'const {name} ='
    if generated.count(needle) != 1:
        p.error(f'Expected exactly one declaration of {name}')
    generated = generated.replace(needle, f'let {name} =')
marker = '// ---------------- bootstrap ---------------- //'
if generated.count(marker) != 1:
    p.error('Expected one bootstrap marker')
generated = generated.replace(marker, '''// Test-only controls: the ordinary image protocol and defaults are unchanged.
app.post('/benchmark/config', (req, res) => {
  const {maxPending, maxOutboundBytes} = req.body || {};
  if (![1, 2, 3].includes(maxPending) || !Number.isInteger(maxOutboundBytes) ||
      maxOutboundBytes < 16384 || maxOutboundBytes > 1024 * 1024) {
    return res.status(400).json({error:'Invalid benchmark queue/buffer configuration'});
  }
  MAX_PENDING_PER_WORKER = maxPending;
  MAX_OUTBOUND_BUFFER = maxOutboundBytes;
  res.json({maxPending:MAX_PENDING_PER_WORKER, maxOutboundBytes:MAX_OUTBOUND_BUFFER});
});

''' + marker)
if a.compute_variants:
    generated = generated.replace('  const {maxPending, maxOutboundBytes} = req.body || {};',
        '''  const {maxPending, maxOutboundBytes, benchmarkVariant = 'baseline'} = req.body || {};
  if (!['baseline', 'events', 'combined', 'all-constants'].includes(benchmarkVariant)) {
    return res.status(400).json({error:'Invalid benchmark compute variant'});
  }''')
    generated = generated.replace('  res.json({maxPending:MAX_PENDING_PER_WORKER, maxOutboundBytes:MAX_OUTBOUND_BUFFER});',
        '''  broadcastState({benchmarkVariant});
  res.json({maxPending:MAX_PENDING_PER_WORKER, maxOutboundBytes:MAX_OUTBOUND_BUFFER, benchmarkVariant});''')
if a.worker_routing:
    if not a.compute_variants:
        p.error('Worker routing requires compute-variants for telemetry verification')
    generated = generated.replace('const WORKER_COUNT = detectGpuCount();',
        'const WORKER_COUNT = detectGpuCount();\nlet BENCH_ACTIVE_WORKERS = WORKER_COUNT;')
    needle = '    if (!w.ready) continue;'
    if generated.count(needle) != 1:
        p.error('Expected exactly one ready-worker selection gate')
    generated = generated.replace(needle, '    if (!w.ready || w.gpu >= BENCH_ACTIVE_WORKERS) continue;')
    generated = generated.replace("  const {maxPending, maxOutboundBytes, benchmarkVariant = 'baseline'} = req.body || {};",
        """  const {maxPending, maxOutboundBytes, benchmarkVariant = 'baseline', activeWorkers = WORKER_COUNT} = req.body || {};
  if (![1, 2].includes(activeWorkers) || activeWorkers > WORKER_COUNT) {
    return res.status(400).json({error:'Invalid active worker count'});
  }""")
    generated = generated.replace('  broadcastState({benchmarkVariant});',
        '  BENCH_ACTIVE_WORKERS = activeWorkers;\n  broadcastState({benchmarkVariant});')
    generated = generated.replace('maxOutboundBytes:MAX_OUTBOUND_BUFFER, benchmarkVariant});',
        'maxOutboundBytes:MAX_OUTBOUND_BUFFER, benchmarkVariant, activeWorkers:BENCH_ACTIVE_WORKERS, loadedWorkers:WORKER_COUNT});')
if a.warmup_shapes:
    generated = 'process.env.WARMUP_SHAPES ||= ' + json.dumps(a.warmup_shapes) + ';\n' + generated
a.output.write_text(generated)
print(json.dumps({'source_sha256':hashlib.sha256(source.encode()).hexdigest(),
    'generated_sha256':hashlib.sha256(generated.encode()).hexdigest()}))
