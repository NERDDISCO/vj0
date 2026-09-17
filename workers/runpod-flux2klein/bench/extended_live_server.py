#!/usr/bin/env python3
"""Add isolated telemetry and frame-aware buffer controls to a generated server.

The synchronous implementation is copied from the immutable image, renamed,
and selected before warmup. All other dispatch/worker/native-library code stays
identical within the comparison. No production dispatcher is modified.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', type=Path, required=True)
p.add_argument('--sync-source', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
if a.output.exists():
    p.error('Refusing to overwrite an existing generated dispatcher')
source = a.source.read_text()
sync_source = a.sync_source.read_text()
generated = source


def replace(before, after):
    global generated
    if generated.count(before) != 1:
        p.error('Expected exactly one source fragment: ' + before[:100])
    generated = generated.replace(before, after)


start = sync_source.index('function buildTelemetrySnapshot() {')
end = sync_source.index('app.post("/webrtc/offer",', start)
sync_functions = sync_source[start:end]
names = re.findall(r'^function (\w+)\(', sync_functions, re.MULTILINE)
assert set(names) == {'buildTelemetrySnapshot', 'readPodInfo', 'readCpuInfo',
    'readRamInfo', 'readDiskInfo', 'readNetworkVolumeInfo', 'readGpuInfo'}
for name in names:
    sync_functions = re.sub(r'\b' + name + r'\b', 'benchSync_' + name, sync_functions)
generated = "let BENCH_TELEMETRY_MODE = 'async';\nlet BENCH_OUTBOUND_FRAMES = 0;\n" + generated
replace('app.get("/telemetry", async (_req, res) => {\n  try {',
    '''app.get("/telemetry", async (_req, res) => {
  try {
    if (BENCH_TELEMETRY_MODE === 'sync') return res.json(benchSync_buildTelemetrySnapshot());''')
replace("app.post('/benchmark/config', (req, res) => {", """app.post('/benchmark/config', async (req, res) => {
  // Settle a previous asynchronous poll before resetting its cache or controls.
  if (telemetryInflight) await telemetryInflight.catch(() => null);
  const {telemetryMode = 'async', outboundFrames = 0} = req.body || {};
  if (!['sync', 'async'].includes(telemetryMode) || ![0, 1, 2, 3].includes(outboundFrames)) {
    return res.status(400).json({error:'Invalid telemetry/frame-budget configuration'});
  }""")
replace('  MAX_PENDING_PER_WORKER = maxPending;', '''  BENCH_TELEMETRY_MODE = telemetryMode;
  BENCH_OUTBOUND_FRAMES = outboundFrames;
  telemetryCache = {at:0, snapshot:null};
  MAX_PENDING_PER_WORKER = maxPending;''')
replace('res.json({maxPending:MAX_PENDING_PER_WORKER,',
    'res.json({telemetryMode:BENCH_TELEMETRY_MODE, outboundFrames:BENCH_OUTBOUND_FRAMES, maxPending:MAX_PENDING_PER_WORKER,')
replace('      if (buffered > MAX_OUTBOUND_BUFFER) {', '''      // Buffer.byteLength with base64 computes decoded size without decoding/allocating.
      const frameBytes = Buffer.byteLength(msg.image_base64, 'base64') + 8;
      const outboundBudget = BENCH_OUTBOUND_FRAMES
        ? Math.max(16384, BENCH_OUTBOUND_FRAMES * frameBytes) : MAX_OUTBOUND_BUFFER;
      diagStats.outboundBudgetBytes = outboundBudget;
      diagStats.benchmarkOutboundMaxBytes = Math.max(diagStats.benchmarkOutboundMaxBytes || 0, buffered);
      diagStats.benchmarkBudgetMinBytes = Math.min(diagStats.benchmarkBudgetMinBytes ?? Infinity, outboundBudget);
      diagStats.benchmarkBudgetMaxBytes = Math.max(diagStats.benchmarkBudgetMaxBytes || 0, outboundBudget);
      if (buffered > outboundBudget) {''')
replace('${buffered} > ${MAX_OUTBOUND_BUFFER};', '${buffered} > ${outboundBudget};')
generated += '\n// Frozen synchronous telemetry control.\n' + sync_functions
assert generated.count('utilPct: Number(utilPct) || 0,') == 2
generated = generated.replace('utilPct: Number(utilPct) || 0,',
    'utilPct: Number.isFinite(Number(utilPct)) ? Number(utilPct) : null,')
generated += '''
// Called after warmup drain and before the timed client window.
app.post('/benchmark/window', (_req, res) => {
  diagStats.benchmarkOutboundMaxBytes = 0;
  diagStats.benchmarkBudgetMinBytes = null;
  diagStats.benchmarkBudgetMaxBytes = 0;
  res.json({stats:{...diagStats}, serverTimeMs:Date.now()});
});
'''
a.output.write_text(generated)
print(json.dumps({'source_sha256':hashlib.sha256(source.encode()).hexdigest(),
    'sync_source_sha256':hashlib.sha256(sync_source.encode()).hexdigest(),
    'generated_sha256':hashlib.sha256(generated.encode()).hexdigest()}))
