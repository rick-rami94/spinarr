---
phase: 01-safety-gate-ci-baseline
plan: 15
subsystem: security
tags: [safe-01, cr-01, in-07, wr-08, wr-10, wr-11, sf-1, gap-closure, tdd]
requires:
  - "01-13: lib.mediumIdentity full-coverage walk, IDENTITY_TOO_MANY cap"
  - "01-14: sec_gate_inplace conventions, SECURITY.md same-disc wording"
provides:
  - "Fail-closed mediumIdentity walk: only ENOENT/ENOTDIR mean absent; every other readdir/stat error throws lib.IDENTITY_UNREADABLE"
  - "lib.identityRefusal(err): 'Scan the disc again. <reason>' for IDENTITY_TOO_MANY / IDENTITY_UNREADABLE, else RESCAN_CHANGED"
  - "scan() and assertScanGate pass the real reason through (IN-07)"
  - "sec_gate_unlistable e2e (macOS/Linux, skipped as root)"
  - "SECURITY.md: same-disc check is best-effort, not a sandbox; three residuals; SF-1 closes them"
affects:
  - "Phase 1 re-verification of SAFE-01 truth #1"
  - "Phase 4 / SAFE-05 now formally carries the SAFE-01 residual"
tech-stack:
  added: []
  patterns:
    - "Error-code allow-list for 'absent' (ENOENT/ENOTDIR); everything else fails closed"
    - "Real chmod 0o311 unit tests, skipped on win32 and uid 0, mode restored in finally before rmSync"
key-files:
  created: []
  modified:
    - app/lib.js
    - app/main.js
    - test/unit/lib.test.js
    - test/e2e/scenarios.js
    - SECURITY.md
    - docs/SECURITY_TESTING.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/phases/01-safety-gate-ci-baseline/01-VALIDATION.md
decisions:
  - "IDENTITY_UNREADABLE wording: \"Spinarr can't read every folder on this disc, so it can't check it safely.\""
  - "sec_gate_unlistable rips before probing: the first refusal drops the scan, so only it can carry the specific reason"
  - "SAFE-01 stays [ ]; traceability 'In Progress (traverse-only bypass fixed in 01-15; residual documented and scoped to SF-1 / SAFE-05; awaiting re-verification)'"
requirements: [SAFE-01]
metrics:
  duration: "~10 min"
  completed: 2026-10-12
  tasks: 3
  files: 9
---

# Phase 1 Plan 15: Fail closed on unreadable disc folders, SF-1 residual documented Summary

A traverse-only BDMV (mode 0311) no longer freezes the Blu-ray fingerprint. `mediumIdentity` now treats only ENOENT/ENOTDIR as "absent". Any other readdir or stat error (EACCES, EPERM, EIO, ELOOP, no code) throws `IDENTITY_UNREADABLE`, so `identityOf` returns null and probe/rip refuse. Refusals name the real reason. SECURITY.md now calls the same-disc check a best-effort guard, not a sandbox, and hands the three residuals to SF-1.

## Tasks

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | Failing tests for the fail-closed walk | 7e5101c | test/unit/lib.test.js |
| 1 (GREEN) | Fail-closed walk, identityRefusal, reason pass-through | 2faa9a4 | app/lib.js, app/main.js |
| 2 | sec_gate_unlistable e2e + truthful SECURITY.md | 507e17a | test/e2e/scenarios.js, SECURITY.md, docs/SECURITY_TESTING.md |
| 3 | SF-1 traceability + validation row | b80f661 | .planning/REQUIREMENTS.md, .planning/ROADMAP.md, 01-VALIDATION.md |

## RED evidence (pre-fix app/lib.js)

`node --test test/unit/lib.test.js` with the new tests against the unmodified lib.js: **56 tests, 51 pass, 5 fail, 0 skipped.**

Failing:
1. `mediumIdentity: a traverse-only BDMV (mode 0o311) throws IDENTITY_UNREADABLE instead of freezing the identity` (ran for real on macOS, not skipped)
2. `mediumIdentity: a traverse-only BDMV/PLAYLIST (mode 0o311) throws IDENTITY_UNREADABLE` (ran for real)
3. `mediumIdentity: readdir errors other than ENOENT/ENOTDIR on a walked directory throw IDENTITY_UNREADABLE` (EACCES on BDMV returned an identity)
4. `mediumIdentity: stat errors other than ENOENT/ENOTDIR on an entry or a Blu-ray top folder throw IDENTITY_UNREADABLE`
5. `identityRefusal names the real reason and always starts with "Scan the disc again"` (undefined export)

The optional-directories test (Test E) passed before and after, as expected: it guards against over-correcting.

e2e: with the pre-fix lib.js/main.js swapped in temporarily, `sec_gate_unlistable` FAILS (at "the refusal names the real reason"). Both files were restored with `git checkout --` and `git diff --exit-code app/lib.js app/main.js` was clean; no reverted state was committed. Note: with the chmod done *after* the scan, the pre-fix code already refused (the identity changed from a full listing to `BDMV|missing`), so the scenario's second half covers the actual 01-VERIFICATION repro: BDMV made traverse-only *before* the scan. The scan must now refuse with the reason, and a later probe of the edited tree is refused.

## Verification results

- Fast: `node --test test/unit/lib.test.js`: 56/56 pass, 0 skipped (chmod tests ran).
- `npm run test:unit`: 79/79. `npm run test:security`: 74/74.
- Full: `npm run test:coverage`: 191/191 pass, exit 0. All files 87.06% lines / 93.01% branches / 89.39% functions (floor 85/91/88). lib.js 99.77% lines, 98% branches, 100% functions.
- e2e: `node test/e2e/run.js sec_gate_unlistable sec_gate_inplace sec_gate_swap sec_gate_ipc gate_insert gate_drop gate_pick_iso gate_pick_folder us_bluray_rip`: **9/9 PASS, no SKIP** (us_bluray_rip proves a normal Blu-ray rip is unaffected).
- No 0311 temp directories left behind (`find $TMPDIR ... -perm 311` empty).
- Acceptance greps: no `catch { lines.push` in lib.js; `0o311` x2+, `getuid`, `win32` in lib.test.js; "not a sandbox", "SF-1", "never remembers the answer", security contact email present in SECURITY.md; "No disc reader opens them", "everything under BDMV", "more than 20,000 files" absent; "SAFE-01 residual" in REQUIREMENTS.md and ROADMAP.md; SAFE-01 still `[ ]`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in test design] e2e reason assertion order**
- **Found during:** Task 2
- **Issue:** The plan had probe then rip, asserting the reason on rip. The first refusal deletes the scan entry, so rip got `RESCAN_NOT_SCANNED` with no reason.
- **Fix:** Rip first (asserts the reason), then probe (asserts the rescan prefix). No product change: dropping the scan on mismatch is the intended behaviour.
- **Commit:** 507e17a

**2. [Rule 2 - Missing coverage] e2e covers the real bypass shape**
- **Found during:** Task 2
- **Issue:** chmod after a consented scan was already refused by the pre-fix code, so it alone would not catch a regression of the round-3 bypass.
- **Fix:** Added a second half to `sec_gate_unlistable`: BDMV traverse-only before the scan -> scan refused with the IDENTITY_UNREADABLE text, then an edit + probe is refused. SECURITY_TESTING.md row mentions both.
- **Commit:** 507e17a

**3. [Rule 2] Extra unit cases**
- Test C also covers BDMV/PLAYLIST, the DVD root `''`, and an error with no `.code`; Test D also covers EIO, EPERM and ENOTDIR (as "gone"). No production impact.

## Threat model

T-01-49 (fail-closed walk) and T-01-50 (reason in refusals) mitigated as planned. T-01-51/52/44 accepted and transferred to SF-1 (SAFE-05 note, ROADMAP Phase 4 "Carries" line, SECURITY.md known-limit block). No new surface introduced.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: app/lib.js (IDENTITY_UNREADABLE, identityRefusal), app/main.js (identityRefusal), test/unit/lib.test.js, test/e2e/scenarios.js (sec_gate_unlistable), SECURITY.md, docs/SECURITY_TESTING.md
- FOUND commits: 7e5101c, 2faa9a4, 507e17a, b80f661

## State bookkeeping corrections

The GSD SDK wrote stale or premature values, fixed by hand:
- `state.advance-plan` set "Plan: 2 of 15" / "Ready to execute" (it read the orchestrator's "1 of 15"). Set to "Plan: 15 of 15", "All plans complete; awaiting Phase 1 re-verification".
- `state.update-progress` set `completed_phases: 1` and `percent: 13`. Reverted to 0 / 0: Phase 1 is not verified.
- `roadmap.update-plan-progress` ticked the Phase 1 top-level line "(completed 2026-10-12)" and set the row to "Complete". Reverted to `- [ ]` and "15/15 | Awaiting re-verification". Only 01-15 is ticked.
- `requirements.mark-complete` was not run; SAFE-01 stays `[ ]`.
