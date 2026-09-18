# Reproducing the N06 browser evidence

The original `selection-v1.json` is immutable. `selection-archived-v1.json` names the same 36 jobs and order, with cohort paths remapped to `archived-cohorts/matrix-01`. Qualification, hold and lifecycle are preserved separately and are not extra performance repeats.

The archived matrix report is authoritative. Reproduce it from the repository root into a fresh temporary output path:

```sh
python3 workers/runpod-flux2klein/bench/n06_aggregate.py \
  --selection docs/performance/2026-09-18/scaling/selection-archived-v1.json \
  --output /tmp/vj0-n06-review/results-archived-v1.json
```

Exit **1 is expected**: all 36 windows are present, but the last 1024 × 576 two-worker selected window fails continuity. The report has no common structural/source errors and counts 35 passed and one continuity-failed trial. Do not make the exit successful by discarding the negative window. The decompressed canonical report is 112,093,559 bytes with SHA-256 `a050dffe22afeebc394635886480bf28a5caf6e28b6bf1f9239fbb02d97a7288`.

The byte-for-byte reproduction was checked in the original checkout. Generated
reports contain resolved absolute source paths, so a checkout at a different
location can produce different report bytes and a different whole-report hash.
The archived source-byte hashes, measured values and failure classifications
remain the portable comparison; do not rewrite historical source identities to
force another checkout's report to match that whole-file hash.

Reproduce the compact outputs in a separate fresh directory:

```sh
python3 workers/runpod-flux2klein/bench/n06_compact.py \
  --report docs/performance/2026-09-18/scaling/archived-reports/results-archived-v1.json.gz \
  --base docs/performance/2026-09-18/scaling \
  --output /tmp/vj0-n06-review/compact
```

The compact report also reads the archived hold and lifecycle records. The failed 600-second hold is not a matrix repeat, and the passing lifecycle contingency does not repair that failure. `metrics-compact-v1.json` retains full precision, individual trial outcomes, source hashes, per-worker activity, encoding durations, pulse counts and paired comparison ranges.

Each `archive.json` lists original file names, uncompressed byte counts/hashes and saved archive byte counts/hashes. Archives use deterministic gzip with `mtime=0`. The original full audit, passive connection log, harness stdout and N06 interception suffix are in `archived-browser-evidence`; the canonical archive-bound audit is in `archived-reports`. All JPEG inputs/outputs are retained without modification. `protected-input-prefix-proof.json` verifies the previous input interception prefix and immutable input connection log, and verifies that interception errors remained absent.

`archive-only-validation.json` records the byte-for-byte reproduction performed after all four original raw cohort paths were unavailable. Only completed, verified redundant copies were moved outside the repository, to `/tmp/vj0-n06-raw-20260918-0mp83q6t`. Nothing relies on that temporary backup for reproduction. `archive-preparation.json` records the earlier preparation stage; its temporary staging directory was subsequently relocated to that final backup. Original handoff files retain their historical pre-archive paths; the corresponding retained records are:

| Historical path | Archived path |
|---|---|
| `qualification-01/` | `archived-cohorts/qualification-01/` |
| `matrix-01/` | `archived-cohorts/matrix-01/` |
| `hold-01/` | `archived-cohorts/hold-01/` |
| `lifecycle-contingency-01/` | `archived-cohorts/lifecycle-contingency-01/` |
| `results-matrix-v1.json` | `archived-browser-evidence/results-matrix-v1.json.gz` |
| `results-archived-v1.json` | `archived-reports/results-archived-v1.json.gz` |
| `passive-connections-n06.jsonl` | `archived-browser-evidence/passive-connections-n06.jsonl.gz` |

Large `.json` records inside each cohort are accessed as `.json.gz`; the audit loader accepts either extension and hashes the restored bytes. Remote runtime/cache preservation and pod shutdown are separate records owned by the root agent.

After the owned browser/setup processes stopped, the shared input interception
file was restored to its exact committed prefix. The N06 suffix remains in this
archive. [The restoration record](input-prefix-restoration.json) confirms that
the prefix plus saved suffix reconstructs the captured full log's
hash; no N06 interception bytes were discarded.
