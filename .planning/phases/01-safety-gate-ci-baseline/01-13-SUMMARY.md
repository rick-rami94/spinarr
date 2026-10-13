---
phase: 01-safety-gate-ci-baseline
plan: 13
subsystem: security
tags: [safe-01, cr-01, wr-08, identity, gap-closure, tdd]
requires:
  - "01-11: lib.mediumIdentity, identityOf/scannedSame/assertScanGate wiring in app/main.js"
provides:
  - "lib.mediumIdentity fingerprints every directory libdvdread / libbluray / libaacs / libbdplus can open from a disc folder"
  - "lib.IDENTITY_TOO_MANY and lib.MAX_IDENTITY_ENTRIES (20000); the walk throws past the cap (fail closed)"
  - "scan() reports IDENTITY_TOO_MANY instead of 'Source not found'"
affects:
  - "Phase 1 re-verification of SAFE-01 truth #1"
  - "01-14: SECURITY.md wording for the accepted same-size, mtime-restored rewrite (T-01-44)"
tech-stack:
  added: []
  patterns:
    - "Per-kind walk spec (IDENTITY_WALK): DVD flat over the findDVDFile search dirs, Blu-ray recursive over BDMV/AACS/CERTIFICATE/BDSVM"
    - "Iterative queue walk, directories by inode only, files by ino|size|mtimeNs"
key-files:
  created: []
  modified:
    - app/lib.js
    - app/main.js
    - test/unit/lib.test.js
decisions:
  - "MAX_IDENTITY_ENTRIES = 20000 and exceeding it throws IDENTITY_TOO_MANY; identityOf maps the throw to null so probe/rip refuse with RESCAN_CHANGED"
  - "Dot-prefixed names ignored for both kinds; Thumbs.db/ehthumbs.db/desktop.ini ignored for DVD only (libbluray parses every non-dot PLAYLIST entry)"
  - "No memoization of mediumIdentity: every gate check re-walks; synthetic 5,000-file tree max 59.75 ms on a Mac mini 2018 (i5-8500B)"
requirements: [SAFE-01]
metrics:
  duration: "~6 min"
  completed: 2026-10-12
  tasks: 2
  files: 3
---

# Phase 1 Plan 13: Complete, fail-closed medium identity Summary

`lib.mediumIdentity` now fingerprints every file the disc parsers can open: the DVD source root, `video_ts`, `AUDIO_TS`, `DVD_RTAV`, and the whole of `BDMV/**`, `AACS/**`, `CERTIFICATE/**` and `BDSVM/**` for Blu-ray. It ignores only OS metadata that no parser can open. Past 20,000 entries it throws `IDENTITY_TOO_MANY`, where the old code just counted the extra entries.

## Tasks

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Failing unit tests for full coverage, junk tolerance, fail-closed cap (RED) | 6b7a285 | test/unit/lib.test.js |
| 2 | Complete, fail-closed mediumIdentity + scan() cap message (GREEN) | fa8805a | app/lib.js, app/main.js |

## RED evidence (Task 1, against the old app/lib.js)

10 of 50 tests failed. The 40 pre-existing tests, identity and non-identity, still passed.
- mediumIdentity: an entry that vanishes mid-walk is recorded, and more entries than the cap refuses instead of passing
- mediumIdentity: a root-level IFO added to a DVD folder changes identity (libdvdread searches the root first)
- mediumIdentity: files in video_ts, AUDIO_TS and DVD_RTAV change a DVD identity
- mediumIdentity: OS metadata files do not change a DVD identity
- mediumIdentity: a rewritten BDMV/BACKUP playlist, clip or index changes identity
- mediumIdentity: a same-size rewrite of a BACKUP playlist with a new mtime changes identity
- mediumIdentity: a rewritten AACS file changes identity
- mediumIdentity: a rewritten CERTIFICATE file changes identity
- mediumIdentity: META, JAR and BDSVM files added to a Blu-ray change identity
- mediumIdentity: OS metadata files do not change a Blu-ray identity

'desktop.ini in BDMV/PLAYLIST changes identity' passed on the old code too. That is expected: PLAYLIST was already walked. The test is there as a regression guard, so the WR-08 junk filter can never start excluding Windows names for Blu-ray.

## Verification

- `node --test test/unit/lib.test.js`: 50 pass, 0 fail.
- `npm run test:coverage`: exit 0. lib.js is at 99.76% lines and 97.88% branches, and the c8 floors are met.
- `node test/e2e/run.js sec_gate_swap sec_gate_ipc gate_pick_folder gate_insert us_bluray_rip`: 5/5 PASS.
- Acceptance greps: all met. The `memo|cache` grep in app/lib.js matches only the existing sandbox CSS/AACS cache paths. No identity cache exists. The app/main.js diff is the single scan() catch line, and `assertScanGate(` still appears 6 times.
- Independent repro, run against temp copies of the fixtures:
  ```
  DVD root VTS_01_0.IFO: dvd:f8d468fbe2ba7d21 -> dvd:12a545bd1c1634a3 CHANGED
  BDMV/BACKUP/PLAYLIST/00000.mpls (existed in fixture: true) bluray:b0bacc61deaea -> bluray:f03e05c94b10e CHANGED
  AACS/Unit_Key_RO.inf (existed in fixture: false) bluray:49c2f2e9a8078 -> bluray:9803062f58939 CHANGED
  ```
  The bd_movie fixture has no AACS/ directory. The repro created `AACS/Unit_Key_RO.inf` first, took the baseline identity, then rewrote the file.

## Timing (step C, no caching)

Machine: Mac mini 2018 (Macmini8,1), Intel Core i5-8500B @ 3.00 GHz, internal SSD (APFS), Node v24.12.0. Each case had one warm-up and then 20 timed calls with `process.hrtime.bigint()`.

| Tree | Median (ms) | Max (ms) | Budget |
|------|-------------|----------|--------|
| Temp copy of test/fixtures/out/bd_movie | 1.24 | 3.96 | n/a |
| Synthetic Blu-ray, 5,000 files (PLAYLIST, CLIPINF, STREAM, BACKUP/PLAYLIST, BACKUP/CLIPINF x 1,000) | 50.32 | 59.75 | max <= 250 ms: PASS |

The timing script lived in the session scratchpad and was not committed. Both temp trees were deleted afterwards.

## Deviations from Plan

None. The plan was executed as written.

## Known Stubs

None.

## Open items

- **Manual Intel-Mac real-drive pass:** time `mediumIdentity` on a real mounted DVD and a real mounted Blu-ray, cold and warm, with the sandbox off. Confirm that the five gate checks per rip add acceptable latency on optical media. If they don't, make the walk cheaper. Do not add caching that skips the pre-spawn re-walk.
- SAFE-01 stays unchecked in REQUIREMENTS.md until the phase verifier re-verifies it.
- On case-insensitive filesystems (APFS, NTFS), `VIDEO_TS` and `video_ts` resolve to the same directory, so that directory is walked twice. This costs a little time but is correct.

## Self-Check: PASSED

- FOUND: app/lib.js, app/main.js, test/unit/lib.test.js
- FOUND: 6b7a285, fa8805a
