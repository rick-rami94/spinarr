---
phase: 02-trust-distribution
plan: 07
subsystem: ci-security
tags: [asan, ubsan, corpus-replay, ci, branch-protection]
requirements: [SAFE-10]
key-files:
  created: []
  modified: [engine/build.sh, test/security/corpus.test.js, .github/workflows/ci.yml]
completed: 2026-10-12
---

# Phase 2 Plan 07: ASan corpus replay as a required check Summary

The 70-case malicious-disc corpus now replays against sanitizer builds of `dvdinfo` and `bdinfo` on every change, and `asan` is a required status check on `main`.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | `asan` build mode and sanitizer-aware corpus replay | c24d937 | engine/build.sh, test/security/corpus.test.js |
| 2 | `asan` job in ci.yml | c795755 | .github/workflows/ci.yml |
| 3 | Make `asan` a required check | (GitHub branch protection) | — |

## What was built

- `sh engine/build.sh asan` builds sanitizer libdvdread/libbluray into `engine/deps/prefix-asan/` and sanitizer scanners into `engine/bin-asan/`; never touches `bin/` or `deps/prefix`.
- `corpus.test.js` honours `SPINARR_ENGINE_BIN`; in sanitizer mode it uses exit codes 86/87, a 60 s timeout and a stderr scan, so a sanitizer report can't hide behind the scanners' normal exit 1. Proven by a deliberately broken binary failing all 70 cases.
- `asan` job: ubuntu-24.04, 30 min timeout, SHA-pinned actions, `vm.mmap_rnd_bits=28` (runner-images#9515), clang + `libclang-rt-dev`, restore-only engine cache.

## Verification

- Local: 70/70 pass on macOS (Apple clang) and in an ubuntu:24.04 container (clang 18); zizmor 1.30.1 clean.
- GitHub: `asan` green on milestone/v1.0 runs 38326548117, 38327427502 and 38329580807.
- Task 3 (2026-10-12, run at Rick's direct request): `gh api repos/rick-rami94/spinarr/branches/main/protection/required_status_checks --jq '.contexts|sort|join(",")'` → `asan,audit,linux,macos,windows`.

## Deviations

1. [Rule 1] Added `libclang-rt-dev` to apt: Ubuntu 24.04's clang only recommends the sanitizer runtime.
2. [Rule 1] `actions/cache/restore` instead of `actions/cache` so this job (fetching 2 of 4 tarballs) can't save an incomplete cache under the linux job's key.

## Self-Check: PASSED
