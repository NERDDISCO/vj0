# Capture correction in the real app, with local WebRTC echo

All six accepted 30-second trials passed: real WebAudio reaches the real audio
analyser, both tabs remain visible, the channel stays open, source IDs increase
strictly, and no probe errors occur. Two production builds run on this Mac:
the earlier frontend from committed HEAD 01aa639 (build gnnxKcQmt4pHnefUWfVCv),
and the corrected capture scheduler. There are no UI, JPEG quality, image size,
or rendering changes between them. The app fixture, runner/probe hashes and
build identities are retained per batch. The unchanged shared app probe marks
unique image submissions, not physical display presentation.

The local fixture creates **two real browser RTCPeerConnections** and echoes
the exact image bytes. It replaces signaling and health responses for its own
explicit local URL. **There is no GPU, generation, server IPC or WAN in these
numbers.** They establish that the actual app's capture/transport/projector
path can sustain the corrected input cadence; they do not replace GPU FPS.

| Size | Before sent FPS | Corrected sent FPS | Before projector GL FPS | Corrected projector GL FPS |
|---|---:|---:|---:|---:|
| 512×288 | 38.63 | 59.90 | 38.63 | 59.90 |
| 768×448 | 39.16 | 59.29 | 39.16 | 59.33 |
| 1024×576 | 38.29 | 59.49 | 38.29 | 59.49 |

One completed observation per variant/size, in sequential before-then-after
batches. The isolated loop study has repeated controls and skip diagnostics:
[Capture diagnostic report](../capture-diagnostics/README.md).

The earlier setup artifacts remain under excluded-setup, with failure reasons.
Only before/after are accepted: both use the final identical loopback fixture,
including an enumerated synthetic audio device and verified analyser activity.
RMS samples, original raw events and all summaries are saved. Both browsers
used the same machine, main viewport 1440×900 and stage 1920×1080 at DPR1.

Reproduce with bench/capture-diagnostics/run-app-loopback.mjs and its sibling
app-loopback.js in a dedicated browser. VJ0_BENCH_ORIGIN selects the local build;
VJ0_BENCH_BUILD_DIR records its BUILD_ID. The setup creates and closes only its
owned tabs, and clears each app between sizes. The dedicated loopback browser
was closed after the accepted comparison.
