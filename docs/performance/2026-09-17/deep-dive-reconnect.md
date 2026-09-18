# Reconnect delay: archived evidence, no ICE changes

The three archived reconnect trials took **11.15–11.18 seconds from Connect to
the first newly generated image**. Approximately 10.3 seconds elapsed before the
browser peer entered `connecting`. The server's 10-second ICE-gather timeout is
the strongest supported explanation for that initial delay. Once capture
resumed, the first image's encode-start-to-receive age was **136–145 ms**. These
are different measurements: improving connection startup would not itself
increase steady-state FPS or reduce the inference time of each frame.

This is a read-only analysis of the September 17 archives. No ICE configuration
or signaling implementation was changed, and no shorter-timeout trial was run.

## Three reconnect trials

The [lifecycle results](app-source-order/source-order-next-768x448-ten-minute-soak/stress.json)
contain each Connect boundary and first received frame ID. The
[raw main-window probe](app-source-order/source-order-next-768x448-ten-minute-soak/main-stress-raw.json.gz)
contains peer connection-state events and the matching received row's `ageMs`.
All entries below are milliseconds, rounded to one decimal.

| Trial / first frame ID | Connect → peer connecting | Peer connecting → connected | Connected → encode start | Encode start → receive | Connect → receive |
|---|---:|---:|---:|---:|---:|
| 0 / 23150 | 10280.9 | 240.3 | 485.5 | 144.6 | 11151.3 |
| 1 / 23302 | 10305.7 | 296.2 | 428.2 | 135.8 | 11165.9 |
| 2 / 23467 | 10292.3 | 242.4 | 511.0 | 139.1 | 11184.8 |

The Connect timestamps were `1789666130862.5999`, `1789666148488.9` and
`1789666166088.3` epoch milliseconds. For each trial, take the first `connection`
events with states `connecting` and `connected` after that boundary. The encode
start is `received.at - received.ageMs` for the listed frame ID. The
[probe's measurement definition](../../../workers/runpod-flux2klein/bench/app_probe.js#L191)
starts at canvas encoding; it excludes audio-analyser acquisition and physical
display presentation. `connecting` here is the RTCPeerConnection state, not the
application's initial status label.

The harness polls channel readiness once per second, then clicks Generate.
Therefore the connected-to-encode interval includes test polling and action
overhead; it cannot be attributed entirely to the app. The intentional two-second
pause occurs **before** the Connect timestamp and is excluded from the table.
See [wait_for](../../../workers/runpod-flux2klein/bench/app_batch.py#L73) and
[the reconnect actions](../../../workers/runpod-flux2klein/bench/app_batch.py#L249).
The archived stress result explicitly excludes these lifecycle trials from the
preceding steady-state FPS measurement.

## Why the server wait is the leading explanation

The [server configuration](../../../workers/runpod-flux2klein/server.js#L46)
defaults `ICE_GATHER_TIMEOUT_MS` to `10000`. After setting the answer's local SDP,
the [offer handler](../../../workers/runpod-flux2klein/server.js#L839) waits for
[gathering completion or that timeout](../../../workers/runpod-flux2klein/server.js#L519)
before returning the single SDP answer.

In the [archived service log](final-source-order-service/service.log.gz), the
three reconnect blocks are at uncompressed lines 1468–1481, 1490–1503 and
1514–1527. Each records this order:

1. `POST /webrtc/offer`, with one offered host and one server-reflexive candidate.
2. `ICE gathering state: gathering`.
3. Two idle diagnostic records five seconds apart, with ready GPU workers and
   zero pending frames.
4. `Sending SDP answer`.
5. `ICE gathering state: complete`, followed by connection and DataChannel open.

Gather completion was logged **after** the answer was sent. Together with the
timeout code and browser timings, this is strong evidence that the wait exited
through its timeout in these sessions. The logs lack timestamps for individual
gather events and do not identify the underlying reason gathering remained
incomplete. They do not establish a STUN outage or a WebRTC-library defect.

The [client also waits for full gathering](../../../src/lib/ai/webrtc-transport.ts#L366)
with a default 10-second cap before posting its offer. The observed approximately
10.3-second initial phase and server log order support the server wait dominating
these trials; they do not show two consecutive 10-second waits. The separate
[five-second disconnected-state timer](../../../src/lib/ai/webrtc-transport.ts#L345)
does not explain this explicit Connect sequence.

## Possible isolated follow-up, not a measured improvement

The existing server environment variable permits comparing, for example,
1000 ms against 10000 ms without changing the single-exchange signaling design.
Current client/server code has no later `icecandidate` signaling or
`addIceCandidate` path. Returning an answer sooner could omit candidates needed
on another network, so these successful archived connections cannot establish
that a shorter timeout is universally safe. Server-answer candidate details were
not archived sufficiently to decide that question.

A future controlled test should separately timestamp client gather start/end,
HTTP request/response, server gather completion or timeout and candidate counts,
channel open, first capture and first receive. Repeated reconnects should record
failures and the selected candidate pair, and avoid the harness's one-second
polling bias. A candidate-aware early-answer policy with the original timeout as
fallback is another possible experiment, but candidate availability alone does
not prove reachability. Neither proposal is implemented or performance-validated
by this analysis.
