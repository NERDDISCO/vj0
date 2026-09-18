# N06: actual-app scaling on the newer stack

This compares the unchanged Klein weights on Pod C: Torch2.13/CUDA13.2,
TorchAO0.18, two RTX PRO6000 Blackwell Server GPUs. Both workers stay loaded;
the dispatcher routes to one or two active workers. Native Torch threads stay
128. No other pod runs timed work or heavy compilation during these trials.

Before app measurements, the frozen production proof must recheck exact
terminal-skip/output-cast equivalence within this stack. This does not prove
that a newer Torch stack produces the same pixels as the older stack. Preserve
proof failures; they block recommending that configuration.
The new proof also saves the same nine two-step PNG fixtures as the completed
older-stack proof. `operations/compare_stack_images.py` checks matching worker,
fixture and image-library versions, then produces cross-stack pixel metrics and
lossless paired previews. Review these separately: within-stack exactness does
not automatically accept a stack upgrade's appearance, and nine static images
do not establish temporal equivalence.

`jobs-v2.json` defines36 trials: three resolutions, one/two active workers,
baseline/selected configurations and three repeats with alternating order.
Each measures60 seconds after setup and warmup. Fixed controls are capture60,
256KiB admission, latest-input mailbox, pending limit3, JPEG85 input/JPEG80
output, two steps, alpha0.1 and seed42. Baseline versus selected compares a
configuration bundle, not an isolated feature. Selected enables the previously
validated compute bundle, terminal-zero prediction skip and GPU output cast.

Use the same frozen v5 actual-app harness and qualified Chrome149 headless
browser as N01/N02. Keep both preview and stage open. Retain achieved input,
received/preview/stage unique FPS, source-age percentiles/tails, per-worker
contributions, source ordering, stale drops, continuity, audio pulse propagation,
ordered drain acknowledgements and final cleanup. Stage FPS means unique GL
submissions; it does not establish physical monitor presentation rate.

`bench/n06_aggregate.py` requires all36 declared cells. Compute each paired
repeat ratio before taking its median, separately for the configuration bundle
and selected two/one-worker scaling. It retains failed/incomplete trials and
does not reuse N01's latency-promotion thresholds as a scaling acceptance rule.

After the matrix, run a600-second two-worker selected hold at768x448, followed
by the existing prompt/resolution/reconnect lifecycle stress. If a new input or
compute candidate passes its own gates, test its combination against the same
selected control before using it in the hold. Do not add individual percentages
or assume a one-GPU win carries over to two GPUs. Changed-precision NVFP4 stays
separate unless its independent visual review accepts the result.

The host address is shared with Pod A. Root assigns the exclusive measurement
slot, saves artifacts before shutdown, and verifies both pods are stopped.

## Predeclared lifecycle contingency

The frozen harness raises on a failed hold before running its lifecycle actions.
If the 600-second hold produces a complete negative window, preserve that window
and do not repeat it. After a verified drain, `jobs-lifecycle-contingency.json`
can run a separate eight-second qualification followed by the unchanged lifecycle
actions. Its short qualification is excluded from throughput comparisons and
cannot replace or repair the failed hold. Structural or unsafe service failures
require diagnosis before this continuation. Preserve any lifecycle failures too.

## Compilation cache reuse before first live launch

After the same-stack production proof completes and its GPU/compiler processes
exit, copy its completed `/tmp/vj0-c-torch213` and `/tmp/vj0-c-triton213` trees
into the absent live-cache paths. Preserve originals for absolute references,
verify file and symlink inventories plus all regular-file bytes, and record
proof/package/GPU identities. No N05 cache participates. The frozen launcher,
worker sources, compiler mode, native threads and formal job settings stay the
same. This saves redundant setup where cache keys match; it does not transfer
live CUDA graphs or guarantee every graph is a cache hit. Both workers and all
six shape/variant combinations still require warmup and qualification. These
are warmed trials, with no cold-start or cache-speedup claim.
