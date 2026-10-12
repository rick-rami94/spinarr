---
phase: 02-trust-distribution
plan: 05
subsystem: fuzzing
tags: [fuzzing, libfuzzer, asan, ubsan, libdvdread, libbluray, SAFE-10]
requires: []
provides:
  - "int dvdinfo_print(dvd_reader_t *dvd) and int bdinfo_print(BLURAY *bd), main behind #ifndef SPINARR_FUZZ"
  - "fuzz/fuzz_dvd_ifo.c and fuzz/fuzz_bd_mpls_clpi.c (OSS-Fuzz/CFLite-compatible LLVMFuzzerTestOneInput)"
  - "fuzz/memfs.h archive format shared by both harnesses and make_seeds.py"
  - "fuzz/make_seeds.py --out / --zip (<name>_seed_corpus.zip for ClusterFuzzLite)"
  - "fuzz/build-local.sh local ASan/UBSan smoke run"
  - ".gitignore entries for all Phase 2 build outputs (engine/bin-asan/, build-out*/, fuzz/out/, test/security/fuzz-work/)"
affects: [02-08]
tech-stack:
  added: []
  patterns:
    - "Shipped scanner body exported as *_print(); harness links the same .c with -DSPINARR_FUZZ"
    - "In-memory filesystem callbacks (DVDOpenFiles / bd_open_files) instead of UDF images or tmpfs"
key-files:
  created:
    - fuzz/memfs.h
    - fuzz/fuzz_dvd_ifo.c
    - fuzz/fuzz_bd_mpls_clpi.c
    - fuzz/standalone_main.c
    - fuzz/fuzz_dvd_ifo.options
    - fuzz/fuzz_bd_mpls_clpi.options
    - fuzz/make_seeds.py
    - fuzz/build-local.sh
  modified:
    - engine/dvdinfo.c
    - engine/bdinfo.c
    - .gitignore
decisions:
  - "memfs: a structurally invalid record (path_len 0 or > 64, truncation) stops parsing; a record that only breaks the path allow-list is skipped, so later valid files stay reachable"
  - "memfs seeks past end are allowed and read 0 bytes (real-file semantics); negative/overflowing seeks return -1"
  - "Library-supplied paths are normalized (leading/doubled/trailing separators, '.', backslashes) before lookup; '..' fails the lookup"
  - "Local smoke links the non-instrumented patched static libs; only harness + scanner code carry ASan/UBSan. Instrumented libs are plan 02-08's Linux/CFLite job"
metrics:
  duration: "~25 min"
  completed: 2026-10-12
  tasks: 2
  files: 11
---

# Phase 2 Plan 05: In-memory fuzz harnesses for IFO and MPLS/CLPI Summary

Two libFuzzer harnesses that serve a fuzzer-described VIDEO_TS or BDMV tree from memory through `DVDOpenFiles` / `bd_open_files`, then run the exact shipped scanner bodies `dvdinfo_print()` / `bdinfo_print()`. The shipped binaries print byte-identical output before and after the refactor.

## What was built

**Task 1: scanner refactor (d3deaec).** `engine/dvdinfo.c` and `engine/bdinfo.c` now expose `int dvdinfo_print(dvd_reader_t *dvd)` and `int bdinfo_print(BLURAY *bd)`. Each returns the old exit status. `main` keeps ownership of the reader (`DVDOpen`/`DVDClose`, `bd_set_debug_mask(0)`/`bd_open`/`bd_close`), and `main` plus the `argv_utf8.h` include sit behind `#ifndef SPINARR_FUZZ`. `dvdinfo_print` routes every exit through one cleanup label. That fixes the old leak of `vmg` on the OOM path, and also on the "not a DVD" path when `ifoOpen` returned a partial handle. `engine/build.sh` never defines `SPINARR_FUZZ`.

**Task 2: harnesses (5c55e28).**
- `fuzz/memfs.h` is a header-only, fixed 64-entry table. It decodes the length-prefixed archive and enforces the path allow-list (`[A-Za-z0-9_./]`, no `..`, no leading `/`, required prefix). It also provides normalized lookup, directory listing derived from file paths, and bounded read/seek cursors. Entries borrow the fuzz input and nothing touches the real filesystem.
- `fuzz/fuzz_dvd_ifo.c` builds a heap `dvd_reader_filesystem_h` over the table and mirrors every `.IFO` to `.BUP`, overriding any input BUP. It calls `DVDOpenFiles(&table, &logcb, "/", fs)`, then `dvdinfo_print`, then `DVDClose`. On a NULL return the harness frees `fs` itself.
- `fuzz/fuzz_bd_mpls_clpi.c` mirrors `index.bdmv`, `MovieObject.bdmv`, `PLAYLIST/` and `CLIPINF/` into `BDMV/BACKUP/` when no backup is present. It then runs `bd_init`, `bd_open_files`, `bdinfo_print` and an unconditional `bd_close`.
- `fuzz/standalone_main.c` is the driver for Apple clang, which has no libFuzzer runtime. It takes a weak `LLVMFuzzerInitialize`, gives each input an exact-size heap copy so ASan sees any over-read, walks directories in sorted order and prints `ran <n> inputs`.
- `.options` files hold `detect_leaks=0` and `max_len=1048576`.
- `fuzz/make_seeds.py` turns the 33 DVD and 37 BD corpus cases into `.bin` seeds. With `--zip` it also writes deterministic `<name>_seed_corpus.zip` files.
- `fuzz/build-local.sh` builds both targets with ASan+UBSan and runs every seed plus three path-traversal probes (`VIDEO_TS/../../etc/passwd`, `BDMV/../../etc/passwd`, `/etc/passwd`). It fails on any non-zero exit (ASan 86, UBSan 87).

## Verification

- Before/after capture over 190 runs: all 33 + 37 malicious cases through both scanners, 22 fixture dirs/ISOs from `test/fixtures/out`, no-arg and nonexistent-path calls. `diff -r` was empty.
- `npm run test:security`: 70 pass, 1 skipped (the sandbox test needs `npm run fixtures`; it was already skipped).
- `cc -fsyntax-only -DSPINARR_FUZZ` passes for both scanners, and `build.sh scanners` compiles with no warnings.
- `sh fuzz/build-local.sh` exits 0: `ran 33 inputs` (fuzz_dvd_ifo) and `ran 37 inputs` (fuzz_bd_mpls_clpi), then `ran 1` / `ran 2` traversal probes, with no sanitizer report.
- Extra check (scratch build with stdout kept): for all 70 seeds, the in-memory harness printed exactly the same JSON as the shipped scanner on the original folder (`same=70 diff=0`). So the harnesses really do reach the full scanner path. They do not fail early at open.
- Running `make_seeds.py --zip` twice gives byte-identical zips (`cmp`).
- `git status --porcelain fuzz/out` is empty, so the folder is ignored.

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree had no engine/deps or engine/bin**
- **Found during:** Task 1
- **Issue:** `engine/deps/` and `engine/bin/` are gitignored, so the fresh worktree had no patched libraries to build the scanners against.
- **Fix:** Copied the main checkout's `engine/deps/prefix` (1.2 MB, read-only source) into the worktree and repointed `prefix=` in its three `.pc` files. The patch-set stamps (`a218ba30…` libdvdread, `c62ddf50…` libbluray) match this branch's `engine/patches`. The "before" binaries were built from the unmodified worktree source against this prefix. Nothing was committed or written in the main checkout.

**2. [Rule 2 - Correctness] Harness path normalization**
- libdvdread builds paths like `//VIDEO_TS/` from root `/`, and libbluray uses `DIR_SEP`. memfs therefore normalizes lookups. This was not spelled out in the plan, but the harness cannot serve files without it. `..` in a lookup fails closed.

No other deviations. The `ifoClose(vmg)` added on the non-DVD path frees a partial handle the old code leaked; output is unchanged.

## Notes for plan 02-08 (CI fuzzing)

- On macOS, a weak undefined `LLVMFuzzerInitialize` needs `-Wl,-U,_LLVMFuzzerInitialize`. Both harnesses define it, so this only matters for a future harness that does not. Linux/libFuzzer is unaffected.
- `hang_hang_2005746` takes about 3 s through the shipped `bdinfo` on disk, but it is fast in memory. Keep the libFuzzer `-timeout` reasonable.
- The largest seed is about 18 KB, well under `max_len=1048576`.

## Threat Flags

None. The new surface is build-only fuzz code, and T-02-14/T-02-15 are mitigated as planned: the byte-identical diff, `SPINARR_FUZZ` absent from build.sh, and the memfs allow-list plus traversal probes.

## Self-Check: PASSED

- All 11 files in key-files exist.
- Commits d3deaec and 5c55e28 exist on worktree-agent-ac4c6b3fad5d0106f.
