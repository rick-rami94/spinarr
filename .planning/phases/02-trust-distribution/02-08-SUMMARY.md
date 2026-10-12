---
phase: 02-trust-distribution
plan: 08
subsystem: fuzzing
tags: [fuzzing, clusterfuzzlite, libfuzzer, asan, libdvdread, libbluray, SAFE-10, D-09]
requires:
  - "02-02: sh engine/build.sh fetch (pinned, verified, patched sources)"
  - "02-05: fuzz/fuzz_dvd_ifo.c, fuzz/fuzz_bd_mpls_clpi.c, fuzz/*.options, fuzz/make_seeds.py"
provides:
  - ".clusterfuzzlite/{Dockerfile,build.sh,project.yaml}: CFLite build integration (address, coverage, and SPINARR_FUZZ_UNPATCHED=1 sanity builds)"
  - "scripts/fuzz-run.sh --mode code-change|batch|prune|coverage --seconds N --build-out D --corpus D --crashes D --log F [--report D]"
  - "Spike result: CFLite standalone run-fuzzers with a filesystem filestore works offline (PASS)"
affects: [02-10]
tech-stack:
  added:
    - "gcr.io/oss-fuzz-base/base-builder@sha256:1f9cf74bc3d7029b528494542f9d9851b256dceed38d3f420989434dc5ae0760 (tag v1, 2026-10-12)"
    - "gcr.io/oss-fuzz-base/clusterfuzzlite-run-fuzzers@sha256:5b76a5350444a73b1416f12b008342ae15d31d0581e3c26589f3aa0a8fd57c27 (tag v1, 2026-10-12)"
  patterns:
    - "Official CIFuzz runner in CFL_PLATFORM=standalone + FILESTORE=filesystem, wrapped by docker run --network none"
    - "Single summary line on stdout, everything else to a log file"
key-files:
  created:
    - .clusterfuzzlite/Dockerfile
    - .clusterfuzzlite/build.sh
    - .clusterfuzzlite/project.yaml
    - .dockerignore
    - scripts/fuzz-run.sh
  modified:
    - fuzz/fuzz_dvd_ifo.options
    - fuzz/fuzz_bd_mpls_clpi.options
decisions:
  - "Spike PASSED: fuzz-run.sh runs CFLite's own run-fuzzers image standalone; the thin libFuzzer fallback was not needed"
  - "The run container gets --network none, so no upload path exists even if CIFuzz tried one"
  - "Code-change mode uses CIFuzz's code-change runner when the repo is a plain git checkout (CI); otherwise it runs batch with the same budget"
  - "No build is ever stored in the filestore, so CIFuzz's 'reproducible on previous build' novelty check never hides a crash"
  - "project.yaml must not set base_os_version: CIFuzz would then pivot into an unpinned ubuntu-24-04 image via docker run"
  - "[asan] detect_leaks=0 added to both .options files (Pitfall 9); [libfuzzer] alone left exit-time LSan reports that CIFuzz saved as crash files in prune mode"
metrics:
  duration: "~25 min"
  completed: 2026-10-12
  tasks: 2
  files: 7
---

# Phase 2 Plan 08: ClusterFuzzLite build and private fuzz runner Summary

ClusterFuzzLite builds both harnesses with libFuzzer + ASan against the patched, pin-verified libdvdread and libbluray. The same build against unpatched sources crashes on the committed crash seeds, so the harnesses reach the vulnerable parsers. `scripts/fuzz-run.sh` runs CFLite's own run-fuzzers image in standalone mode, offline, with crashes kept in a local directory.

**Spike: PASS.** CFLite standalone mode with a filesystem filestore works. fuzz-run.sh uses it. The thin libFuzzer fallback was not built.

## Pinned images

| Image | Digest | Tag it came from |
|---|---|---|
| base-builder | `sha256:1f9cf74bc3d7029b528494542f9d9851b256dceed38d3f420989434dc5ae0760` | `gcr.io/oss-fuzz-base/base-builder:v1`, pulled 2026-10-12 |
| clusterfuzzlite-run-fuzzers | `sha256:5b76a5350444a73b1416f12b008342ae15d31d0581e3c26589f3aa0a8fd57c27` | `gcr.io/oss-fuzz-base/clusterfuzzlite-run-fuzzers:v1`, pulled 2026-10-12 |

meson comes from `.github/requirements-build.txt` via `pip3 install --require-hashes`. ninja-build, pkg-config, xz-utils and patch come from apt (documented exception, signed Ubuntu archive). base-builder ships clang 22 on Ubuntu 20.04 and has no meson.

## Task 1: build integration (8b61690)

- `.clusterfuzzlite/build.sh` runs `sh engine/build.sh fetch`. The log shows all four tarballs `OK` and all six patches applied. It then builds libdvdread and libbluray as static libraries into `$WORK/prefix`, using the same feature options as `engine/build.sh` plus `--buildtype=plain -Db_lundef=false`, so the environment's sanitizer and coverage CFLAGS compile the libraries. ASan reports land inside `ifo_read.c` and `clpi_parse.c` frames, which confirms the libraries themselves are instrumented.
- Harnesses are compiled with `$CC $CFLAGS -DSPINARR_FUZZ` and linked with `$CXX $CXXFLAGS ... $LIB_FUZZING_ENGINE $(pkg-config --static --libs ...)`. libFuzzer is C++, so the link uses `$CXX`; this is the usual OSS-Fuzz pattern.
- `SPINARR_FUZZ_UNPATCHED=1` checks each tarball's SHA-256 against the pin table, extracts a fresh copy into `$WORK/unpatched`, and builds from that without patches.
- Local builds on this Intel Mac (Docker 29.1.2): `build-out/` (address), `build-out-unpatched/` (address, no patches) and `build-out-coverage/` (coverage) all compile. Each has both fuzzers, both `.options` files and both `_seed_corpus.zip` files.

### Sanity check (inside spinarr-cflite)

| Target | Patched, `-runs=0` over all seeds | Unpatched, crash_* seeds | First crashing seed |
|---|---|---|---|
| fuzz_dvd_ifo | 33 seeds, exit 0, no sanitizer report | 13/22 crash | `crash_5a5058dd_1001001` (requested allocation size 0xffffffffbd00001c) |
| fuzz_bd_mpls_clpi | 37 seeds, exit 0, no sanitizer report | 33/36 crash | `crash_BUS_clpi_parse_c_430_in_clpi_find_stc_spn_2002004` (SEGV in `clpi_find_stc_spn`, clpi_parse.c:430) |

Other unpatched hits include a SEGV in `ifoRead_PGCIT_internal` (ifo_read.c:3203, `crash_972f3f16_*`), a heap-use-after-free in `ifoFree_TT_SRPT` (`crash_uaf_cf964217_7018446`), and heap-buffer-overflows in `clpi_lookup_spn` and `_fill_mark`. The seeds that do not crash are mostly UBSan-only cases (`crash_undefined_behavior_bits_c_167_28_*`) and the `crash_209bb8f1` / `crash_8cc151d2` families, which do not trip this ASan-only build.

## Task 2: the spike and fuzz-run.sh (608773b)

### Spike evidence

The run-fuzzers image was run against `build-out-unpatched` with `CFL_PLATFORM=standalone FILESTORE=filesystem FILESTORE_ROOT_DIR=/filestore WORKSPACE=/workspace MODE=batch FUZZ_SECONDS=120 SANITIZER=address REPOSITORY=spinarr`, entrypoint `run_fuzzers_entrypoint.py`. No token and no `GITHUB_*` / `ACTIONS_*` variables were set, and stdout+stderr went to a host file.

- **(a) Completes and reports the crash: yes.** Exit 2 ("Bug found"). Log: `Fuzzer: fuzz_bd_mpls_clpi. Detected bug.` ... `Crash is reproducible.` ... `SAVING CRASH`, and the same for fuzz_dvd_ifo.
- **(b) Testcase written locally: yes.** `filestore/crashes/fuzz_bd_mpls_clpi/address/crash-3138b5366656d5a3185d91aeb00616403088016c` and `filestore/crashes/fuzz_dvd_ifo/address/crash-35171531428ee54202354902e2dddd54e54a52de`. Each has a `.summary` file with the full sanitizer output, plus copies under `workspace/out/artifacts/`.
- **(c) No network or GitHub upload: yes.** `grep -inE "upload|artifact|github\.com|http"` matches only libFuzzer's local `artifact_prefix='/tmp/...'` lines and the filesystem filestore's own `Uploading corpus in /workspace/...` / `Uploading crashes in /workspace/out/artifacts/...` messages. Those are `distutils.copy_tree` calls into `/filestore` (filestore/filesystem/__init__.py). The code path explains it: `get_filestore()` only returns `GithubActionsFilestore` when `config.platform == EXTERNAL_GITHUB`, which requires `CFL_PLATFORM=github`. With `standalone`, the platform is `EXTERNAL_GENERIC_CI` and the filestore is `FilesystemFilestore`. As a second proof, every later run, code-change included, used `docker run --network none` and behaved the same.
- **(d) Code-change mode works with git metadata.** With no repo it fails clearly: `RuntimeError: Repo checkout does not exist.` (exit 1). The novelty check calls `download_latest_build()`, which needs `PROJECT_SRC_PATH`. With a plain git checkout mounted read-only and `PROJECT_SRC_PATH=/src/spinarr`, it runs `CiFuzzTargetRunner`. It tries the previous three commits' builds in the filestore, finds none, logs `Assuming crash was newly introduced`, saves the crash and stops (`Bug found. Stopping fuzzing.`).

### fuzz-run.sh

- Runs the pinned run-fuzzers image with `--network none --user $(id -u):$(id -g)`. That means no egress, and files on Linux runners belong to the runner user.
- Copies `--build-out` into a temp workspace. Seeds `<filestore>/corpus/<target>/` from `--corpus/<target>/`. Sets `FUZZ_SECONDS = seconds x targets`, because CFLite splits the budget. Afterwards it copies the filestore corpus back, so prune's replacement and batch's additions persist. It then copies each `crashes/<target>/<sanitizer>/<crash>` to `--crashes/<target>/<crash>`, with its `.summary` as `<crash>.log`.
- All runner output is appended to `--log`. stdout is only `fuzz-run: mode=<m> targets=<n> crashes=<k>`. Exit codes: 0 means no crash; 3 means at least one crash; 1 means infrastructure failure (including CIFuzz exit 2 with no crash file); 2 means usage error. `ulimit -c 0` is set.
- Coverage mode sets `SANITIZER=coverage`, copies `cifuzz-coverage/` into `--report`, and writes `summary.txt` from the llvm-cov `summary.json` totals.
- Code-change mode mounts the repo when `$REPO/.git` is a directory. In a git worktree, `.git` is a pointer file the container cannot follow, so the script logs the reason and runs batch with the same budget (D-11).

### Validation runs

| Run | Result |
|---|---|
| `--mode batch --seconds 30` on build-out-unpatched | exit 3; stdout is exactly `fuzz-run: mode=batch targets=2 crashes=2`; `crashes/fuzz_dvd_ifo/crash-3517...` + `.log` and `crashes/fuzz_bd_mpls_clpi/crash-3138...` + `.log` |
| `--mode batch --seconds 30` on build-out (patched) | exit 0; `crashes=0`; 19,974 and 109,726 execs; corpus grew to 314 / 670 entries |
| `--mode prune --seconds 30` (patched) | exit 0; corpus 911 → 485 (dvd), 357 → 261 (bd); no LeakSanitizer output |
| `--mode coverage --seconds 30` on build-out-coverage | exit 0; `summary.txt`: lines 3157/16125 (19.58%), functions 216/930, regions 2545/16820, branches 1369/9432 |
| `--mode code-change` from a plain clone, unpatched | exit 3; log shows `CiFuzzTargetRunner` and `Bug found. Stopping fuzzing.` |
| `--mode code-change` from this worktree, unpatched | exit 3; log line explains the batch fallback |

Acceptance greps: `grep -v '^ *#' scripts/fuzz-run.sh | grep -c upload` = 0. The only image reference is `@sha256:`-pinned. The Dockerfile has one `base-builder@sha256:` and one `require-hashes`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Leak reports saved as crash files**
- **Found during:** Task 2 (patched batch, then prune)
- **Issue:** `[libfuzzer] detect_leaks=0` only turns off libFuzzer's in-loop leak checks. At exit, LeakSanitizer still reported a libdvdread leak, and in prune mode CIFuzz saved that report as `crash-da39a3ee...` (an empty input), so fuzz-run.sh exited 3 on a clean build.
- **Fix:** added an `[asan] detect_leaks=0` section to both `fuzz/*.options`. ClusterFuzz's engine applies it to `ASAN_OPTIONS`. Re-run: 0 LeakSanitizer lines, prune exit 0.
- **Files modified:** fuzz/fuzz_dvd_ifo.options, fuzz/fuzz_bd_mpls_clpi.options
- **Commit:** 608773b

**2. [Rule 3 - Blocking] make_seeds.py needs --out**
- The plan said `python3 fuzz/make_seeds.py --zip $OUT`, but the script requires `--out`. build.sh passes `--out $WORK/seeds --zip $OUT`.

**3. [Rule 2 - Correctness] .dockerignore added**
- `COPY . $SRC/spinarr` would otherwise copy local `build-out*`, `node_modules` and extracted (possibly already patched) `engine/deps/*` dirs into the image. A stale fetch stamp would then skip SHA verification. `.dockerignore` keeps only `engine/deps/*.tar.xz`, so `build.sh fetch` always verifies and extracts fresh.

**4. [Rule 2 - Security] --network none and --user on the run container**
- Not in the plan. `--network none` turns "the log shows no upload" into "an upload cannot happen". `--user` avoids root-owned files on Linux runners.

### Notes

- The plan's verify paths used `/tmp/claude-fz/...`. The session scratchpad was used instead, with the same commands.
- The worktree had no `engine/deps`. The four pinned tarballs were copied from the main checkout into the worktree's gitignored `engine/deps/`, and `build.sh fetch` re-verified them in the container.
- The `crash_ec8ba237_*` DVD seeds report the overflow in `memfs_read` (frame #1, under `__asan_memcpy`). The destination is a 2048-byte buffer that libdvdread allocates in `ifoRead_TT_SRPT`, asked to take 4096 bytes. That is the library bug the patch fixes, not a harness bug: the patched build is clean on these seeds.

## Deferred Issues

1. **A memory leak in libdvdread will trigger OOM reports in long runs.** A seeded `fuzz_dvd_ifo` run on the patched build reached 1.6 to 1.8 GB RSS in about 4 minutes. The exit-time LeakSanitizer report attributed most of it to `ifoRead_VTS_ATRT`: the error path after `ifoRead_VTS_ATTRIBUTES` fails frees `data` and `vts_atrt` but not `vts_atrt->vts`. libFuzzer's default `rss_limit_mb=2560` will therefore end hour-long nightly batch runs with an OOM testcase, and CIFuzz reports OOMs by default. Options: a libdvdread patch that frees `vts_atrt->vts` (it touches shipped patches, the SBOM pedigree and the patch stamps, so it is out of this plan's scope), or `REPORT_OOMS=false` in fuzz-run.sh as a stopgap. This is logged in deferred-items.md.
2. **The patched build crashed during a local 10-minute run.** A seeded `fuzz_dvd_ifo` run found a reproducible sanitizer crash in the **patched** libdvdread. Under D-09, neither the reproducer nor the trace is committed. They went privately to the orchestrator for triage and the private-advisory flow. This is the result the pipeline exists to produce. The harness and runner worked as intended.

## Notes for plan 02-10 (workflows)

- Build: `google/clusterfuzzlite/actions/build_fuzzers` (SHA-pinned, `language: c`, `sanitizer: address`), or `docker build -f .clusterfuzzlite/Dockerfile` followed by `docker run ... compile` as above. The coverage workflow needs a second build with `sanitizer: coverage`.
- Run: `sh scripts/fuzz-run.sh ...` only. Never use the `run_fuzzers` action in the public repo (Pitfall 1).
- Add `sudo sysctl vm.mmap_rnd_bits=28` before fuzzing on GitHub runners (STACK note). Locally under Docker Desktop this was not needed.
- Keep `base_os_version` out of `.clusterfuzzlite/project.yaml`.

## Threat Flags

None. The new surface is CI-only build and run tooling. T-02-22 to T-02-25 and T-02-SC are mitigated as planned: digest pins, hash-pinned meson, sources only from `build.sh fetch`, `ulimit -c 0`, log-only output, and `--network none`.

## Self-Check: PASSED

- All 7 files in key-files exist.
- Commits 8b61690 and 608773b exist on worktree-agent-af3844e8596ffebb0.
