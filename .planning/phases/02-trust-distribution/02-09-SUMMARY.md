---
phase: 02-trust-distribution
plan: 09
subsystem: release-supply-chain
tags: [gpl, source-bundle, reproducible, licensing]
requires:
  - scripts/pins.js (02-02)
  - "`sh engine/build.sh fetch` (02-02)"
provides:
  - scripts/source-bundle.sh (deterministic spinarr-<ver>-source.tar.gz)
  - BUILDING.md (offline rebuild instructions, shipped inside the bundle)
  - test/unit/source-bundle.test.js
affects: [02-11 release.yml (attach, checksum, sign and attest the bundle)]
tech-stack:
  added: []
  patterns: [git archive + GNU tar --sort=name/--mtime/--numeric-owner + gzip -n for byte-identical output]
key-files:
  created:
    - scripts/source-bundle.sh
    - BUILDING.md
    - test/unit/source-bundle.test.js
  modified: []
decisions:
  - "Pins are read through `node -e` requiring scripts/pins.js (readPins), so the shell script has no second parser"
  - "Script sets umask 022 and LC_ALL=C so extracted file modes and sort order do not depend on the caller's environment"
  - "The ref-mismatch test runs in a throwaway git repo (script + build.sh committed, then build.sh edited), so it works offline, on shallow CI clones, and on macOS without GNU tar"
  - "The bundle test also asserts scripts/source-bundle.sh is in the bundle, so the bundle can rebuild itself"
metrics:
  duration: ~20 min
  completed: 2026-10-12
  tasks: 1
  files: 3
---

# Phase 2 Plan 09: Reproducible GPL Source Bundle Summary

`sh scripts/source-bundle.sh <ver> <outdir>` produces a byte-reproducible `spinarr-<ver>-source.tar.gz`. It holds the app source at the release ref, the 4 pinned upstream engine tarballs (re-verified against the pin table), the patches, the build scripts and a new BUILDING.md with offline rebuild instructions.

## What was built

- **scripts/source-bundle.sh** (POSIX sh, `set -eu`). `REF=${SPINARR_SOURCE_REF:-v$VER}`. It fails on an unknown ref. It also fails with "engine/build.sh differs from $REF; check out $REF first" when the working-tree build.sh does not match the ref. It finds GNU tar (`gtar`, then `tar`) or exits with "needs GNU tar (macOS: brew install gnu-tar)". Then it runs these steps:
  1. `git archive` of the ref, extracted into a `mktemp -d` dir that a trap removes.
  2. `sh engine/build.sh fetch`.
  3. Pin lines read via `scripts/pins.js`. Each `engine/deps/<name>-<ver>.tar.xz` is copied to `engine/upstream/` and its SHA-256 is checked again with the build.sh `sha256()` helper pattern.
  4. Packing with `--sort=name --mtime=@<commit time> --owner=0 --group=0 --numeric-owner --format=gnu`, then `gzip -n -9`.
  5. It prints the output path and size.
- **BUILDING.md**: what the bundle contains (with SPDX ids), how to verify the tarballs, per-OS prerequisites copied from the build.sh header, the offline engine build (`cp engine/upstream/*.tar.xz engine/deps/ && sh engine/build.sh`), and that libudfread 1.2.0 (LGPL-2.1-or-later) is embedded from libbluray's `contrib/libudfread/`. It also covers app packaging (`npm ci`, `npx electron-builder --publish never`) and Electron/Chromium source at https://github.com/electron/electron at the matching tag (including the bundled LGPL libffmpeg). Decryption libraries get a neutral "not part of Spinarr, not included" line with no download pointers. The bundle-rebuild command is documented too.
- **test/unit/source-bundle.test.js**: two tests.
  - The full bundle test skips on win32, without GNU tar, or when any pinned tarball is missing from `engine/deps/`. Otherwise it builds twice with `SPINARR_SOURCE_REF=HEAD` and checks that the sha256 values match, the bundle is under 50 MB, and every entry is under `spinarr-<ver>/`. It checks that the required files and every tracked `engine/patches/*.patch` are present, that `engine/upstream/` holds exactly the 4 pinned tarballs, that no entry is a decryption-library binary, and that each extracted tarball's SHA-256 equals its pin.
  - The ref-mismatch test runs on every non-Windows OS.

## Verification

- In Docker `node:22` (GNU tar 1.34), with the main repo's `.git` mounted read-only so the worktree gitdir resolves, `node --test test/unit/source-bundle.test.js` ran both tests with 0 skipped, and both passed. The full test took about 37 s for two bundle builds.
- A one-off container run gave a 15 MB bundle (`du -m` = 15) with exactly 4 entries under `engine/upstream/`.
- macOS (bsdtar only): the bundle test is skipped with "needs GNU tar", and the ref-mismatch test passes. `npm run test:unit`: 128 tests, 126 pass, 2 skipped, 0 fail.
- Grep checks: `gzip -n` = 1, `scripts/pins` = 2, `awk` = 0 in the script. `libudfread` = 2 and `electron/electron` = 1 in BUILDING.md.

## TDD Gate Compliance

- RED: `cf870d6 test(02-09): add failing test for reproducible GPL source bundle`. The failure was ENOENT because the script did not exist.
- GREEN: `ce036cf feat(02-09): reproducible GPL corresponding-source bundle and BUILDING.md`.
- No refactor commit was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Pinned umask and locale in the script**
- **Found during:** Task 1
- **Issue:** File modes after `git archive | tar -x` follow the caller's umask, and that would change the tarball bytes between machines.
- **Fix:** Added `umask 022` and `LC_ALL=C` at the top of the script.
- **Commit:** ce036cf

**2. [Rule 2 - Correctness] Clear error on an unknown ref**
- **Found during:** Task 1
- **Issue:** Without a check, a missing `v<ver>` tag would fail inside `git diff` with a confusing message.
- **Fix:** Added a `git rev-parse --verify` check that prints "unknown git ref: <ref>".
- **Commit:** ce036cf

### Notes

- The plan's verify command mounts only `$PWD`. In a git worktree that leaves `.git` pointing at a path that does not exist in the container, so I also mounted the main repo's `.git` read-only at its host path. On a normal clone (and in CI) the plan's command works as written.
- `node:22` already had `patch`, `xz` and `curl`. I copied the 4 pinned tarballs from the main checkout into the worktree's gitignored `engine/deps/`, and `build.sh fetch` re-verified them.
- The usage error exits with code 2. The plan does not specify a code.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: scripts/source-bundle.sh, BUILDING.md, test/unit/source-bundle.test.js
- FOUND commits: cf870d6, ce036cf
