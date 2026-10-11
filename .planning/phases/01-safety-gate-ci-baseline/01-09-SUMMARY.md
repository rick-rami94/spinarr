---
phase: 01-safety-gate-ci-baseline
plan: 09
subsystem: ci
tags: [ci, coverage, c8, windows, zizmor, sentinel, safe-01, qual-01, plat-01, rel-06, qual-02]
requires:
  - "01-03: ci.yml jobs macos/linux/windows/audit, coverage-linux artifact, pinned GyanD oracle"
  - "01-04: .c8rc.json with check-coverage and zero thresholds"
  - "01-07: SAFE-01 gate e2e scenarios"
  - "01-08: CI-only real-home KEYDB.cfg sentinel"
provides:
  - "Green CI on the PR head for macos, linux, windows, audit (run 38101336503)"
  - ".c8rc.json floors from the Linux baseline: lines 85, statements 85, functions 88, branches 91"
  - "Confirmed check-run names for branch protection (plan 01-10)"
affects:
  - "01-10: required contexts are exactly macos, linux, windows, audit"
tech-stack:
  added: []
  patterns:
    - "Coverage floor = Math.floor(Linux CI percentage), enforced on Linux only (D-13)"
key-files:
  created: []
  modified:
    - .c8rc.json
    - docs/SECURITY_TESTING.md
    - test/e2e/scenarios.js
decisions:
  - "c8 floors fixed at the Linux CI baseline: lines 85, statements 85, functions 88, branches 91 (run 38100209758)"
  - "Mid-rip skin scenarios wait up to 180s, not 90s, because slow macOS runners read at 0.5x. Thresholds and assertions are unchanged."
  - "GyanD 8.1.2 essentials is enough as the Windows reference ffmpeg (A7 resolved, no switch to full build)"
requirements: [QUAL-01, PLAT-01, REL-06, QUAL-02, SAFE-01]
metrics:
  duration: "~45 min"
  completed: 2026-10-10
  tasks: 2
  files: 3
---

# Phase 1 Plan 09: CI green on three OSes and the c8 Linux baseline Summary

CI on draft PR #2 is green for macos, linux, windows and audit. The full suite ran on Windows in under 9 minutes. The coverage floor is now set from the Linux run, and the check names are confirmed for branch protection.

## CI evidence

**Final green head:** `88ac97b`. CI run https://github.com/rick-rami94/spinarr/actions/runs/38101336503

| Job | Result | Duration |
|-----|--------|----------|
| audit | success | 22s |
| linux | success | 6m03s |
| macos | success | 8m52s |
| windows (needs linux) | success | 8m52s (well under 60 min) |

The release.yml build matrix on the same head (run 38101336529) also passed: macos-arm64, macos-x64, linux-x64, linux-arm64 and windows-x64. `release` was skipped because this is not a tag build.

**Windows steps (all success):** build engine (4m37s), `npm run test:unit`, independent ffmpeg oracle (pinned GyanD 8.1.2 essentials), `npm run test:security`, `npm run test:engine` (lossless oracle, 25s), and the end-to-end step (1m38s). Assumption A7 holds: the essentials build decodes everything the oracle needs.

**e2e pass counts:**

| OS | Result | Skipped (platform reason) |
|----|--------|---------------------------|
| macOS | 32/32 passed | none |
| Linux | 29/29 passed, 3 skipped | us_low_disk_space, us_mounted_image_and_eject, us_disc_removed_midrip (darwin only) |
| Windows | 27/27 passed, 5 skipped | the same three, plus sec_xss_folder_name and sec_xss_prompt (darwin/linux only) |

The SAFE-01 gate scenarios (gate_insert, gate_drop, gate_pick_iso, gate_pick_folder, sec_gate_ipc) passed on all three OSes.

**Sentinel (`sec_hermetic_keydirs`) notes, one per OS:**
- macOS: `sentinel active at /Users/runner/Library/Preferences/aacs/KEYDB.cfg; bd_aacs reason: libaacs not installed`
- Linux: `sentinel active at /home/runner/.config/aacs/KEYDB.cfg; bd_aacs reason: libaacs not installed`
- Windows: `sentinel active at C:\Users\runneradmin\AppData\Roaming\aacs\KEYDB.cfg; bd_aacs reason: libaacs not installed`

On every OS the sentinel was planted and later removed, and the app never saw it.

**Audit:** zizmor 1.30.1, including its online audits, reported "No findings to report" (1 ignored, 17 suppressed, all from earlier plans). The Electron-targeted check printed "No advisories affect electron." npm reports 8 moderate advisories in dev dependencies, none affecting electron.

## Coverage baseline (D-12, D-14)

Source: the Linux job text-summary from run 38100209758, the first run on the Phase 1 head. Run 38101336503 gave identical numbers.

| Metric | Linux CI | Floor (committed) |
|--------|----------|-------------------|
| Statements | 85.69% (605/706) | 85 |
| Branches | 91.42% (341/373) | 91 |
| Functions | 88.13% (52/59) | 88 |
| Lines | 85.69% (605/706) | 85 |

**Enforcement proven locally on macOS:**
- `npm run test:coverage` exits 1. macOS measures 84.84% lines and statements, under the Linux floor of 85; branches are 92.03% and functions 88.13%. This is expected: CI enforces coverage on Linux only (D-13), and the Linux job passed with the floors.
- `npx c8 check-coverage --lines 100` exits 1 with `ERROR: Coverage for lines (84.84%) does not meet global threshold (100%)`.

## Check-run names on the green head (for plan 01-10)

`gh api repos/rick-rami94/spinarr/commits/88ac97b.../check-runs`:
`["audit","linux","linux-arm64","linux-x64","macos","macos-arm64","macos-x64","release","windows","windows-x64"]`

ci.yml contributes exactly `macos`, `linux`, `windows`, `audit`. The others come from release.yml and are not meant to be required.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | a88b178 | fix(01-09): give the mid-rip skin scenarios headroom on slow macOS runners |
| 2 | 88ac97b | test(01-09): record c8 coverage baseline from Linux CI |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] e2e wait in the mid-rip skin scenarios had too little margin on macOS**
- **Found during:** Task 1 (first CI run, 38100209758)
- **Issue:** `ux_pinstripe_skin` timed out on the macOS runner. It had reached 29% at a 0.5x read rate when the 90s wait for `progress > 0.3` expired. Earlier green runs took 75 to 79s, and the green rerun took 89.8s, so the old timeout was a coin flip.
- **Fix:** The `waitFor` timeout for `ux_pinstripe_skin` and `ux_skins` went from 90s to 180s. That is still inside run.js's 240s per-scenario kill. The progress thresholds and every assertion are unchanged, so no check got weaker.
- **Files modified:** test/e2e/scenarios.js
- **Commit:** a88b178

Fix-and-push cycles used: 1 of 4.

## Notes for 01-10

- Require exactly `macos`, `linux`, `windows`, `audit`.
- The macOS e2e step is the slowest and the most timing-sensitive. Mid-rip scenarios now have 180s of headroom.
- In `npm audit`, 8 moderate dev-dependency advisories remain (glob@7 and others). They are not Electron advisories and do not fail the audit job.

## Self-Check: PASSED

- FOUND: .c8rc.json (lines 85, statements 85, functions 88, branches 91)
- FOUND: docs/SECURITY_TESTING.md SAFE-01 row ✅
- FOUND: a88b178, 88ac97b on origin/milestone/v1.0
- CI verify: `audit=SUCCESS,linux=SUCCESS,macos=SUCCESS,windows=SUCCESS`
