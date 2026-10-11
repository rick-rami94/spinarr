---
phase: 01-safety-gate-ci-baseline
plan: 08
subsystem: e2e
tags: [qual-02, hermetic, e2e, aacs, accurateChapters, sentinel]
requires:
  - "01-02: SPINARR_TEST_HOME hook in main.js / createPlatform"
  - "01-04: engine accurateChapters=false test and the 0.6 s chapter tolerance"
  - "01-07: per-scenario env.home, prompt-aware h.load"
provides:
  - "sec_hermetic_keydirs: cssCache, keyDirs and keydbPath proven under SPINARR_TEST_HOME"
  - "CI-only real-home KEYDB.cfg sentinel in run.js (CI === 'true', flag wx, removes only its own file)"
  - "us_default_chapters: end-to-end rip with the shipped accurateChapters=false default"
affects:
  - "01-09: CI runs the sentinel on all three OSes; the observed bd_aacs reason is in the e2e report notes"
tech-stack:
  added: []
  patterns:
    - "Real-home sentinel guarded by CI === 'true', exclusive create, idempotent removal on loop end and process exit"
key-files:
  created: []
  modified:
    - test/e2e/run.js
    - test/e2e/scenarios.js
decisions:
  - "SPINARR_SENTINEL carries the planted file's path (still truthy) so the scenario can confirm the sentinel is really in place"
  - "The bd_aacs reason -1 (AACS files unreadable) is accepted with the sentinel: libaacs gives up on the fixture's random AACS files before looking for a key file, with or without KEYDB.cfg"
  - "The decisive hermetic signal is platform-level: aacs.keydb === false and every key/cache path under the test home"
requirements: [QUAL-02]
metrics:
  duration: "~20 min"
  completed: 2026-10-10
  tasks: 2
  files: 2
---

# Phase 1 Plan 08: Hermetic e2e proof and the accurateChapters=false rip Summary

e2e now proves no real AACS/dvdcss folder is in play. A CI-only sentinel plants a key file in the runner's real home and checks the app never sees it. A new scenario rips with the shipped chapter default.

## What was built

- **sec_hermetic_keydirs** (QUAL-02, every OS)
  - `SPINARR_TEST_HOME` is set, sits under the (realpath'd) temp dir, and is not the real home.
  - `platform.cssCache`, every `platform.keyDirs` value, and `system().aacs.keydbPath` are under it (`path.relative`, no `..`).
  - `system().aacs.keydb === false`.
  - With `SPINARR_SENTINEL` set: the sentinel file exists and is outside the test home. `h.load(bd_aacs)`. The banner never says "has no key that opens it", "no host certificate" or "revokes". It must be one of: no libaacs, no KEYDB.cfg (naming the test-home path), or AACS files unreadable. The reason is recorded with `h.note`.
- **run.js sentinel**
  - Only when `process.env.CI === 'true'`. It writes a `looksLikeKeydb`-valid KEYDB.cfg (comment, disc entry, `| PK |` line, all zero values) to the real AACS folder: macOS `~/Library/Preferences/aacs`, Linux `${XDG_CONFIG_HOME:-~/.config}/aacs`, Windows `%APPDATA%\aacs`.
  - `flag: 'wx'`, so it never overwrites. On EEXIST or any error it logs and leaves `SPINARR_SENTINEL` unset.
  - It removes only that file, after the loop and on `process.on('exit')`, and the removal is idempotent.
- **us_default_chapters** (QUAL-02, US-16, every OS)
  - `setup(env) { env.settings = { accurateChapters: false }; }`
  - Steps: assert the setting, `h.load(ntsc_basic.iso)`, reveal short titles if needed, select only title 1, then rip and idle.
  - Assertions: job `done`, exactly one `.mkv`, ffprobe shows 1 video stream, audio `['eng','spa']`, and 4 chapters within 0.6 s of 0/10/20/30.
  - Observed chapters: 0.00, 10.20, 19.80, 30.00 s.

## Verification

- Task 1: `node test/e2e/run.js sec_hermetic_keydirs us_bluray_encrypted` PASS. `SPINARR_NO_SANDBOX=1 ... sec_hermetic_keydirs` PASS.
- Task 2: `us_default_chapters` PASS in both modes.
- **CI sentinel exercised locally against a scratch HOME** (`CI=true HOME=<scratchpad>/fakehome`):
  - The file was planted, the scenario passed with the sentinel active, and the file was removed afterwards.
  - With a pre-existing `KEYDB.cfg` there, the sentinel logged `EEXIST`, did not plant, and left the file's contents (`keep`) untouched.
- **Positive control:** I temporarily planted the same file in the *test* home's aacs folder, and `aacs.keydb` flipped to `true`, so the scenario's check fails as it should. The bd_aacs reason stayed -1 with or without a key file, which is why -1 is accepted. The control was reverted and not committed.
- Rick's real `~/Library/Preferences/aacs/KEYDB.cfg` (it exists on this Mac) is unchanged: same mtime, size and sha1 before and after.
- `npm run test:unit`: 55/55 pass.
- Full `npm run test:e2e` (macOS, sandbox on): **32/32 passed**.
- Full `SPINARR_NO_SANDBOX=1 npm run test:e2e`: **32/32 passed**.
- Greps: `process.env.CI === 'true'` 1, `flag: 'wx'` 1 in run.js. `accurateChapters: false` is in the `us_default_chapters` setup.

## Deviations from Plan

**1. [Rule 1 - Bug] Accept the -1 "AACS files couldn't be read" reason in the sentinel branch**
- **Found during:** Task 1, the CI simulation.
- **Issue:** On a host with libaacs (this Mac has `/usr/local/lib/libaacs.0.dylib`), bd_aacs always gives -1. libaacs fails on the fixture's random Unit_Key_RO/MKB before it looks for a key file. The plan's "no-KEYDB / no-libaacs reasons only" assertion would have failed with no sentinel read at all.
- **Fix:** -1 is allowed alongside those two. Reasons that imply a key file was read are still rejected, and the platform-level `keydb === false` stays the decisive check.
- **Commit:** 6b2b846

**2. [Rule 2 - Hardening] SPINARR_SENTINEL carries the file path, not '1'**
- It is still truthy. The scenario uses it to assert that the sentinel really exists and lies outside the test home, so an active branch can't pass vacuously.
- **Commit:** 6b2b846

## Threat notes

- T-01-34 is mitigated as planned: the CI guard, exclusive create, and removal of only the created file. All three were verified against a scratch HOME.
- T-01-35 (Windows libaacs resolving config through SHGetFolderPath) is accepted. In e2e, libaacs.dll can only come from the tmp `userLib`, so Windows CI should report "libaacs not installed". 01-09 should read the note in the Windows e2e report.

## Notes for plan 01-09

- The CI workflows do not install libaacs, so on CI runners the sentinel branch should report "libaacs not installed". GitHub macOS images may have it via Homebrew; if so, expect -1. Either way the note in `test/reports/e2e.md` says which reason appeared.
- The sentinel needs `CI=true`, which GitHub Actions sets by default. No workflow change is needed.
- e2e count is now 32 scenarios.
- QUAL-02 is ticked here (hermetic + accurateChapters=false covered). Pending confirmation on CI in 01-09. SAFE-01 is left for 01-09.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: test/e2e/run.js, test/e2e/scenarios.js
- FOUND: 6b2b846 (Task 1), e8a67d6 (Task 2)
