---
phase: 02-trust-distribution
plan: 01
subsystem: release-signing
tags: [signing, notarization, entitlements, authenticode, electron-builder, SF-6]
requires: []
provides:
  - build/sign-mac.js (mac.sign hook, per-path entitlements)
  - build/sign-win.js + build/sign-win.ps1 (Windows sign hook, pinned ArtifactSigning 0.1.20)
  - build/verify-mac.sh, build/verify-win.ps1 (post-build signature assertions)
  - env contract for release.yml (plan 02-11)
affects:
  - package.json build.mac / build.dmg / build.win
  - .github/workflows/release.yml (plan 02-11 must install ArtifactSigning -RequiredVersion 0.1.20 and call the verify scripts)
tech-stack:
  added: []
  patterns:
    - "custom electron-builder sign hooks that no-op without credentials (D-04) and throw when signing is required (D-07)"
    - "injected exec for testable child-process calls; argv arrays only"
key-files:
  created:
    - build/entitlements.mac.inherit.plist
    - build/entitlements.engine.plist
    - build/sign-mac.js
    - build/sign-win.js
    - build/sign-win.ps1
    - build/verify-mac.sh
    - build/verify-win.ps1
    - test/unit/sign-mac.test.js
    - test/unit/sign-win.test.js
    - test/unit/entitlements.test.js
  modified:
    - build/entitlements.mac.plist
    - package.json
decisions:
  - "Gatekeeper check uses spctl -t exec for the app and -t open --context context:primary-signature for the dmg, not D-04's -t install (installer packages only)"
  - "Windows signing uses a custom signtoolOptions.sign hook, never win.azureSignOptions (which runs an unpinned Install-Module)"
  - "Half-configured Azure env (1-2 of 3 vars) always throws, even without SPINARR_REQUIRE_SIGNING"
metrics:
  duration: ~30min
  completed: 2026-10-12
  tasks: 3
  files: 12
requirements: [REL-01, REL-02]
---

# Phase 2 Plan 01: Signing Hooks Summary

The app and Electron helpers now carry only allow-jit, and only the engine binaries carry disable-library-validation (SF-6). The split is applied by a custom `mac.sign` hook. On Windows, a `signtoolOptions.sign` hook signs every exe through ArtifactSigning, pinned at exactly 0.1.20 and passed as argv only. Builds without credentials stay unsigned and green.

## What was built

- **Entitlements (SF-6).** `entitlements.mac.plist` and the new `entitlements.mac.inherit.plist` hold only `allow-jit`. The new `entitlements.engine.plist` holds only `disable-library-validation`, with no DYLD entitlement.
- **`build/sign-mac.js`.** Wraps `opts.optionsForFile`. Paths matching `/Contents/Resources/engine/<file>` (either separator; `engine-evil` never matches) get the engine plist plus hardened runtime. Every other file keeps electron-builder's choice. `@electron/osx-sign` is resolved lazily from app-builder-lib's tree, so the tests load on any OS. electron-builder only calls the hook when a Developer ID identity exists.
- **`build/sign-win.js`.**
  - Skips sha1 passes.
  - No-op when no Azure vars are set.
  - Throws when `SPINARR_REQUIRE_SIGNING=1` and nothing is configured.
  - Throws when only 1 or 2 of `AZURE_SIGNING_ENDPOINT` / `AZURE_SIGNING_ACCOUNT` / `AZURE_CERT_PROFILE` are set, naming the missing ones.
  - Otherwise makes one `execFileSync('pwsh', [...argv], { stdio: 'inherit' })` call.
- **`build/sign-win.ps1`.**
  - Checks that the env vars and the file exist.
  - `Import-Module ArtifactSigning -RequiredVersion $ModuleVersion`, then asserts exactly that version is loaded.
  - Runs `Invoke-ArtifactSigning` (SHA256, ACS RFC3161 timestamp).
  - Re-checks that `Get-AuthenticodeSignature` is Valid.
  - Never runs `Install-Module`.
- **`build/verify-mac.sh <dist>`.**
  - Requires exactly one `mac*/Spinarr.app` and one `.dmg`.
  - Checks `codesign --verify --deep --strict`, the Developer ID authority (Rick Ramirez), the runtime flag and the timestamp.
  - The app has allow-jit and no disable-library-validation. No `Frameworks/*.app` helper has disable-library-validation.
  - Every `Resources/engine/*` binary (globbed; the script fails if none exist) has disable-library-validation, no allow-jit, the runtime flag and a timestamp.
  - Runs stapler validate on the app and the dmg, checks the dmg's Developer ID signature, then runs spctl.
- **`build/verify-win.ps1 [-Dist] [-Subject]`.**
  - Checks every exe under `win-unpacked` plus the installer exe(s).
  - Requires at least one engine exe and one installer.
  - Per file: Authenticode Valid, subject matches `CN=Rick Ramirez`, a timestamp is present, and `signtool verify /pa /all /v` passes.
  - Collects all failures and throws once.
- **package.json.**
  - `mac.sign`, `mac.entitlementsInherit` (the inherit plist), `dmg.sign: true`.
  - `win.signtoolOptions { sign, signingHashAlgorithms: ["sha256"] }`.
  - No `azureSignOptions`, `forceCodeSigning` or `notarize` key.

## Flag for Rick: D-04 spctl wording

D-04 says `spctl -a -vvv -t install`. Apple DTS documents `-t install` for installer packages (.pkg) only. It rejects or misreports a correctly notarized dmg. `verify-mac.sh` therefore uses:
- app: `spctl -a -t exec -vvv Spinarr.app`
- dmg: `spctl -a -t open -vvv --context context:primary-signature Spinarr.dmg`

Both must report `source=Notarized Developer ID`, and both artifacts must pass `xcrun stapler validate`. Read D-04's acceptance as "spctl accepts, using the correct assessment type" (RESEARCH Pitfall 2).

## Env contract (for release.yml, plan 02-11)

- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (path to .p8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- Windows: `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE`, `SPINARR_REQUIRE_SIGNING=1` on tag builds with credentials. release.yml must `Install-Module ArtifactSigning -RequiredVersion 0.1.20` and keep that in sync with `MODULE_VERSION` in `build/sign-win.js`.
- `forceCodeSigning` is passed from CI on signed tag builds only (D-07).

## Verification

- `npm run test:unit`: 101/101 pass. The new tests are 7 + 1 in sign-mac, 9 + 1 in sign-win and 4 in entitlements.
- `plutil -lint` passes for all three plists.
- `sh -n build/verify-mac.sh` passes.
- `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --publish never` packaged `dist/mac/Spinarr.app` unsigned. The hook was skipped because no identity was found.
- `sh build/verify-mac.sh dist` on that build exits 1 with `expected one .dmg in dist`. With a placeholder dmg it exits 1 with `dist/mac/Spinarr.app is not signed by Developer ID Application: Rick Ramirez`.
- Every acceptance grep in the plan passes. The `RequiredVersion $ModuleVersion` count reads 0 under macOS BSD grep, because `$` inside a basic regex acts as an anchor. `grep -F` returns 1.

Not verified here, because it needs credentials or other hosts:
- A real Developer ID or Azure signing run.
- Running `verify-win.ps1`; pwsh is not installed on this Mac.
- The required `windows` CI check (`electron-builder --win --dir`). With no Azure env the hook returns early, so that check should be unaffected. The CI run on the PR will confirm it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Engine plist comment tripped the acceptance grep**
- **Found during:** Task 1
- **Issue:** a comment saying "No allow-dyld-environment-variables" made `grep -c 'allow-jit\|allow-dyld'` return 1.
- **Fix:** reworded it to "No DYLD environment entitlement". The tests also strip XML comments before checking keys.
- **Commit:** 0c33eb6

**2. [Rule 3 - Blocking] verify-mac.sh comment doubled the `context:primary-signature` count**
- **Found during:** Task 3
- **Fix:** reworded the comment to "primary-signature context". The plan's comment text is otherwise kept.
- **Commit:** ba40e52

**3. [Rule 2 - Hardening] Extra checks beyond the plan text**
- `sign-win.ps1` validates that the three env vars and the target file exist before importing the module, and uses `-LiteralPath`, so paths with `[` `]` are not treated as wildcards.
- The loaded-version check also requires exactly one loaded ArtifactSigning module.
- `verify-mac.sh` checks that the app keeps allow-jit and that the dmg carries the Developer ID signature.
- **Commits:** 2587bc1, ba40e52

### Environment notes
- The worktree started at the wrong base (4b5d4e0). It was reset to 2d51947 as instructed, before any work.
- The worktree had no `node_modules`. To run tests and electron-builder, a temporary symlink to the main checkout's `node_modules` was created; it was removed afterwards and never committed. `dist/` was also removed.

## TDD Gate Compliance

- Task 1: RED `8d1360b` (test) -> GREEN `0c33eb6` (feat)
- Task 2: RED `17d5dfc` (test) -> GREEN `2587bc1` (feat)
- Task 3 (non-TDD): `ba40e52`

## Threat Model Coverage

- T-02-01: only the engine plist has disable-library-validation, enforced by entitlements.test.js and verify-mac.sh.
- T-02-02: the module is imported at its pinned version, the loaded version is asserted, and azureSignOptions is absent (asserted by a test).
- T-02-03: argv only and no shell; the hostile-path test passes.
- T-02-04: the hook throws under REQUIRE, the ps1 re-checks each signature, and both verify scripts glob every binary.

## Known Stubs

None.

## Self-Check: PASSED

- All 12 files in `files_modified` exist.
- Commits 8d1360b, 0c33eb6, 17d5dfc, 2587bc1 and ba40e52 are present in `git log`.
