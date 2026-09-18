#!/usr/bin/env python3
"""Generate an isolated latest-input dispatcher; never edits the production file.

Input can be server.js or the output of configurable_server.py. Record the JSON
source/generated hashes. POST /benchmark/mailbox {"enabled": false|true} switches
policy only after every physical worker request has drained. Ordinary benchmark
queue controls still describe the baseline; mailbox mode always admits one
physical request per worker plus one newest waiting frame globally.
"""
import argparse
import hashlib
import json
from pathlib import Path


def transform(source):
    result = source

    def replace(before, after):
        nonlocal result
        if result.count(before) != 1:
            raise ValueError(f'Expected one source anchor: {before[:90]!r}')
        result = result.replace(before, after)

    runtime = Path(__file__).with_name('latest_mailbox_runtime.js').read_text()
    replace('function handleWorkerLine(w, line) {', runtime + '\nfunction handleWorkerLine(w, line) {')
    # Reuse the original single JSON parse. Finally runs after all existing
    # pending, liveness, outbound source-order and statistics processing.
    replace('  if (msg.log) {', '''  if (latestMailboxEnabled && isMailboxCompletion(msg) && !mailboxMessageMatches(w, msg)) {
    diagStats.mailboxUnmatched = (diagStats.mailboxUnmatched || 0) + 1;
    return;
  }
  try {
  if (msg.log) {''')
    replace('}\n\n// Pending requests buffered until at least one worker is ready', '''  } finally {
    finishLatestMailboxMessage(w, msg);
  }
}

// Pending requests buffered until at least one worker is ready''')
    # Preserve any existing active-worker routing gate inserted by the other
    # benchmark generator, and add the physical occupancy/compile guard.
    replace('    const w = workers[idx];', '''    const w = workers[idx];
    if (latestMailboxEnabled && (w.latestMailboxFlight || w.framePending > 0 || w.compileStartedAt)) continue;''')
    replace('function dispatchFrame(frameMsg) {\n  const w = nextReadyWorker();',
            'function dispatchFrameUnbuffered(frameMsg, forcedWorker = null) {\n  const w = forcedWorker || nextReadyWorker();')
    replace('function broadcastState(stateOnly) {\n  if (Object.keys(stateOnly).length === 0) return;',
            '''function broadcastState(stateOnly) {
  if (Object.keys(stateOnly).length === 0) return;
  if (latestMailboxEnabled) clearLatestMailbox('settings changed');''')
    replace('  // Buffer until a worker is ready', '''  if (latestMailboxEnabled) {
    sendToLatestMailbox(req);
    return;
  }

  // Buffer until a worker is ready''')
    replace('function clearPendingFrames() {', '''function clearPendingFrames() {
  clearLatestMailbox('pending frames cleared');''')
    replace('  for (const w of workers) {\n    if (w.framePending > 0) {', '''  for (const w of workers) {
    if (latestMailboxEnabled && w.latestMailboxFlight) continue;
    if (w.framePending > 0) {''')
    replace('  proc.on("close", (code) => {', '''  proc.on("close", (code) => {
    w.ready = false;
    w.latestMailboxFlight = null;''')
    replace('    // Auto-respawn: remove dead worker, spawn fresh one after a brief delay',
            '''    flushLatestMailbox();
    // Auto-respawn: remove dead worker, spawn fresh one after a brief delay''')
    marker = '// ---------------- bootstrap ---------------- //'
    replace(marker, '''// Explicit test-only control; switching requires a drained dispatcher.
app.post('/benchmark/mailbox', (req, res) => {
  try { res.json(configureLatestMailbox(req.body?.enabled)); }
  catch (error) { res.status(409).json({error: error.message}); }
});

''' + marker)
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if a.output.exists():
        p.error('Refusing to overwrite an existing generated dispatcher')
    source = a.source.read_text()
    generated = transform(source)
    a.output.write_text(generated)
    print(json.dumps({'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
        'generated_sha256': hashlib.sha256(generated.encode()).hexdigest(),
        'runtime_sha256': hashlib.sha256(Path(__file__).with_name('latest_mailbox_runtime.js').read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
