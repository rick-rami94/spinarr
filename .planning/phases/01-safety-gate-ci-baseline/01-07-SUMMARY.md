---
phase: 01-safety-gate-ci-baseline
plan: 07
subsystem: e2e
tags: [safety, scan-gate, e2e, harness, hermetic, xss]
requires:
  - "01-02: SPINARR_TEST_HOME hook, main SANDBOX_OFF refusal, probe/rip refusal of unscanned sources"
  - "01-06: requestScan chokepoint, Scan this disc? prompt, onDrives shared boot/insert path"
provides:
  - "Prompt-aware harness: h.load goes through requestScan and clicks the real Scan anyway button; h.consent()"
  - "Entry-point drivers: h.fakeInsert, h.fakeEject, h.dropFile (CDP drag), h.stubDialog"
  - "SPINARR_TEST_HOME per e2e scenario (env.home under the scenario tmp dir)"
  - "Scenarios gate_insert, gate_drop, gate_pick_iso, gate_pick_folder, sec_gate_ipc, sec_xss_prompt"
affects:
  - "01-08: can assert the hermetic home (env.home is <tmp>/home)"
  - "01-09: Windows CI e2e works through the prompt path with no harness changes"
tech-stack:
  added: []
  patterns:
    - "Real OS-level drop via webContents.debugger Input.dispatchDragEvent (no renderer test hook)"
    - "Picker stub by patching the shared electron dialog object from the main-process harness"
key-files:
  created: []
  modified:
    - test/e2e/harness.js
    - test/e2e/run.js
    - test/e2e/scenarios.js
decisions:
  - "Drop uses CDP Input.dispatchDragEvent (RESEARCH A2 held); no onDropPath fallback in app.js"
  - "Picker uses dialog.showOpenDialog stubbing (RESEARCH A1 held); no SPINARR_TEST_PICK hook in main.js"
  - "Gate scenarios run on every OS (no platforms key) except sec_xss_prompt (darwin/linux, Windows forbids < > \" in names)"
requirements: [SAFE-01, QUAL-02]
metrics:
  duration: "~12 min"
  completed: 2026-10-10
  tasks: 2
  files: 3
---

# Phase 1 Plan 07: SAFE-01 end-to-end gate scenarios and a prompt-aware, hermetic harness Summary

Every scan entry point is now proven gated in the real app with the sandbox off. The harness clicks the real "Scan anyway" button. Every e2e launch gets its own home folder.

## What was built

- **harness.js**
  - `consent()`: clicks `[data-action="scan-anyway"]` if a prompt is up, then waits for the scan. Does nothing when trusted.
  - `load(src)`: `requestScan(src)`, wait for prompt/scan/disc/error, then `consent()`. No `loadSource` and no `userConfirmed` in the harness.
  - `fakeInsert(name, p, media)` / `fakeEject()`: send `drives-changed` from main.
  - `dropFile(p)`: attaches the debugger (protocol 1.3) and dispatches `dragEnter`, `dragOver`, `drop` with `data.files: [p]` at the window centre. The renderer's real drop listener and `pathForFile` run.
  - `stubDialog(paths)`: replaces `dialog.showOpenDialog` on the shared electron `dialog` object. main.js's destructured `dialog` is the same object, so the stub applies.
- **run.js**: `env.home = <tmp>/home` per scenario, passed as `SPINARR_TEST_HOME` before the per-scenario env spread. The `accurateChapters: true` default is kept.
- **scenarios.js**
  - `expectPrompt(h, src)`: pending prompt, 1.5 s settle, then checks `disc === null`, `scanning === false`, that the Scan anyway button exists, /sandbox is off/, and the base name.
  - `expectScanAfterClick(h)`: clicks, waits for titles, checks consent was single use.
  - `gate_insert`, `gate_drop`, `gate_pick_iso`, `gate_pick_folder` (folder picker also covers "Not now"): prompt, click and scan, then a fresh prompt for the same source.
  - `sec_gate_ipc`: `system()` reports `sandboxTrusted: false`, `sandbox: 'none'`. `scan(src)`, `{ userConfirmed: 'true' }`, `{ userConfirmed: 1 }` and `{}` are refused with SANDBOX_OFF. `'x'` is refused as "Invalid scan options". Probe and rip of an unscanned source are refused and the queue stays empty. After `h.load` (the real button), probe works.
  - `sec_xss_prompt`: the `<svg onload>` folder and `xss_label.iso` both render in the prompt with no injected elements, `window.__xss` stays undefined, and the name shows literally.
  - Existing scenarios: `sec_ipc_validation` calls `h.load(src)` before the traversal rip. `us_mounted_image_and_eject` and `us_disc_removed_midrip` call `h.consent()` after their `[data-src]` click.

## Technique record (per plan output spec)

- **Drop:** CDP `Input.dispatchDragEvent`. It worked first try, so the `onDropPath` fallback was not needed and app.js is unchanged.
- **Picker:** `dialog.showOpenDialog` stub from the harness. It worked, so the `SPINARR_TEST_PICK` fallback was not needed and main.js is unchanged.

## Verification

- Task 1 verify: `sec_renderer_isolation sec_ipc_validation us_scan_and_filter` 3/3 PASS. `SPINARR_NO_SANDBOX=1 us_scan_and_filter us_track_selection` 2/2 PASS.
- Task 2 verify: the 8 named scenarios 8/8 PASS on macOS (trusted run; the gate scenarios set NO_SANDBOX themselves).
- `npm run test:unit`: 55/55 pass. gate-static only scans app.js, which is unchanged.
- Full `npm run test:e2e` (macOS, sandbox on): **30/30 passed**.
- Full `SPINARR_NO_SANDBOX=1 npm run test:e2e` (Windows proxy): **30/30 passed**. No scenarios skipped, no gate bypass.
- Greps: gate_* definitions = 4, `SPINARR_NO_SANDBOX: '1'` = 6, SANDBOX_OFF = 1, harness `loadSource(` = 0, `userConfirmed` = 0, run.js SPINARR_TEST_HOME = 1.

## Deviations from Plan

None. The plan was executed as written, and neither fallback was needed.

## Notes for plan 01-08

- `env.home` is `path.join(tmp, 'home')` and is created before launch. A hermeticity check can look there, or assert that main's platform dirs resolve under it.
- The hermetic home did not break any scenario on macOS (Blu-ray encrypted/KEYDB scenarios included).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: test/e2e/harness.js, test/e2e/run.js, test/e2e/scenarios.js
- FOUND: 3bd1c84 (Task 1), 9fba5d3 (Task 2)
