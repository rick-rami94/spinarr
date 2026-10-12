---
phase: 02-trust-distribution
plan: 06
subsystem: ui, packaging, ipc
tags: [licensing, gpl, about, ipc, electron-builder, e2e]
requires:
  - phase: 02-01
    provides: package.json build config (mac/dmg/win blocks)
  - phase: 02-02
    provides: THIRD_PARTY_NOTICES.txt at repo root
provides:
  - Settings > About group (version, GPL notice, source link, third-party notices, Chromium licenses)
  - Four zero-argument IPC handlers (about, notices, open-source-release, open-chromium-licenses)
  - Packaged builds carry THIRD_PARTY_NOTICES.txt and licenses/LICENSE.electron.txt + LICENSES.chromium.html
  - about_notices e2e scenario (REL-04)
affects: [release workflow, renderer bridge surface, packaging]
tech-stack:
  added: []
  patterns:
    - "Privileged shell actions are zero-argument IPC handlers; main builds every target"
    - "Bundled text reaches the DOM through textContent only"
key-files:
  created: []
  modified:
    - app/main.js
    - app/preload.js
    - package.json
    - app/renderer/index.html
    - app/renderer/app.js
    - app/renderer/styles.css
    - test/e2e/scenarios.js
key-decisions:
  - "Source-release URL is built from app.getVersion() in one sourceReleaseUrl() function used by both the display and the open handler"
  - "renderAbout() fetches state.about on demand, so Settings opened before boot finishes still renders"
  - "Notices get their own full-width row; the Chromium licenses button sits in a separate row so the 72-column notices do not double-wrap"
requirements-completed: [REL-04]
duration: 20min
completed: 2026-10-12
---

# Phase 2 Plan 06: Settings About and Third-Party Notices Summary

**Settings > About shows the version, the GPL-3.0-or-later notice, a fixed source-release link and every bundled third-party license, through four argument-free IPC handlers, with the notice files shipped in every packaged build.**

## Performance

- **Duration:** about 20 min
- **Completed:** 2026-10-12
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `app/main.js`: fixed `RESOURCES`, `NOTICES` and `CHROMIUM_LICENSES` paths (no env override). `handle('about')`, `handle('notices')` (throws "Third-party notices are missing from this build" if absent), `handle('open-source-release', () => shell.openExternal(sourceReleaseUrl()))`, `handle('open-chromium-licenses', () => shell.openPath(CHROMIUM_LICENSES))`. All go through `handle()`'s sender check.
- `app/preload.js`: four new bridge keys (`about`, `notices`, `openSourceRelease`, `openChromiumLicenses`).
- `package.json` extraResources: the engine entry is unchanged and comes first. THIRD_PARTY_NOTICES.txt and Electron's LICENSE / LICENSES.chromium.html are now added. The unsigned `--mac --dir` build contains all three files: `Resources/THIRD_PARTY_NOTICES.txt` (130 KB), `Resources/licenses/LICENSE.electron.txt`, `Resources/licenses/LICENSES.chromium.html` (20 MB).
- Renderer: About group after System. Dynamic values go through `esc()`. Notices are set with `pre.textContent`. Both buttons are `type="button"`, and the click cases call the bridge with no arguments. The CSP meta line is untouched.
- `test/e2e/scenarios.js`: the `sec_renderer_isolation` bridge list is updated. The new `about_notices` scenario checks the version, the GPL text, the four `==` component headers and that there is no `<script`. It also checks that clicking the button and calling `spinarr.openSourceRelease("https://evil.example")` both open only `https://github.com/rick-rami94/spinarr/releases/tag/v0.1.4`. It takes six skin screenshots.

## Task Commits

1. **Task 1: Main-process About IPCs, bridge keys, bundled notice files**: `10666e5` (feat)
2. **Task 2: About group in Settings and the about_notices e2e scenario**: `69da43a` (feat)

## Verification

- `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --publish never`: build OK, and all three files are present in `dist/mac/Spinarr.app/Contents/Resources`.
- `node test/e2e/run.js about_notices sec_renderer_isolation us_settings_persist`: 3/3 PASS.
- `npm run test:unit`: 125 pass, 0 fail, 1 skipped.
- Acceptance greps: one zero-parameter handler each for `open-source-release` and `open-chromium-licenses`, and `openExternal` appears once (with `sourceReleaseUrl()`). `innerHTML.*notices` has 0 matches. The CSP line diff is empty.
- Skin screenshots (`test/reports/screenshots/about_notices-about-{studio,paper,pinstripe,millennium,neon,blossom}.png`): I checked them by eye. The text is legible in all six. Neon uppercases the ghost buttons through its existing override, which is expected. No skin needed an override.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] About group was empty when Settings opened right after boot**
- **Found during:** Task 2 (first about_notices run timed out)
- **Issue:** Boot fetches `state.about` after `state.settings`. If Settings opens in that gap, which the harness does and a fast user could too, `renderAbout()` returned early and the group stayed empty.
- **Fix:** `renderAbout()` now fetches `state.about` on demand if it is not loaded yet. The boot fetch stays.
- **Files modified:** app/renderer/app.js
- **Commit:** 69da43a

**2. [Layout] Chromium licenses button moved to its own row**
- **Found during:** Task 2 screenshot check
- **Issue:** With the button beside the `<details>`, the notices box was about half width. The pre-wrapped 72-column text then wrapped twice and was hard to read.
- **Fix:** There is now an "Electron and Chromium" row with the button, and the Third-party licenses `<details>` has a full-width row. The plan's elements, labels and data-actions are unchanged.
- **Files modified:** app/renderer/app.js
- **Commit:** 69da43a

## Threat Model Coverage

- T-02-16: zero-parameter handler, and the URL is built in main. The e2e test proves a renderer-supplied URL is ignored.
- T-02-17: fixed `CHROMIUM_LICENSES` path, zero parameters, routed through `handle()`.
- T-02-18: textContent only. The e2e test asserts there is no `<script`, and the CSP is unchanged.
- T-02-19: no env override for the resource paths. Packaged builds use `process.resourcesPath`.

## Known Stubs

None.

## Notes

- Test-only local setup (not committed, removed after the run): `node_modules` and `test/fixtures/out` were symlinked from the main checkout, and `engine/bin` was copied in for the packaging check.

## Self-Check: PASSED

- FOUND: app/main.js, app/preload.js, package.json, app/renderer/{index.html,app.js,styles.css}, test/e2e/scenarios.js
- FOUND: 10666e5, 69da43a
