# Phase 2: Trust & Distribution - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning

<domain>
## Phase Boundary

A stranger can download a Spinarr release, verify where it came from, install it without a Gatekeeper or SmartScreen bypass, and get the GPL corresponding source. The engine's riskiest parsers are fuzzed continuously.

Requirements: REL-01 (macOS sign + notarize + staple app and dmg), REL-02 (Windows Azure Artifact Signing via OIDC, pinned module), REL-03 (build provenance, cosign-signed SHA256SUMS, SBOM from engine pins, Immutable Releases), REL-04 (GPL source bundle + in-app third-party notices), SAFE-10 (ClusterFuzzLite libFuzzer harnesses for libdvdread IFO and libbluray MPLS/CLPI, plus ASan replay of the malicious-disc corpus on every change).

Out of this phase: the Windows engine sandbox launcher (`spinarr-sandbox.exe`, Phase 4). Signing is re-run once the final engine binary set exists after Phase 4, so the signing pipeline must sign whatever `.exe` files are in `extraResources` without hard-coding the current list.

</domain>

<decisions>
## Implementation Decisions

### Signing accounts and timing (REL-01, REL-02)
- **D-01:** Apple: Rick is **enrolled** in the Apple Developer Program but has **no Developer ID Application certificate and no App Store Connect API key yet**. The phase must include a step-by-step runbook (in `docs/RELEASING.md`) for creating both and loading them as repo secrets. Notarization auth uses the App Store Connect API key triple (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`), replacing the current `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` secrets in `release.yml`.
- **D-02:** Azure Artifact Signing: **nothing is set up** (no subscription, no signing account, no identity validation). The runbook covers subscription → Artifact Signing account → individual identity validation → certificate profile → Entra app registration with an OIDC federated credential scoped to this repo's release workflow.
- **D-03:** Publisher identity on all signatures is the individual **Rick Ramirez**. No business entity, no D-U-N-S.
- **D-04:** **Build now, sign later.** Build the full signing, notarization, stapling, attestation, SBOM and source-bundle pipeline in this phase. Signing and notarization steps detect missing secrets and skip cleanly (they don't fail the build). Phase 2 is **not complete** until a real signed v0.2.0 draft exists and passes `spctl -a -vvv -t install` on the stapled dmg (and the app), plus `Get-AuthenticodeSignature` / `signtool verify /pa /all` on the installer and every engine exe. That final check is a human-in-the-loop item that waits on the accounts.

### Release flow (REL-03)
- **D-05:** The first release from the new pipeline is **v0.2.0**. 1.0 stays reserved for Phase 8.
- **D-06:** **Draft, Rick approves.** CI builds, signs, attests and uploads everything (installers, `SHA256SUMS.txt`, its `.sigstore.json` cosign bundle, SBOM, source tarball) into a **draft** release. Rick reviews it and publishes by hand. Turn on GitHub Immutable Releases. Because immutability applies at publish time, every asset must be uploaded while the release is still a draft.
- **D-07:** Unsigned-tag policy: **fail when secrets exist.** If the signing secrets are configured, a tag build that comes out unsigned or not notarized fails the release (e.g. `mac.forceCodeSigning: true` on tags, plus a post-build signature assertion). Before secrets exist, unsigned drafts are allowed but must be marked pre-release with an "unsigned" note in the release body.
- **D-08:** Existing v0.1.x releases: un-mark v0.1.3 as Latest, mark the v0.1.x releases as pre-release, and prepend a note to each: unsigned, macOS Gatekeeper and Windows SmartScreen will warn, use v0.2.0 or later. **Delete nothing.** This is an outward-facing `gh release edit`: the executor must stop and get Rick's explicit go before running it. Don't run it on its own initiative.

### Fuzz crash handling (SAFE-10)
- **D-09:** New fuzz crashes are reported as a **private draft GitHub Security Advisory** (visible only to Rick), opened by the nightly job with the stack trace. Crashing inputs are **never** uploaded as public CI artifacts or issues. PR runs that find a new crash fail the check with a message pointing to the private advisory, without exposing the input.
- **D-10:** Corpus and crash reproducers live in a **separate private repo** (e.g. `rick-rami94/spinarr-fuzz-corpus`), read and written by ClusterFuzzLite with a narrowly scoped token. After a fix ships, the minimized reproducer moves into the public `test/security` corpus as a regression case.
- **D-11:** Budget: **10-minute code-change fuzzing** on PRs that touch engine code, a **1-hour batch per target nightly**, and weekly corpus pruning and coverage. The ASan replay of the existing malicious-disc corpus runs on every change.
- **D-12:** Fix flow: fix as a numbered patch in `engine/patches/` (as with the existing fuzz fixes), report privately to upstream (VideoLAN), and send the patch upstream after a Spinarr release ships it.

### License notices and source (REL-04)
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack and prescriptions
- `CLAUDE.md` — Technology Stack, especially "Per-capability prescriptions" §1 (macOS signing + notarization), §2 (Windows signing), §3 (release provenance), §7 (fuzzing in CI), the Version Compatibility table, and "What NOT to Use".
- `.planning/research/` — project research files (stack, pitfalls) behind the CLAUDE.md prescriptions.

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` — REL-01..REL-04, SAFE-10 (audit refs SF-4, SF-8, R-13).
- `.planning/ROADMAP.md` — Phase 2 goal and success criteria. Phase 4 note: re-run signing once the final engine binary set exists.
- `.planning/PROJECT.md` — Key Decisions (pay for signing; Azure Artifact Signing).

### Existing release and security setup
- `.github/workflows/release.yml` — current 5-target build, draft release, `SHA256SUMS.txt`, and the old signing-secret wiring to replace.
- `.github/workflows/ci.yml` — SHA-pinned actions, required checks (`macos`, `linux`, `windows`, `audit`); do not rename job ids.
- `docs/RELEASING.md` — current release runbook; becomes the account-setup and signing runbook.
- `package.json` `build` section — electron-builder config (`mac.hardenedRuntime`, entitlements, `electronFuses`, `extraResources`).
- `build/entitlements.mac.plist` — currently used for both app and inherited binaries (SF-6); to be split.
- `engine/build.sh` — pin table (name, version, url, sha256): the source of truth for SBOM, notices and the source bundle.
- `engine/patches/` — local patches (fuzz fixes) to include in the source bundle and SBOM pedigree.
- `test/security/` — malicious-disc corpus (`corpus.test.js`, `fuzz_dvdinfo.py`, `fuzz_bdinfo.py`), the input to the ASan replay job.
- `SECURITY.md` — disclosure policy; fuzz advisories must be consistent with it.

### Audit
- `~/projects/spinarr-audit/SPINARR_ENGINEERING_AUDIT.md` (outside the repo, not committed) — findings SF-4 (unsigned/mutable releases), SF-6 (entitlements), SF-8 (no real fuzzing), R-13 (GPL notices/source).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `release.yml` matrix (macos-15, macos-15-intel, ubuntu-22.04, ubuntu-22.04-arm, windows-latest) and its draft-release job: extend rather than replace.
- `engine/build.sh` pin table with SHA-256 verification: feed it to the SBOM, notices and source-bundle generators.
- `test/security/fuzz_dvdinfo.py` / `fuzz_bdinfo.py` and the existing corpus: seeds for the libFuzzer harnesses and inputs for the ASan replay.
- `engine/dvdinfo.c` / `engine/bdinfo.c`: show exactly which libdvdread/libbluray APIs Spinarr calls, which the harnesses should exercise.
- Settings view in `app/renderer/app.js` plus the skin system (`lib.SKINS`): host for the About section.

### Established Patterns
- Every GitHub Action is pinned by full SHA with a version comment; Dependabot keeps them fresh. New actions (attest, cosign-installer, CFLite, Azure login) must follow this.
- Required CI checks are `macos`, `linux`, `windows`, `audit`; don't add a `name:` or `paths:` filter to them. New fuzz/release jobs can be added but must not orphan required checks.
- Branch protection on `main` is enforced for admins (Phase 1 D-08); release work merges through PRs.
- Engine patches are numbered per library (`ffmpeg-000N`, `libdvdread-000N`, `libbluray-000N`).
- Repo-local git identity, no Claude co-author trailers.

### Integration Points
- `release.yml` electron-builder step: signing env (`CSC_LINK`, API key triple, `azureSignOptions`).
- `package.json` `build.mac` / `build.win`: `sign` hook, `forceCodeSigning`, `azureSignOptions`, `signExts`.
- New workflows: fuzzing (PR + nightly + weekly), ASan replay (every change).
- `app/renderer/app.js` Settings + `app/main.js` IPC for opening the source link externally.

</code_context>

<specifics>
## Specific Ideas

- The account runbook should be something Rick can follow click by click, ending with exactly which repo secrets / variables to add and how to confirm each.
- The "unsigned" pre-release note and the v0.1.x warning should point users to v0.2.0+ and explain Gatekeeper/SmartScreen honestly rather than telling them to bypass it.
- Expect SmartScreen "unrecognized app" warnings on the first signed Windows releases regardless (reputation builds over time); say so in the README instead of advising a bypass.

</specifics>

<deferred>
## Deferred Ideas

- Linux package signing (GPG-signed deb repo / AppImage signatures): not discussed; the cosign-signed SHA256SUMS + attestations cover Linux artifacts for now.
- README "how to verify a release" section (`gh attestation verify`, `cosign verify-blob`): small and likely folded into REL-03 by the planner; not a separate decision.
- Contributing the libdvdread/libbluray harnesses to OSS-Fuzz: post-1.0 (per stack research).
- SignPath Foundation free OSS signing: revisit after 1.0.

</deferred>

---

*Phase: 02-trust-distribution*
*Context gathered: 2026-10-12*
