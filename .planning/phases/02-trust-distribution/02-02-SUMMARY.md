---
phase: 02-trust-distribution
plan: 02
subsystem: release-supply-chain
tags: [sbom, cyclonedx, licensing, notices, ci]
requires: []
provides:
  - scripts/pins.js (single engine pin parser, D-15)
  - scripts/gen-sbom.js (CycloneDX 1.6 SBOM)
  - scripts/gen-notices.js + committed THIRD_PARTY_NOTICES.txt
  - "`sh engine/build.sh fetch` mode"
affects: [02-09 source bundle, fuzz build, release.yml SBOM attestation, About/notices UI]
tech-stack:
  added: [cyclonedx-cli v0.33.1 (CI-only, SHA-256 pinned release binary)]
  patterns: [pure builder + require.main CLI, generated-and-committed file with --check drift guard]
key-files:
  created:
    - scripts/pins.js
    - scripts/gen-sbom.js
    - scripts/gen-notices.js
    - THIRD_PARTY_NOTICES.txt
    - test/unit/sbom.test.js
    - test/unit/notices.test.js
  modified:
    - engine/build.sh
    - .github/workflows/ci.yml
    - .gitattributes
decisions:
  - "SPDX license is a 5th column of the build.sh SOURCES table; pins.js rejects 4-column lines"
  - "libudfread is a nested component of libbluray in the SBOM, with a libbluray -> libudfread dependency edge"
  - "Notices header carries no Spinarr version (points at spinarr-<version>-source.tar.gz), so it does not change on version bumps"
  - "THIRD_PARTY_NOTICES.txt is pinned to LF via .gitattributes so Windows unit tests see the same bytes"
metrics:
  duration: ~25 min
  completed: 2026-10-12
  tasks: 3
  files: 9
---

# Phase 2 Plan 02: SBOM and Third-Party Notices from the Pin Table Summary

The engine pin table in `engine/build.sh` (now with an SPDX column) feeds one parser, `scripts/pins.js`. That parser drives a deterministic CycloneDX 1.6 SBOM (patches as pedigree, libudfread nested under libbluray, Electron from package-lock) and a committed `THIRD_PARTY_NOTICES.txt`. CI checks the notices for drift and validates the SBOM with a hash-pinned cyclonedx-cli.

## What was built

- **engine/build.sh**: the `SOURCES` comment is now `name version url sha256 spdx-license`, and each pin has its SPDX id (ffmpeg GPL-3.0-or-later, libdvdread/libdvdnav GPL-2.0-or-later, libbluray LGPL-2.1-or-later). A new `fetch` mode calls the unchanged `fetch()` for every pin, then exits 0 without building anything.
- **scripts/pins.js**: exports `parsePins`, `readPins`, `patchesFor`, `electronVersion` and `EMBEDDED` (libudfread 1.2.0). Running `node scripts/pins.js` prints the pins as JSON for shell callers.
- **scripts/gen-sbom.js**: exports a pure `buildSbom()`. The CLI is `--version <v> --out <file>`. `bom-ref` equals the purl. There is no serialNumber. The timestamp comes from `SOURCE_DATE_EPOCH`, falling back to the HEAD commit time. Toolchain values (node from .nvmrc, meson from requirements-build.txt) go only into `metadata.properties`. The builder refuses decryption-library names.
- **scripts/gen-notices.js**: exports a pure `buildNotices()`. The CLI writes the file, or `--check` exits 1 with "THIRD_PARTY_NOTICES.txt is stale: run node scripts/gen-notices.js". If the extracted sources are missing it fails with "run `sh engine/build.sh fetch` first". It also fails if `node_modules/electron` is missing.
- **THIRD_PARTY_NOTICES.txt** (130 KB) has 6 sections: ffmpeg (COPYING.GPLv3 + LICENSE.md), libdvdread, libdvdnav, libbluray, libudfread and electron. The electron section has the MIT text, a pointer to `licenses/LICENSES.chromium.html` and the LGPL-2.1 libffmpeg source note.
- **ci.yml, linux job only**: two steps run after "Build engine". "Third-party notices are current" runs `gen-notices.js --check`. "SBOM is valid CycloneDX 1.6" downloads cyclonedx-cli v0.33.1 linux-x64, checks it against SHA-256 `bfc8b253…3c58746` with `sha256sum -c`, and validates with `--input-version v1_6 --fail-on-errors`. Job ids are unchanged (macos, linux, windows, audit). There are no `${{ }}` expressions in run blocks.

## Verification

- `npm run test:unit`: 104/104 pass, including 17 sbom/pins tests, 8 notices tests and the neutrality test.
- `sh engine/build.sh fetch` exits 0, verifies all 4 tarballs, applies 6 patches and prints no "engine built" line.
- `node scripts/pins.js | …` prints `4 true`, and `grep -c spdx-license engine/build.sh` gives 1.
- Two `SOURCE_DATE_EPOCH=1760000000` SBOM runs are byte-identical (`cmp`). The SBOM has 0 `serialNumber` entries. The acceptance one-liner prints `1.6 ffmpeg,libdvdread,libdvdnav,libbluray,electron libudfread`.
- The generated SBOM passed `cyclonedx validate --input-version v1_6 --fail-on-errors` locally, using the official v0.33.1 osx-x64 binary.
- The cyclonedx-linux-x64 hash was computed from a fresh download and matches GitHub's asset digest.
- Notices: `grep -c '^== '` gives 6. GPL matches 31, LGPL matches 5, and decryption-library sections 0. `--check` exits 0 on the committed file and exits 1 after a one-byte edit (reverted).
- `fetch()` body is untouched (see `git diff`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Pinned THIRD_PARTY_NOTICES.txt to LF line endings**
- **Found during:** Task 3
- **Issue:** The Windows CI job runs `npm run test:unit`. With autocrlf, the committed notices file would be checked out with CRLF, and the "committed file has a section for every component" test (which matches `\n== name ...\n`) would fail.
- **Fix:** Added `THIRD_PARTY_NOTICES.txt text eol=lf` to `.gitattributes`. The generator also normalizes CRLF in license texts.
- **Files modified:** .gitattributes
- **Commit:** f05fb95

### Notes

- The plan used `/tmp/claude-sbom-*.json` for verification. I used the session scratchpad directory instead, with the same commands and results.
- The worktree had no `engine/deps` or `node_modules`. I copied the 4 already-verified tarballs from the main checkout into the worktree's gitignored `engine/deps/`. `build.sh fetch` re-verified their SHA-256 before extraction. I also copied `node_modules/electron/dist/LICENSE` (Electron 44.7.0, matching the lock) for local notices generation. CI uses `npm ci` + `npm run engine`.
- I did not run a full `npm run engine` build in the worktree. `fetch()` and the build paths are unchanged, and only the new `fetch` mode branch was added before them.
- The CLI usage error exits with code 2; the plan does not specify a code.

## TDD Gate Compliance

Each task has a RED `test(02-02)` commit followed by a GREEN `feat(02-02)` commit: aaef5c2 then b360ee3, c8c25e6 then 36d55af, ba3b873 then f05fb95. No refactor commits were needed.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 RED | aaef5c2 | test(02-02): add failing tests for engine pin parser |
| 1 GREEN | b360ee3 | feat(02-02): add SPDX pin column, build.sh fetch mode and pin parser |
| 2 RED | c8c25e6 | test(02-02): add failing tests for CycloneDX SBOM builder |
| 2 GREEN | 36d55af | feat(02-02): generate deterministic CycloneDX 1.6 SBOM from engine pins |
| 3 RED | ba3b873 | test(02-02): add failing tests for third-party notices generator |
| 3 GREEN | f05fb95 | feat(02-02): generate THIRD_PARTY_NOTICES.txt and guard notices and SBOM in CI |

## Known Stubs

None.

## Self-Check: PASSED

- All created and modified files exist in the worktree.
- All 6 commits are present in `git log`.
