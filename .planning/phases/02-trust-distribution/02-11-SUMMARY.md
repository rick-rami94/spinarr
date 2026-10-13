---
phase: 02-trust-distribution
plan: 11
subsystem: release-pipeline
tags: [ci, signing, notarization, sigstore, attestations, sbom, release]
requires:
  - build/sign-win.js MODULE_VERSION, build/verify-mac.sh, build/verify-win.ps1 (02-01)
  - scripts/gen-sbom.js + cyclonedx-cli pin (02-02)
  - environment `release` secrets/vars (02-03)
  - scripts/source-bundle.sh (02-09)
provides:
  - scripts/release-notes.js (buildNotes, CLI) - signing markers -> notes.md + prerelease flag
  - release.yml signed build matrix with per-leg signing-<name> markers
  - release.yml provenance release job (SBOM, source, SHA256SUMS, cosign bundle, attestations, draft)
  - test/unit/workflows.test.js static invariants for release.yml and ci.yml
affects:
  - 02-12 (unsigned rc tag run) and 02-13 (signed tag run) exercise this pipeline end to end
tech-stack:
  added:
    - azure/login v3.1.0 (a641126d1b8aa4d1fa005f4f92df94a3a4c4c906)
    - actions/attest v4.2.2 (1e69f48acb82d1966a394da916b4c1698aa569d6)
    - sigstore/cosign-installer v4.1.2 (6f9f17788090df1f26f669e9d70d6ae9567deba6), cosign v3.1.3
  patterns:
    - env-gated signing via conditional `environment:` expression
    - signing state propagated through tiny per-leg marker artifacts, never release assets
    - text/regex workflow invariant tests (no YAML dependency)
key-files:
  created:
    - scripts/release-notes.js
    - test/unit/release-notes.test.js
    - test/unit/workflows.test.js
  modified:
    - .github/workflows/release.yml
decisions:
  - "Build job keeps id-token: write (needed for azure/login OIDC); the static test allows id-token only in build and release, and contents/attestations write only in release"
  - "Signing marker step runs unconditionally on every leg (not if: always()); a failed leg blocks the release job anyway"
  - "Notes for fully signed releases include a short Signing section with the SmartScreen reputation caveat; unsigned/rc notes lead with their warning sections"
  - "Detect signing counts set variables by name with bash indirection so no value is ever echoed"
metrics:
  duration: ~35m
  completed: 2026-10-12
  tasks: 3
  files: 4
---

# Phase 2 Plan 11: Release trust pipeline Summary

release.yml now signs and notarizes when the `release` environment has credentials, builds unsigned without them, and a release job turns the final bytes into a draft with an SBOM, the GPL source bundle, cosign-signed SHA256SUMS, provenance and SBOM attestations, and honest pre-release notes driven by per-leg signing markers.

## What was built

**Task 1 (TDD): `scripts/release-notes.js`.** `buildNotes({ version, markers })` validates exactly five markers (unique names, known platform, boolean `signed` for mac/win, `null` for linux) and a plain `X.Y.Z[-suffix]` version. Any unsigned mac/win leg gives `prerelease: true` and a leading "Unsigned build" section naming macOS and/or Windows, saying Gatekeeper/SmartScreen will warn, and never suggesting a bypass. A `-` in the version gives a "Release candidate ... not for general use" section. Every body ends with "Verify this release": the exact `cosign verify-blob` command for `release.yml@refs/tags/v<version>` and `gh attestation verify`. The CLI writes `notes.md` and appends `prerelease=` to `$GITHUB_OUTPUT` (or prints it). 14 tests.

**Task 2: signed build matrix.** Each leg has `sign: mac|win|none`. `environment:` is `release` only for v* tags on mac/win legs, so PR/dispatch runs and Linux legs get no secrets. "Detect signing" fails with "macOS/Windows signing is half-configured" when some but not all of the four Apple or six Azure values are set. Windows: `Install-Module ArtifactSigning -RequiredVersion 0.1.20` (with the NuGet exception comment), `npm ci`, then `azure/login` immediately before Package. Package decodes the .p8 to `$RUNNER_TEMP/AuthKey_<id>.p8`, passes `-c.mac.forceCodeSigning=true`, and exports `SPINARR_REQUIRE_SIGNING=1` on signed legs. Unsigned legs unset everything that would make electron-builder try. macOS signed legs then notarize and staple the dmg (codesign authority check, notarytool `--wait --timeout 30m`, stapler staple + validate) and run `sh build/verify-mac.sh dist`. Windows runs `build/verify-win.ps1`. An `if: always()` step removes the .p8. Each leg uploads `signing-<name>` with `{name, platform, signed}`. APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID and WIN_CSC_* are gone. PR paths now include `scripts/**` and `THIRD_PARTY_NOTICES.txt`.

**Task 3: provenance release job and invariants.** The job keeps `if: startsWith(github.ref, 'refs/tags/v')`, has no environment, a 45-minute timeout, and permissions of exactly contents/id-token/attestations write. The steps, in order:

1. Checkout and setup-node (no cache).
2. Release version: tag base must equal package.json; exports VER and SOURCE_DATE_EPOCH.
3. Download `spinarr-*` to out/ and `signing-*` to markers/.
4. SBOM, validated with the hash-pinned cyclonedx-cli.
5. Source bundle (`SPINARR_SOURCE_REF=HEAD`).
6. Release notes.
7. Checksums.
8. cosign `sign-blob --yes --bundle`.
9. Two `actions/attest` steps (provenance, then SBOM) over `subject-checksums`.
10. Self-verify: cosign verify-blob, `gh attestation verify` on every asset, and the cyclonedx predicate on the first installer.
11. softprops draft upload, with `prerelease`/`make_latest` taken from the notes output and `body_path: notes.md`.

The header comment now describes the trust chain. `test/unit/workflows.test.js` (12 tests) checks:

- no caches
- top-level `contents: read`
- write permissions are scoped
- every `uses:` is SHA-pinned with a version comment
- no `pull_request_target`
- no `${{` inside any `run:`
- the legacy secrets are gone
- RequiredVersion matches `MODULE_VERSION`
- the signed-leg assertions
- notarytool appears only in the build job
- the release-job step order, with softprops last and `draft: true`
- the ci.yml required job ids have no `name:` key and no `paths:` filter

I checked the tests against five deliberate mutations (an expression in `run:`, a version drift, a cache, a widened build permission, and swapped attest/cosign order). Each one failed the suite as expected.

## Verification

- `node --test test/unit/release-notes.test.js test/unit/workflows.test.js`: 26/26 pass.
- `npm run test:unit`: 152 pass, 0 fail. Two tests skip because the worktree has no node_modules.
- Task 2's automated text check prints `ok`. `sign-blob --yes --bundle` appears 1 time; `subject-checksums` appears 2 times.
- zizmor 1.30.1, from the pinned requirements-audit.txt, run online with a read token: no findings at medium or above.
- I simulated the Detect signing and Signing marker shell scripts locally:
  - none set: false.
  - partial Apple or Azure: exits 1 with the half-configured error.
  - all four Apple values set: mac=true.
  - linux legs: `signed: null`.
  - an unsigned Windows leg: `signed: false`.
- I checked electron-builder's `MacTargetHelper.getNotarizeOptions`. It reads APPLE_API_KEY (a path), APPLE_API_KEY_ID and APPLE_API_ISSUER, and throws if only some are set. That's why unsigned legs unset the ID and issuer.

## Not verified here (needs a push; no outward actions allowed in this executor)

- The plan asks to confirm that the pull_request run of release.yml builds all five legs unsigned and green, with `signing-<name>` artifacts. That check also covers RESEARCH A8: whether GitHub accepts the empty-string `environment:` on PR runs. The orchestrator has to run it after pushing the branch. If GitHub rejects the empty environment name, split the mac/win signing into tag-only jobs (RESEARCH A8 fallback).
- The CI audit job (zizmor) on that push. The local run of the same pinned zizmor is clean.

## Deviations from Plan

None. Small choices made within the plan's discretion:
- The Signing marker step has no `if: always()`. It runs on every leg whatever its signing state, and a failed leg blocks the release job anyway.
- The notes add a short "Signing" section to fully signed releases, with the README's SmartScreen reputation wording.
- The tests also check that `APPLE_TEAM_ID` is gone, and that the release job has no `environment:`.

## TDD Gate Compliance

RED `c3dbe39` (test) came before GREEN `0320623` (feat). No refactor commit was needed.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 RED | c3dbe39 | test(02-11): add failing tests for release notes builder |
| 1 GREEN | 0320623 | feat(02-11): build release notes and pre-release flag from signing markers |
| 2 | b940e79 | feat(02-11): sign, notarize and assert in the release build matrix |
| 3 | 9911711 | feat(02-11): provenance release job and workflow invariant tests |

## Self-Check: PASSED

- FOUND: scripts/release-notes.js, test/unit/release-notes.test.js, test/unit/workflows.test.js, .github/workflows/release.yml
- FOUND: c3dbe39, 0320623, b940e79, 9911711
