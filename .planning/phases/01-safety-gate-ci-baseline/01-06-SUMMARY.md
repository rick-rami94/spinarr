---
phase: 01-safety-gate-ci-baseline
plan: 06
subsystem: renderer
tags: [safety, scan-gate, consent, legal, neutrality, static-tests]
requires:
  - "01-02: main scan handler refuses unconsented scans with SANDBOX_OFF; system() exposes sandboxTrusted"
  - "01-05: platform.dvdcss() has no url"
provides:
  - "requestScan(src): the single renderer scan chokepoint"
  - "confirmScan(): the only sender of { userConfirmed: true }, single-use"
  - "state.pendingScan and the 'Scan this disc?' prompt (data-action scan-anyway / scan-cancel)"
  - "onDrives(drives, { boot }): shared boot + insert path"
  - "test/unit/gate-static.test.js and test/unit/neutrality.test.js guards"
affects:
  - "test/e2e scenarios that scan with SPINARR_NO_SANDBOX=1 must click [data-action=\"scan-anyway\"] (plan 01-07)"
tech-stack:
  added: []
  patterns:
    - "Static source guards: brace-counted function bodies pin call sites of security-critical calls"
    - "Fail closed on unknown system info: sandboxTrusted() is false until system() resolves"
key-files:
  created:
    - test/unit/gate-static.test.js
    - test/unit/neutrality.test.js
  modified:
    - app/renderer/app.js
    - app/renderer/styles.css
decisions:
  - "A SANDBOX_OFF refusal from main also sets state.system.sandboxTrusted = false before re-prompting, so a stale trusted flag cannot loop loadSource -> refuse -> loadSource"
  - "Ejecting the source on screen also clears pendingScan"
  - "One scoped CSS rule (.error-box span b inline) keeps the disc name inline in the prompt"
requirements: [SAFE-01, REL-08]
metrics:
  duration: "~6 min"
  completed: 2026-10-10
  tasks: 2
  files: 4
---

# Phase 1 Plan 06: Renderer scan chokepoint, consent prompt and neutral DLL copy Summary

Every renderer scan now goes through `requestScan`. With the engine sandbox off, it shows a "Scan this disc?" prompt instead of scanning. Only the "Scan anyway" click sends `{ userConfirmed: true }`, once. The Windows libdvdcss copy is neutral. Two static unit guards pin all of this.

## What was built

- **`requestScan(src)`** (synchronous). Trusted sandbox: calls `loadSource`. Otherwise it sets `pendingScan`, clears the disc view and renders the prompt with no await first.
- **`confirmScan()`**. Takes `pendingScan`, clears it (D-03 single use), then `loadSource(src, { userConfirmed: true })`.
- **`loadSource(src, opts)`**. Clears `pendingScan` and passes `opts` to `spinarr.scan`. On a `SANDBOX_OFF` refusal for the current source it re-prompts.
- **Prompt**: `role="alertdialog"`. It explains that the sandbox is off and the parsers run with full user permissions. The disc name goes through `esc(baseName(...))`. Buttons: "Scan anyway" and "Not now".
- **Entry points rerouted**: picker, sidebar `[data-src]`, KEYDB re-scan, drop, drives-changed and boot. Boot and insert share `onDrives(drives, { boot })`.
- **D-19**: the Windows copy now reads "Spinarr can use libdvdcss-2.dll (64-bit) if you have it. Choose it here." The only button left is "Choose DLL…". The `dvdcss-page` case and its call to `openDvdcssPage` are gone.
- **gate-static.test.js** checks these call sites:
  - `spinarr.scan(` appears once, inside `loadSource`.
  - `loadSource(` is only called from `requestScan` or `confirmScan`.
  - `userConfirmed: true` appears once, inside `confirmScan`.
  - `confirmScan(` has one call site, `case 'scan-anyway'`.
  - `requestScan(` has at least 6 call sites (there are 6).
  - `openDvdcssPage` and `dvdcss-page` do not appear.
- **neutrality.test.js** runs `git ls-files README.md SECURITY.md CLAUDE.md docs app .github` and fails, naming the file and the matched text, on any libdvdcss link or VideoLAN download/dll mention.

## Verification

- **RED (Task 1)**: 6 failures against the old app.js:
  - "requestScan must exist"
  - "userConfirmed: true must appear exactly once"
  - "confirmScan must be called exactly once"
  - "expected at least 6 requestScan call sites, found 0"
  - the dvdcss-page assertion
  - neutrality failing on `app/renderer/app.js: Download <b>libdvdcss-2.dll</b> (64-bit) from VideoLAN`
- **GREEN**: `npm run test:unit` gives 55/55 passing.
- **Greps**: VideoLAN = 0, dvdcss-page = 0, scan-anyway = 1, scan-cancel = 1. `esc(baseName(state.pendingScan))` appears on one line.
- **macOS trusted e2e**: `sec_renderer_isolation`, `sec_xss_volume_label` and `us_mounted_image_and_eject` gave 3/3 PASS.
- **Gate engages**: `SPINARR_NO_SANDBOX=1 node test/e2e/run.js us_mounted_image_and_eject` FAILS as expected with "Timed out waiting for: state.disc && state.disc.titles.length === 2". The failure screenshot shows the "Scan this disc?" prompt for NTSC_BASIC.
- **Consent path** (temporary harness edit, reverted, not committed): clicking `[data-action="scan-anyway"]` under `SPINARR_NO_SANDBOX=1` left `pendingScan` null, and the scan completed. Result: PASS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Possible infinite re-scan loop on a stale trusted flag**
- **Found during:** Task 2
- **Issue:** Main might refuse a scan with SANDBOX_OFF while the renderer still thinks the sandbox is trusted. `requestScan` would then call `loadSource` again with no consent, and the refuse/retry would repeat forever.
- **Fix:** Before re-prompting on a SANDBOX_OFF refusal, set `state.system.sandboxTrusted = false` (fail closed).
- **Files modified:** app/renderer/app.js
- **Commit:** f79b89a

**2. [Rule 1 - Bug] Prompt layout: disc name broke onto its own line**
- **Found during:** Task 2 (screenshot check)
- **Issue:** `.error-box b { display: block }` also applied to the bold disc name inside the prompt text.
- **Fix:** Added one scoped rule to styles.css: `.error-box span b { display: inline; margin: 0; }`. The plan allows the smallest scoped CSS fix.
- **Files modified:** app/renderer/styles.css
- **Commit:** f79b89a

**3. [Rule 2] Eject clears pending consent**
- Ejecting the source on screen now also clears `pendingScan`, so no prompt is left for a disc that is gone. Commit f79b89a.

## Notes for plan 01-07

- When the sandbox is untrusted, a scan has two steps. First click the source (or call `requestScan`), then click `[data-action="scan-anyway"]` and wait on `state.disc`.
- The harness `load()` helper calls `loadSource(src)` directly. With the sandbox off, main refuses that call and the renderer re-prompts. Under `SPINARR_NO_SANDBOX=1`, `load()` must go through the prompt (requestScan + click scan-anyway). Calling `loadSource(src, { userConfirmed: true })` directly would bypass the UI under test.
- The prompt's root element is `.error-box.banner[role=alertdialog]` and the title is `#scanPromptTitle`. "Not now" is `[data-action="scan-cancel"]`. It clears `state.source` and `state.pendingScan`.
- XSS scenarios should also run on the prompt path, since the volume or folder name is interpolated there via `esc()`.

## Known Stubs

None.

## TDD Gate Compliance

RED commit f88b5fe (test) is followed by GREEN commit f79b89a (feat). No refactor commit was needed.

## Self-Check: PASSED

- FOUND: test/unit/gate-static.test.js
- FOUND: test/unit/neutrality.test.js
- FOUND: f88b5fe
- FOUND: f79b89a
