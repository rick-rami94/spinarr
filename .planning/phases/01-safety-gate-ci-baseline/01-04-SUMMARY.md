---
phase: 01-safety-gate-ci-baseline
plan: 04
subsystem: testing
tags: [c8, coverage, windows, engine-tests, accurateChapters]
requires: []
provides:
  - "npm run test:coverage (c8 over unit + security + engine suites)"
  - ".c8rc.json with check-coverage on and all four thresholds explicit (0 for now)"
  - "Windows-portable engine/bluray/corpus tests (exe() helper)"
  - "Engine-level lossless test for accurateChapters=false"
affects: [01-09 (replaces the zero thresholds with the floored Linux baseline), CI Windows job]
tech-stack:
  added: ["c8 12.0.0 (devDependency, exact pin)"]
  patterns: ["exe(n) local helper for .exe suffix on win32", "assertLossless(r, L) shared lossless assertions"]
key-files:
  created: [.c8rc.json]
  modified: [package.json, package-lock.json, .gitignore, test/engine/engine.test.js, test/engine/bluray.test.js, test/security/corpus.test.js]
decisions:
  - "c8 thresholds are 0 (explicit, all four) until plan 01-09 records floor(Linux baseline); macOS numbers below are reference only"
  - "Chapter tolerance for accurateChapters=false stays at 0.6 s: it passed without widening"
metrics:
  duration: "~15 min"
  completed: 2026-10-10
  tasks: 2
  files: 7
---

# Phase 01 Plan 04: c8 coverage wiring and Windows-portable engine tests Summary

c8 12.0.0 now measures unit, security and engine suites with thresholds held at an explicit zero, the engine tests resolve `.exe` binaries on Windows, and a new engine test proves the shipped `accurateChapters=false` rip path is lossless with chapters intact.

## What was built

**Task 1 (235650e)**: c8 wired.
- `c8@12.0.0` installed as an exact-pinned devDependency. `npm view c8@12.0.0 scripts.postinstall` printed nothing before install. Runtime `dependencies` stays empty.
- `test:coverage` script: `c8 node --test "test/unit/*.test.js" "test/security/*.test.js" "test/engine/*.test.js"`. The existing `test*` scripts are unchanged.
- `.c8rc.json`: `all`, `src: ["app"]`, `include: app/**/*.js`, excludes `app/main.js`, `app/preload.js`, `app/renderer/app.js` (Electron/DOM, covered by e2e), reporters text + text-summary + lcov into `coverage/`, `check-coverage: true`, and `lines`, `statements`, `functions`, `branches` all `0`.
- **Plan 01-09 replaces these zeros with floor(Linux baseline)** (D-12, D-14). JSON has no comments, so the note lives here.
- `coverage/` added to `.gitignore`.

**Task 2 (16a016f)**: portable engine tests and the default-path lossless case.
- `const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n);` in `engine.test.js`, `bluray.test.js` and `corpus.test.js`. Every `BIN` and `ORACLE` join, every `existsSync` check and both corpus `SUITES` tools go through it. Missing-binary messages name the real file (`missing engine/bin/${exe(b)}`).
- `rip(src, title, streams, name, { accurateChapters = true } = {})`. Existing callers keep `-preindex`.
- LOSSLESS body factored into `assertLossless(r, L)`. The 5 table cases and the new test share it.
- New test `rip is lossless with accurateChapters=false (the shipped default)` on `ntsc_basic.iso` title 1 against `src/nb1.mpg`, 2 audio streams. It also asserts 4 chapters at [0, 10, 20, 30] within 0.6 s. That passed without `-preindex`, so the tolerance was not widened. Confirmed `lib.ripArgs` emits `-preindex` only when `accurateChapters` is true.

## Test results (local macOS, Node 24.12.0)

- `npm run test:engine`: 38/38 pass, including the new test.
- `npm run test:security`: 74/74 pass.
- `npm run test:coverage`: 157/157 pass, exit 0, about 33 s.

Local c8 summary, **for reference only. Do not use these as thresholds; Linux numbers will differ.**

```
Statements   : 84.49% ( 583/690 )
Branches     : 91.8% ( 325/354 )
Functions    : 87.71% ( 50/57 )
Lines        : 84.49% ( 583/690 )

lib.js       99.67 / 97.34 / 100 / 99.67
platform.js  69.54 / 82.4  / 72  / 69.54
format.js    100   / 95.12 / 100 / 100
```

Acceptance checks: the `c8rc ok` one-liner passes; `devDependencies.c8` = `12.0.0`; `dependencies` count = 0; `git check-ignore coverage/lcov.info` matches; no remaining `path.join(BIN, '` or `path.join(ORACLE, '` in the engine tests; `exe('` appears twice in corpus.test.js.

## Deviations from Plan

**1. [Rule 3 - Blocking] Stale root `"os": ["darwin"]` dropped from package-lock.json**
- **Found during:** Task 1 (`npm install`)
- **Issue:** The lockfile's root package entry carried `"os": ["darwin"]`, but package.json has no `os` field. npm removed it when it regenerated the lockfile. Keeping it could make `npm ci` reject Linux and Windows CI runners.
- **Fix:** Accepted npm's regenerated lockfile, which no longer has the field.
- **Commit:** 235650e

**Environment note (not a code change):** this worktree has no gitignored artifacts. The engine binaries, test fixtures and node_modules were APFS-cloned (`cp -c`) from the main checkout so the suites could run. All of them are gitignored and none were committed.

## Known Stubs

None.

## Threat Flags

None. T-01-17 is covered by the exact pin, the committed lockfile and the postinstall check. T-01-18 is covered by `check-coverage: true` with all four metrics explicit. For T-01-19, `exe()` resolves the real engine binaries and the oracle stays `ORACLE_FFMPEG_DIR`, never `engine/bin`.

## Self-Check: PASSED

- FOUND: .c8rc.json, package.json (test:coverage, c8 12.0.0), test/engine/engine.test.js (`accurateChapters: false`)
- FOUND commits: 235650e, 16a016f
