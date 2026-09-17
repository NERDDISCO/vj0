# Capture cadence investigation

The input scheduler has a reproducible timing defect. With a healthy approximately
60 Hz browser animation loop, the previous code produces approximately 37–38
JPEG inputs per second at its 60 FPS setting. The shared cadence correction
produces approximately 60 inputs per second with the same image dimensions and
JPEG quality. This is a local capture result, not generated-image or projector FPS.

## Real Chrome comparison

Headless Chrome 149 on this Mac, DPR 1. A 1280×720 animated white waveform is
redrawn on black every animation frame. Both variants copy that source into the
same output-size canvas and call `toBlob("image/jpeg", 0.85)` followed by
`arrayBuffer()`. There is no React app, GPU generation, WebRTC or WAN in this
isolated test. The metric counts completed buffers ready to send, not network
delivery. The production helper is injected into the candidate test.

The 60 FPS setting has two alternating ten-second observations per variant and
size. Table values are their medians. There are twelve observations in total.

| Capture size | Previous scheduler FPS | Corrected scheduler FPS | Previous / corrected cadence skips across both repeats |
|---|---:|---:|---:|
| 512×288 | 37.888 | 59.953 | 443 / 1 |
| 768×448 | 37.240 | 59.952 | 454 / 0 |
| 1024×576 | 37.689 | 59.952 | 444 / 0 |

Pending-encode skips across those repeats were respectively 0 / 0, 2 / 1 and
3 / 1. JPEG callback p95 was approximately 5.0–5.4 ms at 512, 7.2–9.3 ms at
768 and 9.3–11.1 ms at 1024. Cadence rejection, rather than encoding throughput,
explains the large gap in this controlled reproduction.

The normal 30 FPS setting is also affected. Six additional observations, one
eight-second observation per variant and size, give:

| Capture size | Previous scheduler FPS | Corrected scheduler FPS |
|---|---:|---:|
| 512×288 | 22.828 | 30.063 |
| 768×448 | 22.579 | 30.064 |
| 1024×576 | 22.703 | 30.064 |

Small measured rates above the target reflect finite-window boundaries. These
short local observations establish the scheduler defect; they do not establish
an end-to-end improvement or a broad statistical confidence interval.

## Why this happens

Both application loops previously compared `performance.now() - lastFrameTime`
with an exact `1000 / frameRate`, then replaced `lastFrameTime` with the current
callback time. Browser frame timestamps and callback execution times fluctuate
around 16.667 ms. A callback arriving slightly before the threshold is rejected;
the next opportunity is a whole browser frame later. Resetting to actual callback
time also loses the intended phase. The deadline was consumed before checking
pending encoding or transport admission, postponing retries after blocked work.

The correction uses the rAF timestamp, a phase-preserving deadline and a 0.5 ms
rounding tolerance. It consumes the deadline after an admitted canvas copy,
discards missed deadlines after long pauses, and captures at most one fresh
source frame per callback. The existing one-in-flight JPEG limit, connection and
buffer checks, generation guards, sizes and JPEG quality stay in place. Legacy
capture debug has its own deadline so disconnected debugging does not postpone
network sending when the channel recovers.

The browser supplies the same animation timestamp to callbacks in the same
frame; callback execution time can differ. [MDN requestAnimationFrame reference](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
Canvas `toBlob()` serialization is asynchronous, so its callback duration should
not be interpreted as an equal amount of main-thread CPU work. [HTML canvas specification](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob-dev).

## What this can and cannot improve

The corrected actual app previously sent 37–38 FPS. That is enough to feed the
measured 26.73 FPS projector result at 768×448 and 17.01 FPS at 1024×576; higher
input cadence alone does not make their GPU inference faster. At 512×288, the
earlier separate two-GPU transport capacity measurement of about 57 FPS makes
capture worth fixing. Neither that older capacity test nor this isolated
reproduction establishes a new actual-app FPS result. The full app must still
be measured with ordering checks, display-boundary measurements and latency.

Sending more frames also increases encode/network work and may simply create
more discarded inputs at GPU-limited sizes. The configured frame-rate control
should now deliver its requested rate accurately; it is not automatically a
recommendation to set every workload to 60 FPS.

Further input-side candidates remain hypotheses: throttle diagnostic React
state updates while keeping image delivery independent; profile per-frame
`getBoundingClientRect()` and scene rendering; and measure audio sampling → scene
drawing → capture callback order. Offscreen encoding is not an established win,
because the current JPEG API already serializes asynchronously. None of these
additional changes is included here.

## Validation and reproduction

The 43 focused tests cover actual capture callbacks in both layouts, rates
10/20/30/60/120 FPS with 30/59.94/60/120/144 Hz source clocks, rounding drift,
blocked encodes, transport congestion during encoding, stop/restart generation
guards, and independent legacy debug cadence. The healthy 60 Hz regression
fails on both previous application callbacks: 400 captures from 600 available
ticks. Both corrected callbacks produce 600 from 600. The separate deterministic
simulation includes 128 cases and is not a browser benchmark.

```sh
node --test workers/runpod-flux2klein/bench/test_capture.mjs workers/runpod-flux2klein/bench/test_capture_cadence.mjs
node workers/runpod-flux2klein/bench/capture-diagnostics/scheduler-simulation.mjs
node workers/runpod-flux2klein/bench/capture-diagnostics/prepare-browser.mjs > /tmp/vj0-capture-probe.js
agent-browser --session vj0-capture-check open about:blank
agent-browser --session vj0-capture-check eval --stdin < /tmp/vj0-capture-probe.js
agent-browser --session vj0-capture-check eval 'void runCaptureDiagnostics(10,2,60)'
# Poll captureDiagnosticResults.done; then save captureDiagnosticResults.
agent-browser --session vj0-capture-check close
```

Machine-readable summaries, lossless raw events and exact timed probes are
beside this document. `identity.json` records their scope and the helper runtime
fingerprint. A helper comment was clarified after preparing the 60 FPS probe;
the timed helper functions and current production functions were independently
compared and match exactly. The dedicated test browser was closed after the
last observation. No production build or screenshot recording ran during this
agent's matrix.
