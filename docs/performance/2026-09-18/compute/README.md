# N03/N04 compute experiments

Completed: neither candidate group cleared its predeclared gate. See
[results and interpretation](RESULTS.md), [machine-readable summary](summary.json),
[original bounded plan](PLAN.md), and [N03 source/timing audit](review-n03.json), and [N04 numerical audit](review-n04.json).
No production change or new application FPS gain resulted from these trials.

N03 records **CUDA-event intervals around repeated micro-GEMM calls**. Its generic
raw top-level `timing_boundary` field describes the common full-pipeline harness,
but that later phase did not run. Use the per-row micro timing scope. The raw
metadata is preserved unchanged, and the correction is explicit in the report.

`attempt-v2` preserves the initial N03 source-proof API failure and both N04
quality rejections. `attempt-v3` preserves the corrected completed N03 trials.
Frozen sources and archive manifests make the evidence independently checkable.
The [operations records](operations/) include complete download SHA verification
and the successful persistent compiler-cache archive.
