// Test-only ordered SCTP barrier. Called by the ordinary channel's JSON handler.
// The acknowledgement follows all earlier inputs and their completed output
// messages on that same reliable, ordered channel. Never run in a timed window.
function beginInputBenchmarkBarrier(channel, clientEpoch, nonce) {
  if (typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(nonce)) {
    throw new Error('Invalid input benchmark barrier nonce');
  }
  const started = Date.now();
  const receivedAtBarrier = diagStats.framesFromClient;
  const sourceAtBarrier = nextSourceSequence;
  const finish = (status, detail) => {
    if (channel.readyState !== 'open') return;
    channel.send(JSON.stringify({type:'vj0-input-barrier-ack', nonce, status,
      detail, client_epoch:clientEpoch, receivedAtBarrier, sourceAtBarrier,
      elapsedMs:Date.now()-started}));
  };
  const poll = () => {
    if (channel !== activeChannel || clientEpoch !== activeClientEpoch || channel.readyState !== 'open') return;
    if (diagStats.framesFromClient !== receivedAtBarrier) {
      finish('failed', 'Input arrived after the stop/barrier boundary');
      return;
    }
    const idle = pendingBootstrap.length === 0 && !latestMailboxWaiting &&
      workers.every(w => w.ready && w.framePending === 0 &&
        !w.latestMailboxFlight && !w.compileStartedAt);
    if (idle && channel.bufferedAmount === 0) {
      finish('passed', 'All prior inputs admitted/dropped and workers idle; prior output precedes this ordered ack');
      return;
    }
    if (Date.now()-started >= 30000) {
      finish('failed', 'Worker/mailbox/output buffer did not drain within 30 seconds');
      return;
    }
    setTimeout(poll, 10);
  };
  poll();
}
