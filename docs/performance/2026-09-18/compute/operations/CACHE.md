# Preserved compiler cache

With all compute jobs finished and no GPU compute process, the complete
`/tmp/torchinductor_root` tree was saved as one uncompressed file on Pod A's
persistent workspace:

`/workspace/torchinductor-A-20260918-final.tar`

The 2,914,877,440-byte archive includes the default nested Triton cache at
`torchinductor_root/triton/0`. Creation and complete tar header traversal finished
in 17.49 seconds; the fresh `.partial` file was renamed only after both succeeded.
[The operation proof](cache-preservation.json) preserves exact times and sizes.
This replaces no existing cache. The earlier directory backup contains only
541MB and is incomplete; the new archive covers the 2.73GB source tree.

The archive is a warm-start aid for the same Torch2.11/CUDA12.8/TorchAO0.17/SM120
configuration, not model weights or required experimental evidence. Saved
measurements, wrappers, images and stage arrays are already verified locally.
The cache remains on the persistent workspace, not in Git. Future reuse should
first verify software/GPU compatibility, then extract relative `torchinductor_root`
paths under `/tmp` before starting the worker. No automatic restore or migration
was added to production.
