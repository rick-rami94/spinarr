# Phase 2: Trust & Distribution - Research

**Researched:** 2026-10-12
**Domain:** Release signing and notarization (Apple, Azure Artifact Signing), supply-chain provenance (Sigstore, GitHub attestations, Immutable Releases, CycloneDX), GPL compliance, and coverage-guided fuzzing in CI (ClusterFuzzLite + libFuzzer + ASan)
**Confidence:** HIGH for signing/attestation mechanics (code- and doc-verified). MEDIUM for the fuzz-crash privacy design, which D-09 forces off the documented ClusterFuzzLite path.

## Summary

Most of this phase's mechanics are already prescribed in `CLAUDE.md` and were code-verified against electron-builder 26.15.3. This research checked those prescriptions against the installed source and current vendor docs. Six of them turned out wrong or incomplete in ways that would break a plan:

1. **ClusterFuzzLite's GitHub Actions always upload crashing inputs as workflow artifacts. That conflicts with D-09.** In `github` platform mode, `run_fuzzers` calls `filestore.upload_crashes()` after every run. The git storage-repo filestore delegates crash uploads to the GitHub Actions artifact store (`GitFilestore.upload_crashes → self._ci_filestore.upload_crashes`). Artifacts in a public repo can be downloaded by anyone with read access, which on a public repo means anyone. The stack trace also goes to the public job log. To keep crash data private, the run step has to run the CFLite `run-fuzzers` image in **standalone platform mode with a filesystem filestore** and its log redirected to a file, or fuzz with a thin libFuzzer runner over CFLite-built binaries. Moving the fuzz workflows to the private repo is the alternative, but private-repo Actions minutes are metered: about 140 min/night, roughly 4,200 min/month, which exceeds the Free and Pro included quotas.
2. **`spctl -a -vvv -t install` is the wrong assessment type for a `.dmg`.** `install` is for installer packages. Apple DTS gives `spctl -a -t open -vvv --context context:primary-signature <dmg>` for disk images, and the app uses `spctl -a -t exec -vvv`. D-04's acceptance check must use these, or a correctly notarized dmg will be reported "rejected".
3. **Pre-installing a pinned `TrustedSigning` module does not stop electron-builder's unpinned install.** electron-builder runs `Install-Module -Name TrustedSigning -MinimumVersion 0.5.0 -Force`. With `-Force`, PowerShellGet installs the newest matching version side by side, and auto-import then loads the highest version. The reliable pin is a **custom `win.signtoolOptions.sign` hook** that runs `Import-Module ArtifactSigning -RequiredVersion <x>` and then `Invoke-ArtifactSigning`. Microsoft's own `Azure/artifact-signing-action` has moved to the **`ArtifactSigning`** module and pins it with `-RequiredVersion`. The same hook makes "build now, sign later" free: it no-ops when the Azure env is absent.
4. **Entra federated credentials do not support wildcards**, so a `refs/tags/v*` subject can't be expressed. Use a GitHub **Environment** (`release`, deployment rule `v*` tags) with subject `repo:rick-rami94/spinarr:environment:release`.
5. **electron-builder deletes Electron's `LICENSE` and `LICENSES.chromium.html` from macOS app bundles** (`electronMac.js`). In-app notices on macOS need them re-added through `extraResources`.
6. **libbluray 1.5.0 vendors libudfread 1.2.0** (`contrib/libudfread`, LGPL-2.1, built in via `-Dembed_udfread=true`). It is not in the pin table, but it must be in the SBOM, `THIRD_PARTY_NOTICES` and `BUILDING.md`.

Two project-specific findings make the fuzz harnesses simple. libdvdread 7.1.1 exposes `DVDOpenFiles()` with a pluggable `dvd_reader_filesystem_h`, and libbluray 1.5.0 exposes `bd_open_files()` with `open_dir`/`open_file` callbacks. Both public headers are already installed into `engine/deps/prefix/include`. Both harnesses can serve an in-memory VIDEO_TS / BDMV tree, so no UDF image or tmpfs writes are needed. That mirrors the folder inputs the 70-case malicious corpus already uses.

**Primary recommendation:** Build signing as electron-builder hooks that no-op without credentials (`build/sign-mac.js`, `build/sign-win.js`), gate tag builds with explicit post-build assertion scripts, do all provenance work in a single draft-release job, and run fuzzing in the public repo through CFLite's build integration. Never let the CFLite GitHub action itself run fuzzers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Signing accounts and timing (REL-01, REL-02)
- **D-01:** Apple: Rick is **enrolled** in the Apple Developer Program but has **no Developer ID Application certificate and no App Store Connect API key yet**. The phase must include a step-by-step runbook (in `docs/RELEASING.md`) for creating both and loading them as repo secrets. Notarization auth uses the App Store Connect API key triple (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`), replacing the current `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` secrets in `release.yml`.
- **D-02:** Azure Artifact Signing: **nothing is set up** (no subscription, no signing account, no identity validation). The runbook covers subscription → Artifact Signing account → individual identity validation → certificate profile → Entra app registration with an OIDC federated credential scoped to this repo's release workflow.
- **D-03:** Publisher identity on all signatures is the individual **Rick Ramirez**. No business entity, no D-U-N-S.
- **D-04:** **Build now, sign later.** Build the full signing, notarization, stapling, attestation, SBOM and source-bundle pipeline in this phase. Signing and notarization steps detect missing secrets and skip cleanly (they don't fail the build). Phase 2 is **not complete** until a real signed v0.2.0 draft exists and passes `spctl -a -vvv -t install` on the stapled dmg (and the app), plus `Get-AuthenticodeSignature` / `signtool verify /pa /all` on the installer and every engine exe. That final check is a human-in-the-loop item that waits on the accounts.

#### Release flow (REL-03)
- **D-05:** The first release from the new pipeline is **v0.2.0**. 1.0 stays reserved for Phase 8.
- **D-06:** **Draft, Rick approves.** CI builds, signs, attests and uploads everything (installers, `SHA256SUMS.txt`, its `.sigstore.json` cosign bundle, SBOM, source tarball) into a **draft** release. Rick reviews it and publishes by hand. Turn on GitHub Immutable Releases. Because immutability applies at publish time, every asset must be uploaded while the release is still a draft.
- **D-07:** Unsigned-tag policy: **fail when secrets exist.** If the signing secrets are configured, a tag build that comes out unsigned or not notarized fails the release (e.g. `mac.forceCodeSigning: true` on tags, plus a post-build signature assertion). Before secrets exist, unsigned drafts are allowed but must be marked pre-release with an "unsigned" note in the release body.
- **D-08:** Existing v0.1.x releases: un-mark v0.1.3 as Latest, mark the v0.1.x releases as pre-release, and prepend a note to each: unsigned, macOS Gatekeeper and Windows SmartScreen will warn, use v0.2.0 or later. **Delete nothing.** This is an outward-facing `gh release edit`: the executor must stop and get Rick's explicit go before running it. Don't run it on its own initiative.

#### Fuzz crash handling (SAFE-10)
- **D-09:** New fuzz crashes are reported as a **private draft GitHub Security Advisory** (visible only to Rick), opened by the nightly job with the stack trace. Crashing inputs are **never** uploaded as public CI artifacts or issues. PR runs that find a new crash fail the check with a message pointing to the private advisory, without exposing the input.
- **D-10:** Corpus and crash reproducers live in a **separate private repo** (e.g. `rick-rami94/spinarr-fuzz-corpus`), read and written by ClusterFuzzLite with a narrowly scoped token. After a fix ships, the minimized reproducer moves into the public `test/security` corpus as a regression case.
- **D-11:** Budget: **10-minute code-change fuzzing** on PRs that touch engine code, a **1-hour batch per target nightly**, and weekly corpus pruning and coverage. The ASan replay of the existing malicious-disc corpus runs on every change.
- **D-12:** Fix flow: fix as a numbered patch in `engine/patches/` (as with the existing fuzz fixes), report privately to upstream (VideoLAN), and send the patch upstream after a Spinarr release ships it.

#### License notices and source (REL-04)
- **D-13:** In-app notices go in **Settings > About**: app version, the GPL-3.0-or-later notice, a link to the matching source release, and an expandable "Third-party licenses" list read from a bundled `THIRD_PARTY_NOTICES` file. Reuse the existing Settings layout; it must work in all six skins and keep the renderer CSP (`connect-src 'none'`). The link opens externally through the existing main-process path, not from the renderer.
- **D-14:** The GPL source bundle is **one full tarball** per release, `spinarr-<ver>-source.tar.gz`: app source at the tag, every upstream engine tarball exactly as pinned (checksums verified), `engine/patches/`, build scripts, and a `BUILDING.md` that reproduces the engine. Self-contained even if upstream URLs disappear.
- **D-15:** SBOM scope: CycloneDX 1.6 generated from the engine pin table in `engine/build.sh` (ffmpeg, libdvdread, libdvdnav, libbluray; later bubblewrap etc.), with patches as `pedigree`, plus **Electron as one component** with its bundled license file. Toolchain is recorded only as build metadata, not as components. A syft cross-check is optional. `THIRD_PARTY_NOTICES` is generated from the same pin table so they can't drift.

### Claude's Discretion
- Exact `mac.sign` hook design for per-binary entitlements (engine binaries get `disable-library-validation`; the app gets `allow-jit` only), following the stack research.
- How the DMG gets notarized and stapled after electron-builder (codesign dmg → `notarytool submit --wait` → `stapler staple`).
- Whether the `TrustedSigning` PowerShell module is pre-installed at a pinned version or the Azure signing action is used, as long as the module version is pinned.
- Provenance tooling (`actions/attest` provenance + SBOM modes, `cosign sign-blob --bundle`), harden-runner mode, and zizmor placement.
- ClusterFuzzLite build setup (Docker base-builder vs plain clang job first), harness file layout, and how the private-advisory step authenticates.
- How the source tarball is assembled and its CI size limits.
- Release-notes template wording, including the "unsigned" pre-release note.

### Deferred Ideas (OUT OF SCOPE)
- Linux package signing (GPG-signed deb repo / AppImage signatures): not discussed; the cosign-signed SHA256SUMS + attestations cover Linux artifacts for now.
- README "how to verify a release" section (`gh attestation verify`, `cosign verify-blob`): small and likely folded into REL-03 by the planner; not a separate decision.
- Contributing the libdvdread/libbluray harnesses to OSS-Fuzz: post-1.0 (per stack research).
- SignPath Foundation free OSS signing: revisit after 1.0.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REL-01 | macOS builds are signed with a Developer ID and notarized; app and dmg both stapled; `spctl` accepts the dmg with no Gatekeeper bypass. [SF-4] | Pattern 1 (`build/sign-mac.js` wrapping `optionsForFile`), Pattern 2 (dmg sign → notarytool → stapler), corrected `spctl` commands (Pitfall 2), API-key runbook notes (Team key, Developer role). |
| REL-02 | Windows builds and engine executables are signed with Azure Artifact Signing (OIDC, pinned signing module). [SF-4] | Pattern 3 (custom `signtoolOptions.sign` hook + pinned `ArtifactSigning` module), Environment-scoped federated credential (Pitfall 4), Authenticode assertion script (Pitfall 5: electron-builder's signing queue swallows per-file failures). |
| REL-03 | Build-provenance attestations, keyless cosign-signed SHA256SUMS, SBOM from engine pins, Immutable Releases on. [SF-4] | Pattern 4 (release job order: checksums → cosign → attest provenance via `subject-checksums` → attest SBOM → draft upload), Pattern 5 (CycloneDX 1.6 from pin table, `pedigree.patches`), Immutable Releases API (`PUT /repos/{o}/{r}/immutable-releases`, currently `enabled:false`). |
| REL-04 | GPL corresponding-source bundle per release; app ships third-party notices. [R-13] | Pattern 6 (reproducible `git archive` + verified engine tarballs + BUILDING.md), Pattern 7 (About section + fixed-URL IPC), libudfread + Electron/Chromium license findings. |
| SAFE-10 | libFuzzer harnesses for libdvdread IFO and libbluray MPLS/CLPI in CI via ClusterFuzzLite; malicious-disc corpus replayed against ASan builds. [SF-8] | Pattern 8 (`DVDOpenFiles` / `bd_open_files` in-memory harnesses), Pattern 9 (CFLite build integration + private-crash run design), Pattern 10 (ASan replay job with distinct exit codes), Pitfalls 6–9. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Security:** The engine never gains network access, and disc data is always untrusted. Fuzz harnesses are build-time/CI only and must not change the shipped engine's behaviour.
- **Legal:** Never bundle or fetch decryption libraries or keys. The source bundle, SBOM and notices must not include libdvdcss, libaacs or libbdplus. They are user-supplied and not distributed.
- **Budget:** Apple Developer Program ($99/yr) and Windows signing (Azure Artifact Signing) are approved.
- **Tech stack:** Electron plus plain HTML/CSS/JS with no UI framework. **No new runtime npm dependencies**: the About UI is vanilla DOM, and the generators are plain Node scripts.
- **Licensing:** GPL-3.0-or-later. Third-party GPL/LGPL obligations must be met in binaries.
- **Git:** repo-local identity `Rick Ramirez <30266247+rick-rami94@users.noreply.github.com>`, **no Claude co-author trailers**, milestone work on branches (current branch `milestone/v1.0`), and changes to `main` go through PRs because branch protection is enforced for admins.
- **CI conventions:** Every action is pinned by full SHA with a `# vX.Y.Z` comment (use `pinact`; Dependabot `github-actions` keeps them fresh). The required checks `macos`, `linux`, `windows`, `audit` must not be renamed, given a `name:`, or path-filtered. `persist-credentials: false` on checkout. No caches in publishing workflows (`release.yml`). Floating inputs need a documented-exception comment. zizmor runs at `--min-severity medium` on `.github/workflows`, and new workflows must pass it.
- **Prescriptions to follow** (CLAUDE.md §1, §2, §3, §7, "What NOT to Use"): API-key notarization, not Apple ID. No `entitlementsInherit` carrying `disable-library-validation`. `actions/attest`, not `attest-build-provenance`. cosign `--bundle`, not `.sig/.pem`. No minisign. No mutable action tags. No unpinned `pip install`. Fuzz on Linux only (Apple clang has no libFuzzer runtime). `sudo sysctl vm.mmap_rnd_bits=28` before ASan on GitHub runners.
- **GSD workflow:** file changes happen through `/gsd-execute-phase` plans.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-binary macOS entitlements and code signing | Build tooling (electron-builder `mac.sign` hook) | CI (`release.yml` macOS jobs) | Must happen inside electron-builder before notarization, and the hook runs before `notarizeIfProvided` (code-verified `macPackager.js`). |
| DMG notarize and staple | CI (release.yml step after electron-builder) | Build tooling (`dmg.sign: true`) | electron-builder notarizes only the `.app`. The dmg needs its own submission. |
| Windows Authenticode (app exe, engine exes, NSIS installer and uninstaller) | Build tooling (`win.signtoolOptions.sign` hook) | CI (Azure OIDC login + pinned module install) | Inner exes and the uninstaller must be signed before NSIS packs them, so only an electron-builder hook sees every file. |
| Checksums, cosign bundle, attestations, SBOM, source bundle, draft release | CI release job (ubuntu) | Repo scripts (`scripts/*.js`) | One job sees the final, signed, stapled artifacts. Attestations must cover the final bytes. |
| Immutable Releases | GitHub repo settings | — | Repo-level setting (`PUT /repos/{o}/{r}/immutable-releases`). |
| Third-party notices display | Electron renderer (Settings > About, read-only text) | Electron main process (reads bundled file, opens fixed source URL) | The renderer has no fs or net access (CSP `connect-src 'none'`, sandbox). Main owns file reads and `shell.openExternal`. |
| Notices / SBOM generation | Repo scripts at build time | `engine/build.sh` pin table (source of truth) | Same input generates both, so they can't drift (D-15). |
| Fuzz harnesses | Engine test code (`fuzz/`, C) | ClusterFuzzLite build image | Harnesses link the patched static libs. Linux and clang only. |
| Fuzz scheduling, corpus and crash privacy | CI (public repo workflows) | Private corpus repo, private draft advisories | Public-repo minutes are free. Crash data stays off public artifacts and logs (D-09). |
| ASan corpus replay | CI (`ci.yml` new `asan` job) | `engine/build.sh` sanitizer mode, `test/security/corpus.test.js` | Reuses the existing replay test with an ASan engine directory. |

## Standard Stack

### Core

| Tool / Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron-builder (installed) | 26.15.3 | Packaging, `mac.sign` / `win.signtoolOptions.sign` hooks, `dmg.sign`, built-in notarization | Already the packager. Hooks code-verified [VERIFIED: node_modules/app-builder-lib/out]. |
| `@electron/osx-sign` (bundled with electron-builder) | 1.3.3 | `signAsync(opts)` called from the custom mac hook | electron-builder's own `macCodeSign.sign` calls `signAsync(opts)` [VERIFIED: macCodeSign.js:174]. |
| `@electron/notarize` (bundled) | 2.5.0 | Notarizes and staples the `.app` when `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` are set | Scheme docs list the API-key triple as option 1 [VERIFIED: app-builder-lib/scheme.json]. |
| Xcode `notarytool` / `stapler` / `spctl` / `codesign` | macos-15 runner Xcode | Notarize and staple the dmg; assertions | Apple's only notarization path [CITED: developer.apple.com/forums/thread/675354]. |
| PowerShell module `ArtifactSigning` (PSGallery) | **0.1.20** (2026-09-09); pin with `-RequiredVersion` | `Invoke-ArtifactSigning` called from the custom Windows sign hook | Microsoft's successor to `TrustedSigning`. `Azure/artifact-signing-action` (main) pins `ArtifactSigning` 0.1.20, and its v2.0.0 tag pins 0.1.8 [VERIFIED: GitHub API, action.yml]. `TrustedSigning` last released 0.5.8 on 2025-07-11 [VERIFIED: powershellgallery.com]. |
| `azure/login` | v3.1.0 (2026-09-10) | OIDC login so `Invoke-ArtifactSigning`'s DefaultAzureCredential chain uses AzureCliCredential | Official OIDC path [VERIFIED: GitHub releases API]. |
| `actions/attest` | v4.2.2 (2026-08-04) | SLSA provenance (`subject-checksums: SHA256SUMS.txt`) and SBOM attestation (`sbom-path`) | Supports `subject-checksums` and `sbom-path` (≤16 MB) [VERIFIED: action.yml@v4.2.2]. |
| `sigstore/cosign-installer` + cosign | v4.1.2 / cosign v3.1.3 | `cosign sign-blob --yes --bundle SHA256SUMS.txt.sigstore.json SHA256SUMS.txt` | cosign v3 is bundle-only for `sign-blob` [VERIFIED: GitHub releases API; CITED: docs.sigstore.dev]. |
| `softprops/action-gh-release` (already pinned) | v3.0.3 | Draft release upload, `prerelease`, `body_path`, `make_latest` | Already in `release.yml` [VERIFIED: repo]. |
| GitHub Immutable Releases | GA 2025-10-28 | Lock tag and assets on publish, plus an auto-generated release attestation (`gh release verify`, `gh release verify-asset`) | API currently returns `{"enabled":false}` for this repo [VERIFIED: gh api]. |
| ClusterFuzzLite build integration | `google/clusterfuzzlite/actions/build_fuzzers@v1` (tag object `82652fb…`; pin the commit SHA with pinact) and image `gcr.io/oss-fuzz-base/clusterfuzzlite-run-fuzzers:v1` | Build libFuzzer + ASan targets from `.clusterfuzzlite/` into `$GITHUB_WORKSPACE/build-out/` | Standard OSS-Fuzz-compatible build [VERIFIED: action.yml, workspace_utils.py]. |
| libFuzzer + ASan/UBSan (clang in base-builder; clang 18 on ubuntu-24.04 for the replay job) | — | Harnesses and replay | CLAUDE.md §7. |

### Supporting

| Tool | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `CycloneDX/cyclonedx-cli` (release binary, checksum-pinned download) | v0.33.1 (2026-07-23) | `cyclonedx validate --input-version v1_6 --fail-on-errors` in the release job and Linux CI | Validates the hand-generated SBOM [VERIFIED: GitHub releases + README]. |
| `actions/create-github-app-token` | v3.2.0 | Short-lived, per-step-scoped tokens for the private corpus repo and advisory creation | Preferred over long-lived PATs for D-10's "narrowly scoped token". |
| `step-security/harden-runner` | v2.22.1 | Egress audit on Linux release and fuzz jobs (audit mode first) | Optional (discretion). |
| `anchore/syft` | v1.54.1 | Optional SBOM cross-check of the unpacked app | Optional per D-15. |
| zizmor (already in `audit` job) | v1.30.1 | Lints every new workflow automatically (it scans `.github/workflows`) | No change needed. New workflows must pass. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `win.signtoolOptions.sign` hook | `win.azureSignOptions` (native) | Native path runs `Install-Module TrustedSigning -MinimumVersion 0.5.0 -Force` on every build. That is unpinned, and a pre-install does not neutralize it (Pitfall 3). It also fails when Azure creds are absent, so "sign later" would need config injection. |
| Custom hook | `Azure/artifact-signing-action` v2.0.0 after the build | Cannot sign the inner `Spinarr.exe`, engine exes or uninstaller *before* NSIS packs them. Only the outer installer would be signed. |
| CFLite standalone run (public repo) | Official `run_fuzzers` action in the **private** corpus repo | Documented path and private by default, but private-repo minutes are metered (Pitfall 7). |
| CFLite standalone run | Thin libFuzzer runner over CFLite-built `build-out/` binaries | Fallback if the standalone spike fails. Same harnesses and build. Loses CFLite's prune/coverage tooling (replace with `-merge=1` and a weekly coverage job in the private repo). |
| GitHub App tokens | Two fine-grained PATs (corpus repo `contents:write`; spinarr `repository_advisories:write`) | Simpler setup, but long-lived secrets with expiry management. |
| Hand-generated CycloneDX | `@cyclonedx/cyclonedx-npm` / syft | Emits a near-empty or wrong SBOM for a static ffmpeg build (CLAUDE.md). |

**Installation:** no npm installs. CI-only tools:

```bash
# Windows release job (pwsh), before electron-builder:
Install-Module -Name ArtifactSigning -RequiredVersion 0.1.20 -Repository PSGallery -Force -Scope CurrentUser
# Release job (ubuntu): cosign via sigstore/cosign-installer@<sha> # v4.1.2 (with cosign-release: v3.1.3)
# cyclonedx-cli: curl the v0.33.1 linux-x64 asset, check a pinned SHA-256, chmod +x
```

**Version verification:** Action versions were checked via `gh api repos/<r>/releases/latest` on 2026-10-12 and the PSGallery module pages were fetched the same day. Executors must resolve the commit SHAs with `pinact` at implementation time.

## Package Legitimacy Audit

This phase adds **no npm or PyPI packages**, so slopcheck does not apply. The external artifacts are GitHub Actions, a PSGallery module and release binaries:

| Package / artifact | Registry | Age | Source Repo | Check | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `ArtifactSigning` | PSGallery | 0.1.20 published 2026-09-09; Microsoft copyright | github.com/Azure/artifact-signing-action pins it | Confirmed via the official Microsoft action's `action.yml` | Approved. Pin `-RequiredVersion`. |
| `actions/attest`, `azure/login`, `sigstore/cosign-installer`, `actions/create-github-app-token`, `step-security/harden-runner` | GitHub | Years-old orgs | Official orgs | releases API | Approved. SHA-pin. |
| `google/clusterfuzzlite` actions + `gcr.io/oss-fuzz-base/*` images | GitHub / GCR | Since 2021 | google/clusterfuzzlite, google/oss-fuzz | GitHub API | Approved. Image tags are mutable: pin by digest or document the exception. |
| `CycloneDX/cyclonedx-cli` | GitHub releases | Years | github.com/CycloneDX/cyclonedx-cli | releases API | Approved. Pin download SHA-256. |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 git tag v0.2.0 ─► release.yml
                     │
   ┌─────────────────┼──────────────────────────────────────────────┐
   │ build matrix (5 jobs; Windows + macOS jobs use environment       │
   │ "release" on tags → signing secrets + Azure OIDC available)     │
   │                                                                  │
   │ engine/build.sh (pinned, sha-verified tarballs + patches)        │
   │        │                                                         │
   │        ▼                                                         │
   │ electron-builder ──► mac: sign-mac.js hook ─► osx-sign           │
   │        │               (engine/* → entitlements.engine.plist;    │
   │        │                app → allow-jit; helpers → inherit)      │
   │        │             ─► @electron/notarize (.app, API key)       │
   │        │             ─► dmg.sign (Developer ID)                  │
   │        │            win: sign-win.js hook per .exe               │
   │        │               (Spinarr.exe, engine/*.exe, NSIS,         │
   │        │                uninstaller) ─► Invoke-ArtifactSigning   │
   │        ▼                                                         │
   │ mac: notarytool submit dmg --wait ─► stapler staple dmg          │
   │        ▼                                                         │
   │ assert step: secrets present? ── yes ─► verify-mac.sh /          │
   │        │                               verify-win.ps1 (fail hard)│
   │        └─ no ─► record "unsigned" marker                         │
   │        ▼                                                         │
   │ upload-artifact (installers only)                                │
   └──────────────────────────┬──────────────────────────────────────┘
                              ▼
   release job (ubuntu-24.04; contents:write, id-token:write, attestations:write)
     checkout tag ─► gen THIRD_PARTY_NOTICES + SBOM (pin table) ─► cyclonedx validate
       ─► source bundle (git archive + verified engine tarballs + patches + BUILDING.md)
       ─► SHA256SUMS.txt over every asset
       ─► cosign sign-blob --bundle SHA256SUMS.txt.sigstore.json
       ─► actions/attest (provenance, subject-checksums=SHA256SUMS.txt)
       ─► actions/attest (sbom-path=spinarr-<v>.cdx.json, same subjects)
       ─► self-verify (gh attestation verify, cosign verify-blob)
       ─► softprops draft release (prerelease + "unsigned" body if any platform unsigned)
                              ▼
   Rick reviews draft ─► publishes ─► Immutable Releases locks tag + assets
                                     (+ GitHub release attestation)

 Fuzzing (public repo; crash data never leaves the runner except to private stores)
   PR touching engine/** or fuzz/** ─► cflite build_fuzzers (address)
      ─► run-fuzzers image, standalone mode, FILESTORE=filesystem, log → file
      ─► corpus pulled from private repo (same-repo PRs only)
      ─► crash? ─► create private draft advisory (App token) ─► fail with GHSA link only
   nightly batch (1h/target) ─► same, then push corpus + crash reproducer to private repo
   weekly prune + coverage ─► private repo
   every change (ci.yml `asan` job) ─► build.sh asan ─► corpus.test.js on bin-asan
```

### Recommended Project Structure

```
build/
├── entitlements.mac.plist          # app: allow-jit ONLY (rewritten)
├── entitlements.mac.inherit.plist  # Electron helpers: allow-jit
├── entitlements.engine.plist       # engine binaries: disable-library-validation ONLY
├── sign-mac.js                     # mac.sign hook: per-path entitlements → osx-sign signAsync
├── sign-win.js                     # win.signtoolOptions.sign hook: pinned Invoke-ArtifactSigning, no-op w/o env
├── verify-mac.sh                   # codesign/spctl/stapler/entitlement assertions
└── verify-win.ps1                  # Authenticode Valid + timestamp on every exe + installer
scripts/
├── pins.js                         # parse engine/build.sh SOURCES (single parser)
├── gen-notices.js                  # → THIRD_PARTY_NOTICES.txt
├── gen-sbom.js                     # → spinarr-<v>.cdx.json (CycloneDX 1.6)
├── source-bundle.sh                # → spinarr-<v>-source.tar.gz (reproducible)
└── fuzz-report.js                  # crash → private draft advisory (dedup by signature)
fuzz/
├── fuzz_dvd_ifo.c                  # DVDOpenFiles in-memory VIDEO_TS
├── fuzz_bd_mpls_clpi.c             # bd_open_files in-memory BDMV
├── memfs.h                         # tiny shared "archive → files" decoder
├── make_seeds.py                   # malicious corpus folders → seed zips
└── *.options                       # [libfuzzer] detect_leaks=0, max_len
.clusterfuzzlite/
├── Dockerfile                      # FROM base-builder@sha256:…; pinned meson
├── build.sh                        # build static libs with $CFLAGS, link harnesses with $LIB_FUZZING_ENGINE
└── project.yaml                    # language: c
.github/workflows/
├── release.yml                     # extended
├── ci.yml                          # + `asan` job
├── fuzz-pr.yml                     # code-change, 10 min
└── fuzz-cron.yml                   # nightly batch, weekly prune + coverage
docs/RELEASING.md                   # account runbook + release + verify
BUILDING.md                         # included in the source bundle
THIRD_PARTY_NOTICES.txt             # generated; bundled via extraResources
```

### Pattern 1: Per-binary entitlements via `mac.sign` hook (REL-01, SF-6)

**What:** Wrap `opts.optionsForFile` so files under `Contents/Resources/engine/` get the engine plist, then call the bundled osx-sign `signAsync`.
**When:** Always on macOS. electron-builder calls the custom hook **only when a Developer ID identity was found**: `sign()` returns false before `doSign` when `findSigningIdentity` is null. Unsigned builds skip it automatically [VERIFIED: macPackager.js:291-334].

```js
// build/sign-mac.js. Source: app-builder-lib/out/macPackager.js doSign(), MacTargetHelper.getOptionsForFile()
const path = require('path');
// Resolve osx-sign from electron-builder's own dependency tree (options-shape must match 1.3.3).
const osxSign = require(require.resolve('@electron/osx-sign', { paths: [require.resolve('app-builder-lib')] }));
const ENGINE_PLIST = path.join(__dirname, 'entitlements.engine.plist');

module.exports = async function sign(opts /* , packager */) {
  const base = opts.optionsForFile;
  opts.optionsForFile = (filePath) => {
    const o = base(filePath); // { entitlements, hardenedRuntime, timestamp, requirements, additionalArguments }
    if (filePath.includes(`${path.sep}Contents${path.sep}Resources${path.sep}engine${path.sep}`)) {
      return { ...o, entitlements: ENGINE_PLIST, hardenedRuntime: true };
    }
    return o;
  };
  return osxSign.signAsync(opts); // opts.identity is already the hash/name chosen by electron-builder
};
```

package.json `build.mac`: `"sign": "build/sign-mac.js"`, `"entitlements": "build/entitlements.mac.plist"`, `"entitlementsInherit": "build/entitlements.mac.inherit.plist"`, `"hardenedRuntime": true`. Add `"dmg": { "sign": true, ... }`. `dmg.sign` silently returns when no identity is found [VERIFIED: dmg-builder/out/dmg.js:59-84].

The engine needs **only** `com.apple.security.cs.disable-library-validation`. `app/platform.js` gives engines a minimal env with no `DYLD_*`, so `allow-dyld-environment-variables` is not needed [VERIFIED: app/platform.js:145].

### Pattern 2: DMG notarize + staple (REL-01)

electron-builder notarizes and staples the `.app` before the dmg is built. Then:

```bash
# release.yml macOS step, only when APPLE_API_KEY_ID is set
P8="$RUNNER_TEMP/AuthKey_${APPLE_API_KEY_ID}.p8"; printf '%s' "$APPLE_API_KEY_P8_BASE64" | base64 --decode > "$P8"
DMG=$(ls dist/*.dmg)
codesign -dvv "$DMG" 2>&1 | grep -q 'Authority=Developer ID Application'   # dmg.sign did its job
xcrun notarytool submit "$DMG" --key "$P8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait --timeout 30m
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
```

The `APPLE_API_KEY` env for electron-builder must be the **path** to the `.p8`. Write it from the base64 secret at job start [CITED: CLAUDE.md §1, scheme.json].

### Pattern 3: Windows signing hook with a pinned module (REL-02)

electron-builder calls a custom `signtoolOptions.sign` hook for every exe it signs: the app exe, each `extraResources` `.exe` via `createTransformerForExtraFiles`, and the NSIS installer and uninstaller. The `cscInfo == null` short-circuit is skipped when a custom hook exists [VERIFIED: windowsSignToolManager.js:132-160, winPackager.js:220-232].

```js
// build/sign-win.js. Called once per file per hash; set signingHashAlgorithms: ["sha256"].
const { execFileSync } = require('child_process');
const path = require('path');
const MODULE_VERSION = '0.1.20'; // keep in sync with release.yml Install-Module -RequiredVersion
module.exports = async function sign(config /* { path, hash, ... } */) {
  const env = process.env;
  const configured = env.AZURE_SIGNING_ENDPOINT && env.AZURE_SIGNING_ACCOUNT && env.AZURE_CERT_PROFILE;
  if (!configured) {
    if (env.SPINARR_REQUIRE_SIGNING === '1') throw new Error(`signing required but Azure signing is not configured: ${config.path}`);
    return; // build now, sign later (D-04)
  }
  // Pass the path as a parameter to a script file, never by string-splicing into -Command.
  execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'sign-win.ps1'),
    '-ModuleVersion', MODULE_VERSION, '-File', config.path], { stdio: 'inherit' });
};
```

`build/sign-win.ps1` runs `Import-Module ArtifactSigning -RequiredVersion $ModuleVersion -ErrorAction Stop`, then `Invoke-ArtifactSigning -Endpoint $env:AZURE_SIGNING_ENDPOINT -CodeSigningAccountName $env:AZURE_SIGNING_ACCOUNT -CertificateProfileName $env:AZURE_CERT_PROFILE -Files $File -FileDigest SHA256 -TimestampRfc3161 http://timestamp.acs.microsoft.com -TimestampDigest SHA256`. Parameter names are from the official action [VERIFIED: artifact-signing-action action.yml]. package.json `build.win`: `"signtoolOptions": { "sign": "build/sign-win.js", "signingHashAlgorithms": ["sha256"] }`. **Do not** set `azureSignOptions`: its presence switches electron-builder to the Azure manager and its unpinned install [VERIFIED: winPackager.js:35].

Workflow order on the Windows tag job: `Install-Module ArtifactSigning -RequiredVersion 0.1.20 …`, then `azure/login` (client-id, tenant-id, subscription-id from the environment; `allow-no-subscriptions` if needed) **immediately before** the Package step, then electron-builder with `SPINARR_REQUIRE_SIGNING=1` when the secrets exist, then `build/verify-win.ps1`.

### Pattern 4: Release job order (REL-03)

```yaml
release:
  if: startsWith(github.ref, 'refs/tags/v')
  needs: build
  runs-on: ubuntu-24.04
  environment: release            # if signing secrets live in the environment
  permissions: { contents: write, id-token: write, attestations: write }
  steps:
    - uses: actions/checkout@<sha> # v7.0.1   (persist-credentials: false) ← new: needed for source/SBOM
    - uses: actions/download-artifact@<sha> # merge-multiple → out/
    - run: node scripts/gen-sbom.js --version "$VER" --out out/spinarr-$VER.cdx.json   # + validate
    - run: sh scripts/source-bundle.sh "$VER" out/                                       # verified tarballs
    - run: cd out && sha256sum -- * > SHA256SUMS.txt          # bare filenames
    - uses: sigstore/cosign-installer@<sha> # v4.1.2
    - run: cosign sign-blob --yes --bundle out/SHA256SUMS.txt.sigstore.json out/SHA256SUMS.txt
    - uses: actions/attest@<sha> # v4.2.2
      with: { subject-checksums: out/SHA256SUMS.txt }
    - uses: actions/attest@<sha> # v4.2.2
      with: { subject-checksums: out/SHA256SUMS.txt, sbom-path: out/spinarr-<v>.cdx.json }
    - run: |   # self-verify before upload
        cosign verify-blob --bundle out/SHA256SUMS.txt.sigstore.json \
          --certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/release.yml@${GITHUB_REF}" \
          --certificate-oidc-issuer https://token.actions.githubusercontent.com out/SHA256SUMS.txt
        gh attestation verify out/<one installer> --repo "$GITHUB_REPOSITORY"
    - uses: softprops/action-gh-release@<sha> # v3.0.3
      with: { draft: true, prerelease: <unsigned?>, make_latest: <not prerelease>, body_path: notes.md,
              generate_release_notes: true, files: out/* }
```

Users verify with `gh attestation verify <file> --repo rick-rami94/spinarr`, `cosign verify-blob …` (as above, with `@refs/tags/vX`), `sha256sum -c SHA256SUMS.txt`, and after publish `gh release verify vX` / `gh release verify-asset vX <file>` [VERIFIED: gh 2.87.3 help].

**Signed/unsigned propagation:** each build job uploads a tiny `signing-<name>.json` in a separate artifact (not attached to the release). The release job reads them to set `prerelease` and write the "unsigned" note per platform. With the D-07 assertions, "secrets present" implies "signed" for that platform. Mixed states (Apple ready, Azure not) must be expressible.

### Pattern 5: SBOM and notices from the pin table (REL-03, REL-04, D-15)

- **Single parser** `scripts/pins.js` reads the `SOURCES="…"` block of `engine/build.sh` (`name version url sha256` per line). Recommendation: add a **5th column with the SPDX license**. `build.sh`'s `fetch()` only reads awk fields `$1`–`$4`, so a 5th column doesn't affect it [VERIFIED: engine/build.sh fetch()]. Values: `ffmpeg` GPL-3.0-or-later (built `--enable-gpl --enable-version3`), `libdvdread` GPL-2.0-or-later, `libdvdnav` GPL-2.0-or-later, `libbluray` LGPL-2.1-or-later.
- **Embedded component:** libudfread 1.2.0 (LGPL-2.1-or-later), vendored at `libbluray-1.5.0/contrib/libudfread` and linked because of `-Dembed_udfread=true` [VERIFIED: tarball listing, contrib meson.build]. Model it as a nested `components[]` entry of libbluray, or as a top-level component with a `dependencies` edge.
- **CycloneDX 1.6 fields** (schema-verified): `components[].pedigree.patches[]` = `{ type: "unofficial", diff: { text: {content, contentType:"text/x-diff"} | url } }`. `externalReferences[]` of `type: "distribution"` carries `url` + `hashes: [{alg:"SHA-256", content}]` (supported in 1.6). purl is `pkg:generic/ffmpeg@8.0.1?download_url=…` for the C libs and `pkg:npm/electron@44.7.0` for Electron. Toolchain goes in `metadata.properties` (D-15: build metadata only) [VERIFIED: bom-1.6.schema.json].
- **Determinism:** take timestamps from `SOURCE_DATE_EPOCH` (tag commit time). Omit `serialNumber` or derive it deterministically.
- **THIRD_PARTY_NOTICES.txt** = header (Spinarr GPL-3.0-or-later + source URL template), then per component: name, version, SPDX id, upstream URL, patch list, and the **full license text copied from the extracted tarball** (`COPYING`, `COPYING.GPLv3` for ffmpeg, libudfread's `COPYING`), then the Electron `LICENSE` and a pointer to `LICENSES.chromium.html`. Generate it in the build jobs after `npm run engine`, when `engine/deps/<lib>-<ver>/` exists, before electron-builder, and bundle it via `extraResources`.

### Pattern 6: Reproducible source bundle (REL-04, D-14)

```sh
# scripts/source-bundle.sh <ver> <outdir>. Deterministic layout, verified engine tarballs.
SDE=$(git log -1 --format=%ct "v$VER"); P="spinarr-$VER"
git archive --format=tar --prefix="$P/" "v$VER" > "$T/app.tar"            # app source at the tag (incl. engine/patches, build.sh, BUILDING.md)
sh engine/build.sh fetch                                                    # NEW mode: download + sha-verify all pins, no build
mkdir -p "$T/$P/engine/upstream" && cp engine/deps/*.tar.xz "$T/$P/engine/upstream/"
# merge, then: tar --sort=name --mtime=@$SDE --owner=0 --group=0 --numeric-owner -cf - … | gzip -n > "$OUT/$P-source.tar.gz"
```

The bundle is about 20 MB: about 11.6 MB of engine tarballs plus about 8.6 MB of tracked files [VERIFIED: du]. That is far under GitHub's 2 GiB per-asset limit. `BUILDING.md` documents `ENGINE_TARBALL_DIR=engine/upstream sh engine/build.sh` (offline build). `fetch()` already skips the download when `deps/<name>-<ver>.tar.xz` exists, so the simplest offline path is copying `upstream/*.tar.xz` into `engine/deps/`.

### Pattern 7: Settings > About without weakening the renderer (REL-04, D-13)

- **There is no existing "open external" path in main.** `main.js` only uses `shell.showItemInFolder`, and window opening and navigation are denied [VERIFIED: app/main.js:102-104, 507-510]. Add **one** IPC `open-source-release` that takes **no arguments**. Main builds `https://github.com/rick-rami94/spinarr/releases/tag/v${app.getVersion()}` and calls `shell.openExternal`. Never accept a URL from the renderer.
- Add `notices` IPC: main reads `THIRD_PARTY_NOTICES.txt` from `process.resourcesPath` when packaged, or the repo root in dev, and returns the text. The renderer puts it in a `<details><pre>` via `textContent`, never `innerHTML`.
- `LICENSES.chromium.html` is **20 MB** [VERIFIED: ls]. Don't send it over IPC. Add an "Open Chromium licenses" button that calls `shell.openPath` on the bundled file (IPC with no args).
- On macOS, electron-builder **deletes** `LICENSE` and `LICENSES.chromium.html` from the app output [VERIFIED: electronMac.js:218-221]. Add `extraResources` entries copying `node_modules/electron/dist/LICENSE` → `licenses/LICENSE.electron.txt` and `LICENSES.chromium.html` → `licenses/` for all OSes.
- Version: add `version: app.getVersion()` to the `system` IPC payload or a new `about` IPC.
- The dialog markup lives in `app/renderer/index.html` (`#settingsDlg`, `.group` / `.group-title` / `.group-row`). Add a "About" `group-title` after "System". Check all six skins in `lib.SKINS`.

### Pattern 8: In-memory fuzz harnesses (SAFE-10)

- **IFO:** `DVDOpenFiles(priv, &logcb, "/", fs)` with a `dvd_reader_filesystem_h` (`stat`, `dir_open/read/close`, `file_open/read/seek/close`) serving `/VIDEO_TS/{VIDEO_TS.IFO,VIDEO_TS.BUP,VTS_01_0.IFO,VTS_01_0.BUP}` from the fuzz input. "On success the reader owns fs and closes it in DVDClose; on failure the caller keeps fs." [VERIFIED: dvd_reader.h:177-193, dvd_filesystem.h]. Mirror IFO→BUP the way `fuzz_dvdinfo.py` does, so the backup fallback can't mask a mutation.
- **MPLS/CLPI:** `bd_init()` → `bd_open_files(bd, priv, open_dir, open_file)` serving `BDMV/index.bdmv`, `BDMV/MovieObject.bdmv`, `BDMV/PLAYLIST/*.mpls`, `BDMV/CLIPINF/*.clpi` (and `BACKUP/`) via `BD_FILE_H` / `BD_DIR_H` from the installed `libbluray/filesystem.h`. Then call `bd_get_titles(bd, TITLES_ALL, 0)` + `bd_get_title_info()` for every title, exactly as `bdinfo.c` does [VERIFIED: bluray.h:394-410, bdinfo.c:107-185].
- **Exercise the shipped code path:** refactor the post-open body of `engine/dvdinfo.c` / `bdinfo.c` into `int dvdinfo_print(dvd_reader_t*)` / `int bdinfo_print(BLURAY*)`, with `main` behind `#ifndef SPINARR_FUZZ`. The harness calls the same function with stdout sent to `/dev/null` (`freopen` in `LLVMFuzzerInitialize`).
- **Input format:** a tiny length-prefixed archive (`u8 file_id, u32 len, bytes…`). `fuzz/make_seeds.py` converts the 33 + 37 committed malicious-corpus folders [VERIFIED: ls] into seed zips (`fuzz_dvd_ifo_seed_corpus.zip`), which CFLite picks up from `$OUT`.
- **Harness sanity check (Wave 0):** build the IFO harness against **unpatched** libdvdread and confirm that at least one `test/fixtures/malicious/crash_*` seed crashes it. That proves the harness reaches the vulnerable parser.

### Pattern 9: CFLite with private crashes (SAFE-10, D-09/D-10/D-11)

- **Build:** official `build_fuzzers` action (`sanitizer: address`, `language: c`) using `.clusterfuzzlite/Dockerfile` (`FROM gcr.io/oss-fuzz-base/base-builder@sha256:<digest>`, `pip install --require-hashes meson==1.12.1` because base-builder's apt meson is older than the `>= 0.60.0` these libs need [VERIFIED: meson.build files]). `.clusterfuzzlite/build.sh` fetches and patches via `engine/build.sh fetch`, builds libdvdread, libdvdnav and libbluray with `meson setup … --default-library=static -Db_lundef=false` (CFLAGS from the env carry the sanitizer flags), then links harnesses with `$CC $CFLAGS … $LIB_FUZZING_ENGINE`. The build action uploads nothing unless `upload-build: true`, so it is safe in public.
- **Run (recommended, needs a spike):** `docker run` the `clusterfuzzlite-run-fuzzers:v1` image (pinned by digest) with `CFL_PLATFORM=standalone`, `FILESTORE=filesystem`, `FILESTORE_ROOT_DIR=$RUNNER_TEMP/filestore`, `WORKSPACE=$GITHUB_WORKSPACE`, `MODE`, `FUZZ_SECONDS`, `SANITIZER=address`, entrypoint `python3 /opt/oss-fuzz/infra/cifuzz/run_fuzzers_entrypoint.py` (or `cifuzz_combined_entrypoint.py`), stdout and stderr redirected to `$RUNNER_TEMP/fuzz.log`. The platform and filestore exist in CIFuzz source [VERIFIED: platform_config/standalone.py, filestore_utils.py], but this path is **not documented** for GitHub (MEDIUM). Before the run, copy the private corpus into the filestore's corpus layout. After the run, push the corpus back and hand crashes to `scripts/fuzz-report.js`.
- **Fallback:** run the `build-out/` binaries directly: `./fuzz_dvd_ifo -max_total_time=3600 -artifact_prefix=$RUNNER_TEMP/crashes/ corpus/ seeds/`, prune with `-merge=1`, log to file. Weekly coverage runs the official `run_fuzzers` action `mode: coverage` in the **private** repo, which is cheap (~20 min/week).
- **Budget:** CFLite splits `fuzz-seconds` *across* targets (`fuzz_seconds // fuzzers_left_to_run`) [VERIFIED: run_fuzzers.py:113-130]. "1 hour per target" means `FUZZ_SECONDS=7200` for two targets, or one matrix job per target in the fallback.
- **Reporting:** compute signature = sha256(target + top 3 symbolized frames). Look in the private repo `crashes/<target>/<sig>/`: if present it is known, so skip the advisory (the PR job still fails, linking the existing GHSA). If new, store the reproducer + log in the private repo, then `POST /repos/rick-rami94/spinarr/security-advisories` (creates a **draft**; needs `repository_advisories:write` on a fine-grained PAT or GitHub App, which GITHUB_TOKEN can't do) [CITED: docs.github.com REST repository-advisories]. Body: summary `[fuzz:<sig8>] <target>: <crash type>`, description with the stack trace, `severity`, `vulnerabilities: [{package:{ecosystem:"other", name:"spinarr-engine"}}]`.
- **Fork PRs** have no secrets: run on seeds only. On a crash, print only "fuzzing found a crash; a maintainer will reproduce it privately" and fail.

### Pattern 10: ASan replay on every change (SAFE-10)

- `engine/build.sh asan`: build libdvdread, libdvdnav, libbluray (meson `-Db_sanitize=address,undefined -Db_lundef=false`) and dvdinfo/bdinfo with `-fsanitize=address,undefined -fno-omit-frame-pointer -g` into **`engine/bin-asan/`** (never `engine/bin`, which is packaged). No ffmpeg is needed.
- `test/security/corpus.test.js`: honour `SPINARR_ENGINE_BIN` (default `engine/bin`). When it is set, run with `ASAN_OPTIONS=detect_leaks=0:exitcode=86:abort_on_error=0:symbolize=1` and `UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1:exitcode=87`, and assert `status ∉ {86, 87}` and stderr has no `ERROR: AddressSanitizer` / `runtime error:`.
- New `ci.yml` job id `asan` on `ubuntu-24.04`, no `paths:` filter: `sudo sysctl vm.mmap_rnd_bits=28`, clang, `sh engine/build.sh asan`, `SPINARR_ENGINE_BIN=engine/bin-asan node --test test/security/corpus.test.js`. Recommend Rick adds `asan` to the required checks (branch-protection change, so a checkpoint).

### Anti-Patterns to Avoid

- **Running the official `run_fuzzers` action in the public repo:** it uploads crash testcases as public artifacts and logs stack traces (Pitfall 6).
- **`output-sarif` / `upload-sarif` for fuzz results:** this pushes crash details into code scanning. Don't enable it.
- **`pull_request_target` to give fork PRs secrets:** a classic secret-exfiltration path. zizmor flags it.
- **Renderer-supplied URLs to `shell.openExternal`.**
- **Attesting before notarization/stapling:** stapling rewrites the dmg, so the attested digest would not match. Attest only in the release job over final bytes.
- **Putting signing secrets at repo level:** scope them to the `release` environment (tag rule `v*`) so `pull_request` runs of `release.yml` never see them.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recursive Mach-O signing with hardened runtime + timestamps | A `codesign` walker | `@electron/osx-sign` `signAsync` via the hook | Signing order (inside-out), framework versions and helpers are already solved. |
| Authenticode + RFC3161 timestamp + cert retrieval | Raw `signtool` + Azure dlib setup | `Invoke-ArtifactSigning` (pinned) | The module fetches the pinned dlib/SDK build tools and handles auth. |
| Provenance signing | Custom in-toto statements | `actions/attest` | Sigstore keyless, `gh attestation verify` compatible. |
| Checksum signing | GPG/minisign keys | `cosign sign-blob --bundle` | No long-lived key custody (CLAUDE.md). |
| SBOM validation | Ad-hoc JSON checks only | `cyclonedx validate --input-version v1_6` + unit tests | Schema conformance. |
| Fuzzing engine, minimization, merge | Extending `fuzz_*.py` mutation fuzzers | libFuzzer (`-merge=1`, `-minimize_crash=1`) via CFLite build | Coverage-guided. The Python fuzzers are "not real fuzzing" (audit SF-8). |
| Release immutability | Re-checking asset hashes in CI | GitHub Immutable Releases | Server-enforced plus a release attestation. |

**Key insight:** every custom piece in this phase should be a thin adapter (hooks, generators, report script). The trust comes from Apple, Microsoft, Sigstore and GitHub primitives, and a hand-rolled substitute weakens what users can verify.

## Common Pitfalls

### Pitfall 1: CFLite publishes crash inputs
**What goes wrong:** `run_fuzzers` in GitHub mode uploads `out/artifacts/*` as workflow artifacts, even with `storage-repo` set, and logs the stack trace.
**Why:** `get_filestore()` returns `GitFilestore(config, GithubActionsFilestore)`, and `GitFilestore.upload_crashes` delegates to the Actions filestore [VERIFIED: oss-fuzz infra/cifuzz/filestore_utils.py, filestore/git/__init__.py:113-115, clusterfuzz_deployment.py:185-204]. Artifacts need only read access [CITED: docs.github.com download-workflow-artifacts].
**Avoid:** use the standalone/filesystem run or the fallback runner (Pattern 9). Only `build_fuzzers` runs in public.
**Warning signs:** an artifact named `crashes-*` appears on any public run.

### Pitfall 2: Wrong `spctl` type for dmg
**What goes wrong:** `spctl -a -vvv -t install Spinarr.dmg` rejects or misreports a properly notarized dmg.
**Avoid:** dmg: `spctl -a -t open -vvv --context context:primary-signature X.dmg` → expect `source=Notarized Developer ID`. App: `spctl -a -t exec -vvv Spinarr.app`. Both: `xcrun stapler validate`. Apple DTS also notes `spctl` checks Gatekeeper compliance, not notarization itself [CITED: developer.apple.com/forums/thread/675354]. **The D-04 acceptance wording should be read as "spctl accepts", using the right type.** Flag this to Rick.

### Pitfall 3: Unpinned PSGallery install survives a pre-install
**What goes wrong:** with `azureSignOptions`, electron-builder runs `Install-Module -Name TrustedSigning -MinimumVersion 0.5.0 -Force …` [VERIFIED: windowsSignAzureManager.js]. `-Force` "allows for multiple versions to be installed", and `-MinimumVersion` picks "the newer version" [CITED: learn.microsoft.com Install-Module], so the newest module lands side by side and gets auto-imported.
**Avoid:** custom hook + explicit `Import-Module -RequiredVersion` (Pattern 3).

### Pitfall 4: OIDC subject can't wildcard tags; tokens expire
**What goes wrong:** a federated credential for `ref:refs/tags/v0.2.0` works once. `refs/tags/v*` is not supported ("Wildcard characters aren't supported… pattern matching isn't supported for branches and tags") [CITED: learn.microsoft.com workload-identity-federation-create-trust]. Separately, `azure/login` early in a 40+ minute Windows job (ffmpeg build) can leave an expired assertion or token by signing time [ASSUMED].
**Avoid:** GitHub Environment `release` → subject `repo:rick-rami94/spinarr:environment:release`. Run `azure/login` immediately before packaging.

### Pitfall 5: electron-builder swallows per-file Windows signing failures
**What goes wrong:** `signIf` logs "signing failed for file, queue will continue" [VERIFIED: winPackager.js:116-120]. A custom hook that returns normally counts as "signed" even when it no-oped, so `forceCodeSigning` can't detect it.
**Avoid:** the hook throws when `SPINARR_REQUIRE_SIGNING=1`, and `build/verify-win.ps1` asserts on `dist/win-unpacked/**/*.exe` plus `dist/*.exe` (installer). Optionally extract the installer with 7-Zip and check the inner exes too. Per file: `(Get-AuthenticodeSignature $f).Status -eq 'Valid'`, `SignerCertificate.Subject -match 'CN=Rick Ramirez'`, `TimeStamperCertificate -ne $null`, plus `signtool verify /pa /all /v`.

### Pitfall 6: Apple key type
**What goes wrong:** an *Individual* App Store Connect API key with an issuer gives 401. Reports also say individual keys don't work with notarytool at all.
**Avoid:** create a **Team key** with **Developer** role (Account Holder → Users and Access → Integrations → App Store Connect API → Team Keys) [CITED: multiple; MEDIUM].

### Pitfall 7: Private-repo minutes
**What goes wrong:** running nightly batch in the private corpus repo costs about 140 min/night (2 × 60 min fuzz + about 20 min build), or about 4,200 min/month, more than the GitHub Free (2,000) and Pro (3,000) included minutes [ASSUMED: plan quotas from training; Rick's plan is unknown, since the API returned no plan].
**Avoid:** fuzz in the public repo (free standard runners) with the private-crash design. Keep only storage, and optionally the weekly coverage, private.

### Pitfall 8: ASan exit code collides with scanner exit 1
**What goes wrong:** ASan's default `exitcode=1` equals dvdinfo/bdinfo's normal "error JSON" exit, so `corpus.test.js`'s `[0,1].includes(status)` would pass an ASan report. Also, the tool prints its report to stderr while stdout JSON may be incomplete.
**Avoid:** distinct `exitcode` values and a stderr scan (Pattern 10). Use `detect_leaks=0`, consistent with `fuzz_dvdinfo.py`'s `ASAN_OPTIONS`. Leaks in a one-shot scanner are not security bugs.

### Pitfall 9: Leak reports flood libFuzzer
**What goes wrong:** libdvdread/libbluray error paths may leak. libFuzzer treats leaks as crashes, which would file advisories for non-security issues.
**Avoid:** `fuzz/<target>.options` with `[libfuzzer]\ndetect_leaks=0`. Revisit after the first clean week.

### Pitfall 10: Immutable tag burn
**What goes wrong:** "If you delete the immutable release, you can delete the tag, but you cannot reuse the same tag name." [CITED: docs.github.com immutable-releases]
**Avoid:** never publish v0.2.0 until the human verification passes on the **draft**. Rehearse with `v0.2.0-rc.N` tags if needed (the `v*` trigger matches).

### Pitfall 11: Mutable inputs in new workflows
**What goes wrong:** `gcr.io/oss-fuzz-base/*:v1` and `base-builder` are mutable tags. The CFLite actions are SHA-pinned, but they reference `docker://…:v1` internally.
**Avoid:** pin the images by `@sha256:` digest in the Dockerfile and `docker run`. Document the action-internal image as a known exception (like Homebrew/MSYS2), in the same style as the existing "documented exception" comments.

### Pitfall 12: README tells users to bypass SmartScreen and Gatekeeper
**What goes wrong:** README lines 50-53 instruct "right-click → Open / Open Anyway" and "More info → Run anyway" [VERIFIED: README.md]. CONTEXT's specifics forbid advising bypasses.
**Avoid:** rewrite the install section for signed v0.2.0+. Explain that SmartScreen may still show an "unrecognized app" reputation warning at first, verify via `gh attestation verify` / `cosign`, and warn that v0.1.x is unsigned.

## Code Examples

### Assertion script for macOS (tag builds with secrets)
```bash
# build/verify-mac.sh <dist dir>. Source: Apple DTS (forums/thread/675354), codesign(1)
set -eu
APP=$(ls -d "$1"/mac*/Spinarr.app); DMG=$(ls "$1"/*.dmg)
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvv "$APP" 2>&1 | grep -q 'Authority=Developer ID Application: Rick Ramirez'
codesign -dvv "$APP" 2>&1 | grep -q 'flags=.*runtime'
codesign -dvv "$APP" 2>&1 | grep -q '^Timestamp='
for b in "$APP"/Contents/Resources/engine/*; do
  codesign -d --entitlements :- "$b" 2>/dev/null | grep -q disable-library-validation
  ! codesign -d --entitlements :- "$b" 2>/dev/null | grep -q allow-jit
done
! codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q disable-library-validation
xcrun stapler validate "$APP"; xcrun stapler validate "$DMG"
spctl -a -t exec -vvv "$APP" 2>&1 | tee /dev/stderr | grep -q 'source=Notarized Developer ID'
spctl -a -t open -vvv --context context:primary-signature "$DMG" 2>&1 | tee /dev/stderr | grep -q 'source=Notarized Developer ID'
```

### Enable Immutable Releases (checkpoint: repo setting)
```bash
gh api -X PUT repos/rick-rami94/spinarr/immutable-releases   # then GET → {"enabled":true,...}
```

### Draft advisory creation (fuzz-report.js core)
```js
// Source: docs.github.com/en/rest/security-advisories/repository-advisories#create-a-repository-security-advisory
await fetch(`https://api.github.com/repos/rick-rami94/spinarr/security-advisories`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  body: JSON.stringify({
    summary: `[fuzz:${sig.slice(0, 8)}] ${target}: ${crashType}`,
    description: '```\n' + stack + '\n```\nReproducer: private corpus repo crashes/' + target + '/' + sig,
    severity: 'high',
    vulnerabilities: [{ package: { ecosystem: 'other', name: 'spinarr-engine' } }],
  }),
}); // created as draft; visible only to repo admins and invited collaborators
```

## External / Account State Inventory

This is not a rename phase, but several deliverables live outside git. The planner needs explicit tasks, checkpoints or human steps for each:

| Category | Items | Action |
|----------|-------|--------|
| GitHub releases | v0.1.2, v0.1.3 (Latest), **v0.1.4 Draft** (exists, unpublished) [VERIFIED: gh release list] | D-08 edits, behind a checkpoint for Rick's explicit go. Ask whether the v0.1.4 draft should be left alone (D-08 says delete nothing). |
| Repo settings | Immutable Releases `enabled:false`; new environment `release` (tag rule `v*`); optionally add `asan` to required checks | Settings changes go through a checkpoint. |
| Secrets / vars | Remove `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CERT_PFX_BASE64`, `WIN_CERT_PASSWORD` wiring. Add (environment `release`): `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`; vars `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE`. Fuzz: App ID + private key, or PATs. | Runbook in docs/RELEASING.md. Rick does this by hand. |
| External accounts | Apple Developer ID Application cert (G2), ASC Team API key; Azure subscription (billing account type **Individual**, legal name and address matching government ID), `Microsoft.CodeSigning` provider, Artifact Signing account (Basic), Identity Verifier role, individual validation (AU10TIX + Authenticator Verified ID), Public Trust cert profile, Entra app + federated credential, Certificate Profile Signer role [CITED: learn.microsoft.com/azure/artifact-signing/quickstart] | Human items. Validation can take days. |
| New repo | `rick-rami94/spinarr-fuzz-corpus` (private) does not exist yet [VERIFIED: gh repo view] | Checkpoint (outward-facing account action). |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `TrustedSigning` PS module, "Trusted Signing" | `ArtifactSigning` module (`Invoke-ArtifactSigning`), "Artifact Signing" | Module 0.1.x line through 2026-09; action v1.0.0 2026-01 | Role names are now "Artifact Signing Identity Verifier" / "Certificate Profile Signer". electron-builder 26.15.3 still hard-codes TrustedSigning, which is another reason for the custom hook. |
| `actions/attest-build-provenance` | `actions/attest` (provenance/SBOM modes) | v4 | Use `actions/attest`. |
| cosign `.sig` + `.pem` | cosign v3 bundle-only `sign-blob` | cosign v3 | `--bundle x.sigstore.json`. |
| Mutable releases + checksums | Immutable Releases + release attestation | GA 2025-10-28 | Upload everything while still a draft. |
| CycloneDX 1.6 | 1.7 exists (cyclonedx-cli defaults to v1.7 validation) | 2025/2026 | D-15 locks 1.6. Pass `--input-version v1_6` explicitly. |

**Deprecated/outdated in repo:** `release.yml`'s `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `WIN_CSC_LINK` wiring, the shared `build/entitlements.mac.plist` (SF-6), `docs/RELEASING.md`'s "Code signing (optional)" section and `windows-latest` table row (the workflow uses `windows-2025`), and the README's bypass instructions.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CFLite `run-fuzzers` image works on GitHub runners with `CFL_PLATFORM=standalone` + `FILESTORE=filesystem` (undocumented; code exists) | Pattern 9 | Use the fallback runner over `build-out/` binaries. A Wave 0 spike decides. |
| A2 | `azure/login` credentials can go stale if done long before signing in a 40+ min job | Pitfall 4 | Low. Placing login right before packaging is harmless either way. |
| A3 | GitHub Free/Pro private-repo minute quotas (2,000 / 3,000) and Rick's plan | Pitfall 7 | If Rick has ample minutes, the official CFLite actions in the private repo become the simplest D-09-compliant option. |
| A4 | Pinning `ArtifactSigning` pins its transitive NuGet downloads (SDK build tools, signing client) because versions are module-internal | Standard Stack | If not, add a documented exception or pre-seed the NuGet cache. Confirm in the first signed run's log. |
| A5 | softprops v3 `body_path` + `generate_release_notes` puts the custom body before the generated notes | Pattern 4 | Cosmetic. Alternatively build the full body in a step. |
| A6 | Electron 44's bundled `libffmpeg` (LGPL-2.1, Chromium build) needs only notice + source pointer (Chromium/Electron tag), not inclusion in the source tarball | Pattern 5/7 | Low. Add a pointer line in THIRD_PARTY_NOTICES and BUILDING.md. Confirm with Rick if a stricter reading is wanted. |
| A7 | Fine-grained PATs or a GitHub App are the only token types that can create repository advisories (GITHUB_TOKEN has no `repository-advisories` permission) | Pattern 9 | If wrong, it's a simplification, not a blocker. |
| A8 | `environment:` can be set conditionally (e.g. empty for non-tag/PR runs) in the build matrix | Pattern 4 | Otherwise split the Windows/macOS signing into tag-only jobs. |

## Open Questions (RESOLVED)

1. **D-04's literal `spctl -t install` command.**
   - Known: Apple DTS says dmg assessment is `-t open --context context:primary-signature`, and app assessment is `-t exec`.
   - Recommendation: the plan uses the correct commands and records the interpretation. Tell Rick.
   - RESOLVED: 02-01 `build/verify-mac.sh` uses `-t open --context context:primary-signature` (dmg) and `-t exec` (app) plus `stapler validate`; deviation documented.
2. **Fuzz run location and token type.**
   - Known: public CFLite actions leak crashes. Private-repo minutes cost money. Standalone mode is undocumented.
   - Recommendation: Wave 0 spike of the standalone run in the public repo, with the fallback runner if it fails. Use a GitHub App for tokens (one app: Contents R/W on the corpus repo, Repository advisories R/W on spinarr; mint per step with `actions/create-github-app-token`). Ask Rick to accept the App setup, or two PATs.
   - RESOLVED: 02-08 runs the standalone spike with the libFuzzer-runner fallback; token type is a decision checkpoint in 02-04.
3. **Where v0.2.0 is tagged from.**
   - Known: work is on `milestone/v1.0`, `main` is protected, and Phase 2 runs in parallel with Phases 3-7.
   - Recommendation: tag from `main` after the Phase 2 PR merges. Confirm with Rick.
   - RESOLVED: v0.2.0 is tagged on `main` after merge (02-13 Task 2), preceded by an unsigned v0.2.0-rc.1 draft (02-12).
4. **The existing v0.1.4 draft release.** Leave it as is, or include it in the D-08 note pass? It is unpublished. Ask at the D-08 checkpoint.
   - RESOLVED: decided at the D-08 checkpoint (02-14 Task 2).
5. **UI-SPEC for the About section.** `workflow.ui_phase` is true. The About section is small, but the plan-checker may expect a UI spec. The planner should decide whether a lightweight UI note is enough, given D-13's constraints.
   - RESOLVED: no UI-SPEC; 02-06 follows the existing `renderSystem()` `.group-row` pattern.

## Environment Availability

| Dependency | Required By | Available (this Mac) | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `xcrun notarytool` / `stapler` | REL-01 local verification | ✓ | CLT | CI macos-15 runners |
| Developer ID identity in keychain | REL-01 | ✗ (0 valid identities) | — | Blocked on the D-01 runbook (human) |
| Docker | Local CFLite spike | ✓ | 29.1.2 | CI ubuntu runners |
| pwsh | Local sign-win test | ✗ | — | CI windows-2025 only; unit-test the hook's env logic in Node |
| cosign | Local verify | ✗ | — | CI via cosign-installer; `brew install cosign` optional |
| gh | Release ops, API checks | ✓ | 2.87.3 | — |
| Node | Generators, tests | ✓ | 24.12.0 local / `.nvmrc` 22.23.3 CI | — |
| Azure Artifact Signing account | REL-02 | ✗ | — | Blocked on the D-02 runbook (human, days) |
| clang with libFuzzer | SAFE-10 | ✗ locally (Intel Mac, Apple clang) | — | CFLite base-builder / ubuntu-24.04 clang 18 in CI |

**Missing with no fallback:** Apple Developer ID cert + ASC Team key, and the Azure signing setup. Both are human-gated, and the D-04 completion check waits on them.
**Missing with fallback:** everything else is CI-side.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built in), c8 12.0.0 for coverage; e2e via `test/e2e/run.js` (Electron-driven scenarios) |
| Config file | none (scripts in package.json) |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm test` (unit + security + engine + e2e) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-01 | Hook maps `…/Contents/Resources/engine/*` → engine plist, app → app plist, helpers → inherit | unit | `node --test test/unit/sign-mac.test.js` | ❌ Wave 0 |
| REL-01 | Plists: app has allow-jit and no DLV; engine has DLV only; inherit has allow-jit only | unit | `node --test test/unit/entitlements.test.js` | ❌ Wave 0 |
| REL-01 | Signed, notarized, stapled app + dmg accepted by spctl | CI assertion (tag + secrets) / manual | `sh build/verify-mac.sh dist` | ❌ Wave 0; final run human (D-04) |
| REL-02 | Hook no-ops without env, throws with `SPINARR_REQUIRE_SIGNING=1`, passes path as argv (no splicing), pins module version consistent with release.yml | unit | `node --test test/unit/sign-win.test.js` | ❌ Wave 0 |
| REL-02 | Every exe + installer Authenticode Valid, timestamped, CN=Rick Ramirez | CI assertion / manual | `pwsh build/verify-win.ps1 dist` | ❌ Wave 0; final run human |
| REL-03 | Pin parser matches build.sh fields; SBOM has every pin + libudfread + Electron, patches as pedigree, SHA-256 on distribution refs, specVersion 1.6 | unit | `node --test test/unit/sbom.test.js` | ❌ Wave 0 |
| REL-03 | SBOM schema-valid | CI | `cyclonedx validate --input-file … --input-version v1_6 --fail-on-errors` | ❌ (release job + linux CI step) |
| REL-03 | cosign bundle + attestation verify on produced assets | CI self-check in release job | `cosign verify-blob …` / `gh attestation verify …` | ❌ |
| REL-03 | Immutable Releases enabled | smoke | `gh api repos/rick-rami94/spinarr/immutable-releases --jq .enabled` → `true` | manual/checkpoint |
| REL-03 | release.yml structure: permissions scoped, environment on signing jobs, attest after notarize, no caches | unit (YAML text checks, like gate-static) | `node --test test/unit/workflows.test.js` | ❌ Wave 0 |
| REL-04 | Notices list every pin + libudfread + Electron with license text present; generated from the same parser as SBOM | unit | `node --test test/unit/notices.test.js` | ❌ Wave 0 |
| REL-04 | Source bundle contains `git archive` tree, each engine tarball with matching SHA-256, `engine/patches/*`, BUILDING.md; deterministic (two runs, same hash) | integration (Linux CI) | `sh scripts/source-bundle.sh <ver> /tmp/sb && node --test test/unit/source-bundle.test.js` | ❌ Wave 0 |
| REL-04 | Settings > About shows version, GPL notice, notices text; "source" button calls main with no args; renderer never gets a URL param | e2e | `node test/e2e/run.js about_notices` | ❌ Wave 0 (new scenario) |
| SAFE-10 | ASan replay of all 70 cases with no sanitizer report | CI (`asan` job) | `SPINARR_ENGINE_BIN=engine/bin-asan node --test test/security/corpus.test.js` | ✅ test exists; ❌ env override + build mode |
| SAFE-10 | Harnesses build under CFLite and reach the parser (unpatched build crashes on a known seed) | CI / spike | `fuzz-pr.yml` run; local `docker` spike | ❌ Wave 0 |
| SAFE-10 | Crash handling never exposes input (no artifacts, log has only GHSA link) | CI review + workflow unit check | `node --test test/unit/workflows.test.js` (asserts no `upload-artifact` / `run_fuzzers` action in public fuzz workflows) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit`
- **Per wave merge:** `npm test` on macOS locally plus a CI green on all required checks + `asan`
- **Phase gate:** full suite green, one unsigned `v0.2.0-rc` draft produced end to end (attest + cosign + SBOM + source verified), then the human-gated signed v0.2.0 draft check (D-04) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `test/unit/sign-mac.test.js`, `test/unit/entitlements.test.js`: REL-01
- [ ] `test/unit/sign-win.test.js`: REL-02
- [ ] `test/unit/sbom.test.js`, `test/unit/notices.test.js`, `test/unit/source-bundle.test.js`, `test/unit/workflows.test.js`: REL-03/04
- [ ] `test/e2e/scenarios.js` → `about_notices` scenario: REL-04
- [ ] `test/security/corpus.test.js` → `SPINARR_ENGINE_BIN` + sanitizer exit-code handling: SAFE-10
- [ ] CFLite standalone-run spike (Docker locally or a throwaway CI run) + unpatched-harness sanity check: SAFE-10

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (CI → Azure/Apple/GitHub) | OIDC federation (Entra, Sigstore), ASC API key, App tokens; no passwords in CI |
| V3 Session Management | no | — |
| V4 Access Control | yes | Environment `release` with tag rule; job-scoped `permissions`; `contents: write` only on the release job; private draft advisories |
| V5 Input Validation | yes | New IPCs take no arguments; fuzz inputs are confined to harnesses; notices rendered via `textContent` |
| V6 Cryptography | yes | Apple notarization, Authenticode via Artifact Signing, Sigstore. Never hand-roll. |
| V10 Malicious Code / V14 Config (supply chain) | yes | SHA-pinned actions, digest-pinned images, pinned PS module, no caches in publishing workflows, zizmor, Immutable Releases, attestations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PR workflow exfiltrates signing secrets | Information disclosure | Secrets only in environment `release` (tag-gated); no `pull_request_target`; `persist-credentials: false` |
| Swapped installer + checksum on a mutable release | Tampering | Immutable Releases + attestations + cosign bundle |
| Malicious PSGallery module version | Tampering / Elevation | `Import-Module -RequiredVersion` in the hook; no electron-builder auto-install |
| Fuzz crash input disclosed before fix | Information disclosure | No public artifacts or logs; private corpus repo; draft advisories |
| Renderer opens an arbitrary URL | Spoofing | Fixed URL built in main; no-arg IPC |
| Cache poisoning into release artifacts | Tampering | No caches in `release.yml` (existing rule) |
| Template injection in new workflows | Tampering | No `${{ github.event.* }}` in `run:`; zizmor gate |
| Attested digest ≠ shipped file | Repudiation | Attest in the release job over final, stapled, signed bytes; self-verify before upload |

## Sources

### Primary (HIGH confidence)
- electron-builder 26.15.3 installed source: `app-builder-lib/out/{macPackager.js, mac/MacTargetHelper.js, codeSign/macCodeSign.js, codeSign/windowsSignAzureManager.js, codeSign/windowsSignToolManager.js, codeSign/windowsCodeSign.js, winPackager.js, electron/electronMac.js}`, `dmg-builder/out/dmg.js`, `scheme.json`, `templates/entitlements.mac.plist`
- Pinned engine sources in `engine/deps/`: `libdvdread-7.1.1/src/dvdread/{dvd_reader.h,dvd_filesystem.h}`, `libbluray-1.5.0/src/{libbluray/bluray.h,file/filesystem.h}`, `contrib/libudfread`, meson.build files
- Repo: `.github/workflows/{release,ci}.yml`, `package.json`, `engine/build.sh`, `engine/{dvdinfo,bdinfo}.c`, `test/security/*`, `app/{main,preload,platform}.js`, `app/renderer/index.html`, `README.md`, `SECURITY.md`, `docs/RELEASING.md`
- `google/clusterfuzzlite` `actions/{build,run}_fuzzers/action.yml`, docs `github_actions.md`, `gitlab.md`; `google/oss-fuzz` `infra/cifuzz/{run_fuzzers.py, clusterfuzz_deployment.py, filestore_utils.py, filestore/git, filestore/github_actions, platform_config/*, workspace_utils.py, config_utils.py}` (GitHub API, 2026-10-12)
- `Azure/artifact-signing-action` `action.yml` at main and v2.0.0 (GitHub API)
- `actions/attest` `action.yml` + README @ v4.2.2
- CycloneDX `bom-1.6.schema.json` (raw GitHub); cyclonedx-cli README
- https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart (updated 2026-10-08)
- https://learn.microsoft.com/en-us/powershell/module/powershellget/install-module
- https://docs.github.com/en/rest/security-advisories/repository-advisories
- https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts
- https://www.powershellgallery.com/packages/TrustedSigning , https://www.powershellgallery.com/packages/ArtifactSigning
- GitHub releases API (2026-10-12): actions/attest v4.2.2, cosign-installer v4.1.2, cosign v3.1.3, azure/login v3.1.0, harden-runner v2.22.1, action-gh-release v3.0.3, cyclonedx-cli v0.33.1, syft v1.54.1, create-github-app-token v3.2.0, artifact-signing-action v2.0.0
- `gh api repos/rick-rami94/spinarr/immutable-releases` → `{"enabled":false}`; `gh release list`

### Secondary (MEDIUM confidence)
- [Apple Developer Forums 675354 (Quinn, DTS)](https://developer.apple.com/forums/thread/675354): dmg `spctl` type
- [Entra flexible federated identity credentials](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-flexible-federated-identity-credentials) and [create trust](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust): no wildcards
- [Artifact Signing roles](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-resources-roles)
- notarytool Team vs Individual key: [notarytool man page](https://keith.github.io/xcode-man-pages/notarytool.1.html), [Apple forums 768634](https://developer.apple.com/forums/thread/768634), [boojy-notes PR #168](https://github.com/boojyorg/boojy-notes/pull/168)
- DMG notarization gap: [deciphertools blog](https://deciphertools.com/blog/notarizing-dmg/), [OpenCoven/chat#407](https://github.com/OpenCoven/chat/issues/407)

### Tertiary (LOW confidence)
- GitHub plan minute quotas (training knowledge; see A3)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Versions come from the registries and APIs today, and hooks are code-verified.
- Architecture: HIGH for signing and release. MEDIUM for the fuzz-run privacy design, which depends on the A1 spike.
- Pitfalls: HIGH. Most are verified from source code or official docs.

**Research date:** 2026-10-12
**Valid until:** 2026-11-12 (Azure Artifact Signing tooling and the module are moving fast; re-check the module version and action pins at execution)
