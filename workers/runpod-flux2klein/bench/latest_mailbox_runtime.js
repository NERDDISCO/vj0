// Latest-input mailbox experiment: one physical request per worker and one
// newest waiting input globally. Included only by latest_mailbox.py.
let latestMailboxEnabled = process.env.LATEST_INPUT_MAILBOX !== '0';
let latestMailboxWaiting = null;
let latestMailboxFlushing = false;

function clearLatestMailbox(reason) {
  if (latestMailboxWaiting) {
    diagStats.mailboxCleared = (diagStats.mailboxCleared || 0) + 1;
    diagStats.mailboxLastClearReason = reason;
  }
  latestMailboxWaiting = null;
}

function configureLatestMailbox(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
  // Baseline boot requests can contain both old images and old settings. A
  // later READY replay must not overwrite newer mailbox-era input or state.
  if (pendingBootstrap.length > 0) {
    throw new Error('Drain all bootstrap requests before changing mailbox policy');
  }
  if (workers.some(w => w.framePending > 0 || w.latestMailboxFlight)) {
    throw new Error('Drain all worker requests before changing mailbox policy');
  }
  clearLatestMailbox('policy changed');
  latestMailboxEnabled = enabled;
  return { enabled, effectiveMaxPending: enabled ? 1 : MAX_PENDING_PER_WORKER,
    waitingCapacity: enabled ? 1 : 0 };
}

function flushLatestMailbox() {
  if (!latestMailboxEnabled || latestMailboxFlushing || !latestMailboxWaiting) return;
  if (latestMailboxWaiting.client_epoch !== activeClientEpoch || activeChannel?.readyState !== 'open') {
    clearLatestMailbox('client unavailable');
    return;
  }
  latestMailboxFlushing = true;
  try {
    // A failed stdin write marks that worker unavailable. Try another worker
    // without admitting another frame or waiting for a future browser tick.
    for (let attempt = 0; attempt < workers.length && latestMailboxWaiting; attempt++) {
      const w = nextReadyWorker();
      if (!w) return;
      const frame = latestMailboxWaiting;
      w.latestMailboxFlight = frame;
      if (dispatchFrameUnbuffered(frame, w)) {
        latestMailboxWaiting = null;
        diagStats.mailboxDispatched = (diagStats.mailboxDispatched || 0) + 1;
      } else {
        w.latestMailboxFlight = null;
      }
    }
  } finally {
    latestMailboxFlushing = false;
  }
}

function dispatchFrame(frameMsg) {
  if (!latestMailboxEnabled) return dispatchFrameUnbuffered(frameMsg);
  if (frameMsg.client_epoch !== activeClientEpoch) return false;
  if (latestMailboxWaiting) {
    diagStats.mailboxReplaced = (diagStats.mailboxReplaced || 0) + 1;
  }
  latestMailboxWaiting = Object.freeze({ ...frameMsg });
  flushLatestMailbox();
  return true;
}

function sendToLatestMailbox(req) {
  // State is retained even before the first worker is ready, while image
  // memory stays bounded. The ordinary bootstrap array remains unused here.
  const stateOnly = {};
  for (const key of STATE_FIELDS) if (key in req) stateOnly[key] = req[key];
  if (Object.keys(stateOnly).length) broadcastState(stateOnly);
  if (req.image_base64) {
    dispatchFrame({ image_base64: req.image_base64, source_seq: ++nextSourceSequence,
      client_epoch: req.client_epoch ?? activeClientEpoch,
      ...(req.frame_id !== undefined ? { frame_id: req.frame_id } : {}) });
  }
}

function isMailboxCompletion(msg) {
  return msg.status === 'frame' || msg.status === 'frame_dropped' ||
    (msg.frame_dropped && (msg.status === 'error' || msg.status === 'compile_failed'));
}

function mailboxMessageMatches(w, msg) {
  const flight = w.latestMailboxFlight;
  if (!flight || msg.client_epoch !== flight.client_epoch) return false;
  // Existing worker error/drop messages have an epoch but no source_seq.
  // The one-request invariant makes that acknowledgement unambiguous.
  // Invalid/missing source on a frame is still passed to the ordinary handler
  // to count/reject the protocol violation and release this occupied slot.
  return !Number.isSafeInteger(msg.source_seq) || msg.source_seq < 1 || msg.source_seq === flight.source_seq;
}

function finishLatestMailboxMessage(w, msg) {
  if (!latestMailboxEnabled) return;
  if (msg.status === 'compiling') clearLatestMailbox('compile started');
  if (isMailboxCompletion(msg) && mailboxMessageMatches(w, msg)) {
    const flight = w.latestMailboxFlight;
    w.latestMailboxFlight = null;
    // Ordinary handling deliberately ignores old-client accounting. During
    // reconnect we preserve physical occupancy until its real completion.
    if (flight.client_epoch !== activeClientEpoch) {
      w.framePending = Math.max(0, w.framePending - 1);
    }
  }
  if (msg.status === 'shutdown') w.latestMailboxFlight = null;
  if (isMailboxCompletion(msg) || ['ready', 'warmed', 'compile_failed', 'shutdown'].includes(msg.status)) {
    flushLatestMailbox();
  }
}
