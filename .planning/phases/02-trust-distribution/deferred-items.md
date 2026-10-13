# Phase 2 deferred items

## From plan 02-08 (fuzzing)

- **RESOLVED (fixed by engine patch libdvdread-0002; upstream report pending).** ~~**libdvdread leak drives fuzz_dvd_ifo to OOM.** `ifoRead_VTS_ATRT` does not free `vts_atrt->vts` when `ifoRead_VTS_ATTRIBUTES` fails. A seeded fuzz run on the patched build reached about 1.7 GB RSS in about 4 minutes, so hour-long batch runs will hit libFuzzer's 2560 MB `rss_limit_mb` and CIFuzz will report an OOM. Fix: add a libdvdread patch that frees it (this changes engine/patches, the SBOM pedigree and the patch stamps), or set `REPORT_OOMS=false` in scripts/fuzz-run.sh as a stopgap. Decide before the nightly workflow (02-10) goes live.~~
- **RESOLVED (fixed by engine patch libdvdread-0002; upstream report pending).** ~~**A patched-build crash in fuzz_dvd_ifo needs private triage.** Per D-09, nothing about it is recorded in the repo. The reproducer was handed to the orchestrator.~~
- Upstream report pending (libdvdread-0002).
