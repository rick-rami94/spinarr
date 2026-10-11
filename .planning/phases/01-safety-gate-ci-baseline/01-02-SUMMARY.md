---
phase: 01-safety-gate-ci-baseline
plan: 02
subsystem: main-process IPC / safety gate
tags: [safety, ipc, sandbox, testing-hooks]
requires: []
provides:
  - lib.validateScanOptions, lib.scanGate, lib.SANDBOX_OFF
  - main sandboxTrusted() single trust signal
  - system IPC returns sandboxTrusted
  - SPINARR_TEST_HOME hermetic hook (unpackaged only)
  - test hook receives { queue, platform }
affects:
  - app/renderer (plan 01-06 must pass { userConfirmed: true } on consent and drop the dvdcss-page action)
  - e2e plans 01-07 / 01-08 (can use SPINARR_TEST_HOME and platform in the hook)
tech-stack:
  added: []
  patterns: [pure gate logic in lib.js, enforcement in main IPC handlers, fail-closed strict === true flags]
key-files:
  created: []
  modified:
    - app/lib.js
    - test/unit/lib.test.js
    - app/main.js
    - app/preload.js
    - test/e2e/scenarios.js
decisions:
  - "systemInfo() helper overrides `sandbox` to 'none' when sandboxTrusted() is false, so Settings reports the effective state (e.g. under SPINARR_NO_SANDBOX)"
  - "probe/rip gating applies only while untrusted in this phase; SAFE-11 (Phase 3) makes it universal"
metrics:
  duration: ~15 min
  completed: 2026-10-10
  tasks: 2
  files: 5
---

# Phase 01 Plan 02: Main-process scan gate Summary

Main now refuses an unsandboxed scan without per-call `{ userConfirmed: true }`. It also refuses unsandboxed probe or rip of a source that hasn't been scanned. The trust check is one function, `sandboxTrusted()`, and the gate logic lives in `lib.scanGate`, which is pure and unit-tested. The plan also adds the `SPINARR_TEST_HOME` hermetic hook and removes the `open-dvdcss-page` `shell.openExternal` sink.

## What was built

**Task 1 (TDD): gate logic in `app/lib.js`**
- `SANDBOX_OFF = 'SANDBOX_OFF'`: a stable error-code prefix the renderer can match on.
- `validateScanOptions(o)`: null or undefined gives `{ userConfirmed: false }`. Anything that is not an object, or is an array, throws `Invalid scan options`. Otherwise it returns exactly `{ userConfirmed: o.userConfirmed === true }`.
- `scanGate({ trusted, userConfirmed } = {})`: returns null only when one of the two is literally `true`. Otherwise it returns `SANDBOX_OFF: The engine sandbox is off on this system, so Spinarr won't read a disc until you choose Scan anyway.` Non-boolean inputs fail closed.
- Unit truth-table tests `validateScanOptions` and `scanGate` cover everything in the plan's behavior list, plus `scanGate(undefined)`.

**Task 2: enforcement in `app/main.js`**
- `function sandboxTrusted() { return !NO_SANDBOX && platform.sandboxKind !== 'none'; }` sits right after `NO_SANDBOX`.
- `handle('scan', (source, opts))` runs `validateSource`, then `validateScanOptions`, then `scanGate`, and throws if refused. It never consults `scans` (D-03).
- `handle('probe')` throws `Scan the disc first` when untrusted and the source is not in `scans`.
- In `enqueue()`, each job throws `Scan the disc again before ripping` when untrusted and its source is unscanned. The batch stays all-or-nothing.
- A `systemInfo()` helper returns `{ ...platform.info(), sandbox, sandboxTrusted }`. The `system`, `install-dvdcss` and `install-keydb` handlers all use it.
- `SPINARR_TEST_HOME` is read only when `!app.isPackaged`. It blanks `XDG_CONFIG_HOME`/`XDG_CACHE_HOME`, roots `APPDATA`/`LOCALAPPDATA` in the test home, and passes `home` to `createPlatform`.
- The `open-dvdcss-page` handler is deleted. `shell` stays imported because `reveal` uses it.
- The test hook is now called with `{ queue, platform }`.
- `app/preload.js` no longer has `openDvdcssPage`. The bridge-key list in `sec_renderer_isolation` is updated to match.

## Verification

- `npm run test:unit`: 47 pass, 0 fail. This includes `validateScanOptions` and `scanGate`.
- Acceptance one-liner prints `SANDBOX_OFF true null {"userConfirmed":false}`.
- `grep -c "require('electron')" app/lib.js` gives 0.
- Every acceptance grep passes: no `open-dvdcss-page` or `openDvdcssPage`, exactly one `sandboxTrusted` function after `NO_SANDBOX`, one call each to `lib.scanGate(` and `lib.validateScanOptions(`, two `scans.has(` (probe and enqueue, none in scan), `SPINARR_TEST_HOME` guarded by `!app.isPackaged`, one `{ queue, platform }`, and `shell` count 2.
- macOS e2e: `node test/e2e/run.js sec_renderer_isolation sec_ipc_validation us_settings_persist` gives 3/3 PASS.

## Deviations from Plan

None in the source changes. They follow the plan as written.

Environment note, not a code change: the worktree had no `node_modules/`, `engine/bin/` or `test/fixtures/out/`, all of which are gitignored. To run e2e I temporarily symlinked them from the main checkout and removed the links afterwards. Nothing was installed. The first e2e run without fixtures failed with `Source not found`; with fixtures linked, all three scenarios passed.

## Known Stubs / Follow-ups

- `app/renderer/app.js:576` still calls `spinarr.openDvdcssPage()` for the `dvdcss-page` action, and line 393 still renders the "Open VideoLAN download" button (Windows only). With the bridge entry gone, clicking it throws a TypeError in the renderer and does nothing else. Plan 01-06 owns the renderer and removes this.
- The renderer does not yet pass `{ userConfirmed: true }` and does not handle the `SANDBOX_OFF:` error. Until plan 01-06 lands, an untrusted system (Linux without bwrap, Windows, or `SPINARR_NO_SANDBOX=1`) cannot scan from the UI. That is the intended fail-closed state.

## Threat Flags

None. No new surface; this plan removes one (`shell.openExternal` sink).

## TDD Gate Compliance

RED `1377cc8` (test) is followed by GREEN `f75e8ad` (feat). No refactor commit was needed.

## Commits

- `1377cc8` test(01-02): add failing tests for scan gate truth table
- `f75e8ad` feat(01-02): add scan gate logic to lib (validateScanOptions, scanGate, SANDBOX_OFF)
- `86bec38` feat(01-02): enforce scan gate in main, add SPINARR_TEST_HOME, drop dvdcss-page sink

## Self-Check: PASSED

- All five modified files exist and are committed.
- Commits 1377cc8, f75e8ad and 86bec38 are present in `git log`.
