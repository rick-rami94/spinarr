---
phase: 01-safety-gate-ci-baseline
plan: 11
subsystem: security
tags: [safe-01, cr-01, wr-08, consent, medium-identity, gap-closure]
requires:
  - "01-03/01-04: scanGate, SANDBOX_OFF, per-scan consent in handle('scan')"
provides:
  - "lib.mediumIdentity(source, { stat, readdir }): filesystem identity of an ISO (dev/ino/size/mtimeNs/birthtimeNs) or DVD/Blu-ray folder (sha256 over root dev/ino and tracked subfolder entries), capped at MAX_IDENTITY_ENTRIES = 5000"
  - "lib.RESCAN_NOT_SCANNED and lib.RESCAN_CHANGED shared refusal strings (both start with 'Scan the disc again')"
  - "main.js: scans entries carry the identity captured before and after readInfo; a disc that changes mid-scan is not recorded"
  - "main.js: assertScanGate(src) at probe, enqueue, top of pump, top of prepareBluray, and immediately before the ffmpeg spawn in start"
  - "main.js: revalidateScans() on every platform.watch callback drops entries whose medium vanished or changed"
affects:
  - "01-12: adds the swap-at-same-path e2e regression scenario and SECURITY.md residual-risk note"
  - "Phase 3: disc-ID scan catalog replaces/extends filesystem identity"
tech-stack:
  added: []
  patterns:
    - "Consent bound to medium identity, re-checked at every engine spawn site when the sandbox is off"
    - "BigInt stat (bigint: true) so Windows 64-bit file IDs and volume serials compare exactly"
key-files:
  created: []
  modified:
    - app/lib.js
    - test/unit/lib.test.js
    - app/main.js
decisions:
  - "Identity excludes atime and ctime, so plain reads and macOS xattr writes do not force rescans"
  - "scan() always computes identity (trusted or not); probe/rip gates skip identity entirely when sandboxTrusted()"
  - "revalidateScans runs regardless of sandboxTrusted(), since a stale scan of a swapped disc is wrong either way"
requirements: [SAFE-01]
metrics:
  duration: "~6 min"
  completed: 2026-10-12
  tasks: 2
  files: 3
---

# Phase 1 Plan 11: Medium-identity scan consent (CR-01 / WR-08) Summary

Scan consent now covers the medium as it was scanned, not just its path. With the sandbox off, a swapped, overwritten, ejected or replaced disc is refused with "Scan the disc again" at every point an engine process could be spawned against it.

## What was built

**Task 1 (TDD): `lib.mediumIdentity` plus the rescan messages.**
- ISO/IMG files: `file:` + dev, ino, size, mtimeNs and birthtimeNs from a bigint stat.
- Folders: `dvd:` or `bluray:` + a sha256 over `root|dev|ino` and, for each tracked subfolder (`VIDEO_TS`, or `BDMV`, `BDMV/PLAYLIST`, `BDMV/CLIPINF`, `BDMV/STREAM`), every sorted entry's ino, size and mtimeNs. Missing subfolders record `rel|missing`. Entries that vanish mid-walk record `rel/name|gone`. After 5000 stats a `+N` line counts the rest, so added or removed names still change the result.
- The function throws when the source is gone, and throws `Source changed` when a folder no longer has VIDEO_TS or BDMV.
- 8 new unit tests cover: stable ISO, in-place overwrite, rename-replace with the same size and mtime, DVD folder grow and recreate, Blu-ray playlist change with no CLIPINF, device change (drive-letter reuse simulated with an injected stat), removal, mid-walk vanish, and the entry cap.

**Task 2: main.js gating.**
- `scan()` captures identity before the first readInfo and again after the JSON is read. If they differ, it throws `The disc changed while it was being scanned. Scan it again.` and stores nothing. The entry is stored as `{ ...result, identity }` and `result` alone goes back to the renderer.
- `scannedSame(src)` returns the entry only when the identity still matches. Otherwise it deletes the entry and returns null.
- `assertScanGate(src)` is a no-op when the sandbox is trusted. Otherwise it throws RESCAN_NOT_SCANNED (never scanned) or RESCAN_CHANGED (changed).
- The gate is called in: handle('probe'), enqueue, the top of pump (fails the job), the first line of prepareBluray before its ffprobe, and start() right before spawn (fails the job and removes the chapters file).
- `revalidateScans()` runs first in the watchVolumes callback.
- The old `'Scan the disc first'` string is gone. scannedTitle now uses lib.RESCAN_NOT_SCANNED.

## Verification

- `node --test test/unit/lib.test.js`: 40 pass, 0 fail (8 new mediumIdentity tests). `npm run test:unit`: 63 pass.
- `npm run test:coverage`: exit 0 (statements 85.59, branches 92.4, functions 88.7, lines 85.59; floor 85/91/88/85).
- Fixture check: `ntsc_basic.iso` gives a stable `file:` identity, `ntsc_basic` gives `dvd:`, and `bd_movie` gives `bluray:`.
- e2e: sec_gate_ipc, gate_insert, gate_drop, gate_pick_iso, gate_pick_folder and sec_ipc_validation all passed (6/6).
- e2e with `SPINARR_NO_SANDBOX=1`: us_scan_and_filter, us_track_selection, us_queue_progress_cancel and us_bluray_rip all passed (4/4).
- Grep acceptance: 6 `assertScanGate(` occurrences. prepareBluray calls the gate on the line before probeStreams. `scans.has(src)` appears only inside assertScanGate. 0 `Scan the disc first`. `revalidateScans()` is called inside platform.watch. Two `mediumIdentity(source)` calls in scan().

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | d23472c | test(01-11): add failing tests for lib.mediumIdentity |
| 1 (GREEN) | 39bbe5c | feat(01-11): add lib.mediumIdentity and shared rescan messages |
| 2 | 7a37f53 | fix(01-11): bind scan consent to medium identity and gate every engine spawn |

## TDD Gate Compliance

RED (d23472c, 8 failing tests) came before GREEN (39bbe5c). No refactor was needed.

## Deviations from Plan

- **Minor implementation detail:** main.js has a small `identityOf(src)` helper (mediumIdentity inside try/catch, returning null) used by scannedSame. scan() calls `lib.mediumIdentity(source)` inline twice, as the plan's grep acceptance asks. Behavior is unchanged from the plan.
- **Extra unit test:** one test beyond the listed cases covers the mid-walk `gone` branch and the MAX_IDENTITY_ENTRIES cap, so the coverage floor holds and the T-01-36 mitigation is tested.

Otherwise the plan was executed as written.

## Known Stubs

None.

## Threat Flags

None. No new surface; this plan narrows existing consent (T-01-31, T-01-32, T-01-33 and T-01-36 are mitigated as planned; T-01-34 and T-01-35 are accepted as planned).

## Self-Check: PASSED

- FOUND: app/lib.js, app/main.js, test/unit/lib.test.js
- FOUND commits: d23472c, 39bbe5c, 7a37f53
