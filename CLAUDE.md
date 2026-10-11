<!-- GSD:project-start source:PROJECT.md -->
## Project

**Spinarr**

Spinarr is an open-source (GPL-3.0) desktop app for macOS, Windows and Linux that rips DVDs and Blu-rays to MKV losslessly. It copies streams bit for bit, with no re-encoding. It is for **Plex and Jellyfin collectors**: people backing up a shelf of discs they own into a media server, who want it easy, correct and safe, without becoming disc-format experts. It is a friendlier, auditable alternative to MakeMKV.

This milestone takes Spinarr from a credible prototype (v0.1.3) to a **v1.0 public release**: one you'd point strangers at, signed, sandboxed everywhere, and validated on real discs.

**Core Value:** **Every rip is a complete, bit-exact copy of what's on the disc, or it fails loudly. Opening a disc can never compromise the user's computer.** Correctness and safety come before features and polish.

### Constraints

- **Security:** The engine must never gain network access, and disc data is always untrusted. Any network feature (TMDB) lives in the main process with validated, minimal requests — the core-value promise
- **Legal:** Never bundle or fetch decryption libraries or keys — DMCA §1201 exposure
- **Budget:** Apple Developer Program ($99/yr) and Windows signing (Azure Trusted Signing or an OV cert) are approved
- **Hardware:** Real-drive testing only on the Intel Mac; other OSes go through VM USB passthrough and beta testers — what's available
- **Tech stack:** Keep Electron + plain HTML/CSS/JS + a statically built, patched ffmpeg engine; no UI framework — existing architecture is sound (audit Architecture 7/10)
- **Compatibility:** macOS 12+, Windows 10/11 x64, Linux glibc ≥ 2.35 (x64/arm64) — current installer targets
- **Licensing:** GPL-3.0-or-later; third-party GPL/LGPL obligations must be met in binaries
- **Git:**
  - Repo-local identity `Rick Ramirez <30266247+rick-rami94@users.noreply.github.com>`
  - No Claude co-author trailers
  - Milestone work happens on branches, not directly on `main`
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies (new for v1.0)
| Technology | Version | Purpose | Why Recommended | Confidence |
|---|---|---|---|---|
| Apple Developer ID Application cert + `notarytool` (via `@electron/notarize`, bundled with electron-builder) | `@electron/notarize` 2.5.0 as bundled (3.1.2 is latest upstream); Xcode `notarytool` on the `macos-15` runners | Sign and notarize the `.app`; notarize and staple the `.dmg` too | This is Apple's only path that avoids the Gatekeeper bypass (SF-4). electron-builder already wires up `notarytool` from env vars. | HIGH |
| App Store Connect API key (`.p8`) for notarization | n/a | Notary auth in CI: `APPLE_API_KEY` (path to `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | electron-builder 26 accepts this triple (code-verified). It avoids an Apple ID password plus 2FA app-specific password in CI secrets, and the key can be revoked on its own. Replace the current `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` secrets. | HIGH |
| Custom `mac.sign` hook wrapping `@electron/osx-sign` | `@electron/osx-sign` 1.3.3 as bundled | Per-binary entitlements: the app gets `allow-jit` only; only `Contents/Resources/engine/*` gets `disable-library-validation` | electron-builder only tells two cases apart: the app bundle gets `entitlements`, and everything else, helpers *and* engine binaries alike, gets `entitlementsInherit` (code-verified, `MacTargetHelper.getOptionsForFile`). A custom `sign` function receives the `opts` object, including `optionsForFile`, and runs **before** notarization (code-verified, `macPackager.js:318-334`). Wrap `optionsForFile` so engine paths get `build/entitlements.engine.plist`. This closes SF-6 without a second signing pass. | HIGH |
| Azure Artifact Signing (formerly Trusted Signing) via `win.azureSignOptions` | Basic plan, about $9.99/month; PowerShell module `TrustedSigning` ≥ 0.5.0 (installed by electron-builder) | Authenticode for the app `.exe`, the engine `.exe` files and the NSIS installer | Microsoft now recommends it for non-Store distribution. Individuals in the **USA and Canada** are eligible, and Rick is in the US. It needs no HSM token, which OV certs have required since June 2023, and it is cheaper than OV ($150–300/yr) or EV ($400+/yr). SmartScreen treats it the same as OV/EV: **EV no longer gets instant reputation (since 2024)**. electron-builder 26 supports it natively (`publisherName`, `endpoint`, `certificateProfileName`, `codeSigningAccountName`; code-verified). | HIGH |
| `actions/attest` (provenance + SBOM modes) | v4.2.2 (2026-08-04) | SLSA build provenance for every installer and `SHA256SUMS.txt`; SBOM attestation | `attest-build-provenance` v4 is now "simply a wrapper on top of `actions/attest`", and new work should use `actions/attest` (per its README). It is free for public repos, uses Sigstore keyless signing, and users verify with `gh attestation verify`. | HIGH |
| GitHub Immutable Releases (repo setting) | GA 2025-10-28 | Lock tags and assets after publish; GitHub auto-generates a release attestation (`gh release verify`, `gh release verify-asset`) | Directly fixes "SHA256SUMS hosted next to the files it covers and mutable" (SF-4). It costs nothing. | HIGH |
| `cosign sign-blob` (keyless, bundle format) | cosign v3.1.3; `sigstore/cosign-installer` v4.1.2 | Signs `SHA256SUMS.txt` → `SHA256SUMS.txt.sigstore.json` | Lets users without `gh` verify the checksums with `cosign verify-blob --bundle ... --certificate-identity <release.yml@refs/tags/vX> --certificate-oidc-issuer https://token.actions.githubusercontent.com`. cosign v3 makes the new bundle format mandatory for `sign-blob`, so use `--bundle` and drop the old `.sig/.pem` pairs. | HIGH |
| Small C launcher `spinarr-sandbox.exe` (AppContainer + Job Object), built with the existing MSYS2/MinGW toolchain | New code, ~400–700 lines of C | Windows engine sandbox (SF-1) | Node's `child_process` cannot pass `STARTUPINFOEX` / `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`, so a native step is unavoidable. A standalone helper `.exe` beats a Node addon or FFI: no Electron ABI rebuilds, it keeps native code out of the main process, it can be tested on its own, it is built by the toolchain `engine/build.sh` already uses, and electron-builder Authenticode-signs `.exe` files in `extraResources` automatically (code-verified, `winPackager.createTransformerForExtraFiles`). | MEDIUM (design); LOW for optical-device access (see below) |
| Vendored `bwrap` + path-scoped AppArmor profile (deb) | bubblewrap 0.13.0 (2026-09-22), built from pinned source in `engine/build.sh` | Linux engine sandbox that works on Ubuntu 24.04+ (SF-7) | Ubuntu 24.04+ sets `kernel.apparmor_restrict_unprivileged_userns=1`. `/usr/bin/bwrap` has **no** userns profile by default, and `bwrap-userns-restrict` is experimental and off. Profiling `/usr/bin/bwrap` yourself grants userns to every caller (Flatpak, Steam, scripts), and **two vendors profiling the same path breaks bwrap system-wide** (openai/codex#38715). A Spinarr-owned bwrap at `/opt/Spinarr/resources/engine/bwrap` with its own `flags=(unconfined) { userns, }` profile is the pattern used by Apptainer and claude-desktop-debian. Ship it through electron-builder's `linux.appArmorProfile` option (code-verified). | MEDIUM |
| Precompiled seccomp BPF blobs (generated at build time with libseccomp) passed via `bwrap --seccomp FD` | libseccomp 2.6.1 (build-time only); one blob each for x86_64 and aarch64 | Syscall filter for the engine | This is how Flatpak does it: build the filter with libseccomp, export with `seccomp_export_bpf`, hand bwrap a file descriptor. Generating at build time means no runtime dependency, and Node passes the fd through `spawn(..., { stdio: ['ignore','pipe','pipe', bpfFd] })` with `--seccomp 3`. | MEDIUM |
| ClusterFuzzLite + libFuzzer + ASan/UBSan | `google/clusterfuzzlite/actions/{build,run}_fuzzers@v1` (pin by SHA) | Coverage-guided fuzzing of IFO, MPLS/CLPI and VOB/NAV in PR and nightly jobs; ASan replay of the crash corpus | OSS-Fuzz's ffmpeg build does **not** enable libdvdread/libdvdnav, and libdvdread, libdvdnav and libbluray have **no** OSS-Fuzz project (verified against `google/oss-fuzz/projects`). Spinarr's fuzzing covers real gaps. CFLite gives PR "code-change" mode, scheduled batch, corpus pruning and coverage reports with OSS-Fuzz-compatible harnesses. | MEDIUM-HIGH |
| TMDB API v3 endpoints with a **user-supplied** API Read Access Token (Bearer) | TMDB API v3 (`api.themoviedb.org/3`); auth via the v4-style read-access token | Opt-in title/year/episode lookup from the main process | TMDB staff say embedding a public key "puts you at risk of having it shutdown", and they "kill API keys fairly often". Bring-your-own-key (the Radarr/Sonarr model) keeps Spinarr's availability out of one shared key's hands. The free tier covers non-commercial use with attribution. | HIGH (terms), MEDIUM (key policy is a judgment) |
| `c8` over `node --test` | c8 12.0.0 (2026-07-14) | Coverage with thresholds for unit, security and engine suites, plus Electron main-process e2e coverage via `NODE_V8_COVERAGE` | Node's built-in `--experimental-test-coverage` is still **Stability 1 – Experimental** in Node 26.11.1. c8 is stable, supports `--all` (unloaded files count as 0), `--check-coverage` thresholds and lcov, and merges child-process coverage written through `NODE_V8_COVERAGE`. | HIGH |
| VMware Fusion Pro (free) | 25H2 confirmed for Intel hosts; check that 26H1 still lists Intel host support before installing | USB passthrough of the LG GP63EX70 and BU40N into Windows 11 and Ubuntu guests | Free for all use since Nov 2024. 25H2 supports Intel hosts. Whole-device USB passthrough lets the **guest's** `cdrom.sys` / `sr` driver issue REPORT KEY / SEND KEY (CSS) and AACS MMC commands, unlike "host CD/DVD" emulation. | MEDIUM |
### Supporting Libraries and Tools
| Library / Tool | Version | Purpose | When to Use | Confidence |
|---|---|---|---|---|
| `Azure/artifact-signing-action` | v2.0.0 (2026-05-14) | Standalone signing on Windows runners with OIDC | Only if you sign *outside* electron-builder, for example re-signing a stray artifact. Inner app and engine `.exe` files must be signed **before** NSIS packs them, so electron-builder's `azureSignOptions` remains the primary path. | HIGH |
| `azure/login` with OIDC federated credential | current major, SHA-pinned | Gives the TrustedSigning module (DefaultAzureCredential chain) a short-lived Entra token | Preferred over a stored `AZURE_CLIENT_SECRET`. If OIDC proves painful, fall back to `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` env vars (EnvironmentCredential), scoped to a dedicated signing-only app registration. | MEDIUM |
| CycloneDX 1.6 SBOM generated from `engine/build.sh` pins (small in-repo script) | spec 1.6 | SBOM listing Electron, ffmpeg, libdvdread, libdvdnav, libbluray, bubblewrap and toolchain, with source SHA-256 and patches as `pedigree` | Always. Spinarr has **zero runtime npm dependencies**, so `@cyclonedx/cyclonedx-npm` (6.0.1) would emit a near-empty SBOM, and `syft` (1.54.1) cannot identify a statically linked ffmpeg. The engine pin table is the real bill of materials. The same table also generates `THIRD_PARTY_NOTICES` (R-13). | HIGH |
| `anchore/syft` / `anchore/sbom-action` | syft 1.54.1 / action v0.24.3 | Cross-check SBOM of the unpacked app (Electron's bundled licenses, etc.) | Optional sanity check on the hand-built SBOM. Not the source of truth. | MEDIUM |
| `zizmor` | v1.30.1 | Static analysis of GitHub workflows (template injection, `pull_request_target`, credential persistence, unpinned actions) | In CI on every workflow change (SF-5) | HIGH |
| `pinact` | v5.0.0 | Rewrites `uses: x@vN` to full commit SHAs with a `# vN` comment | Once now, then Dependabot (`github-actions` ecosystem) keeps the SHAs updated | HIGH |
| `step-security/harden-runner` | v2.22.1 | Egress audit/block on runners | Release and fuzz jobs. Start in `audit` mode, then move to `block` with an allow-list. | MEDIUM |
| `ossf/scorecard-action` | v2.4.4 | Supply-chain posture score and badge | Nice to have once branch protection is on | MEDIUM |
| NtObjectManager (PowerShell, from `googleprojectzero/sandbox-attacksurface-analysis-tools`) | v2.0.0 | **Spike tool**: read device and file SDs, create AppContainer tokens, test `\\.\D:` / `\Device\CdRom0` access | Phase spike before committing to the Windows sandbox design. James Forshaw's toolkit is the standard way to test "can an AppContainer open X". | HIGH (tool), LOW (outcome unknown) |
| Electron `safeStorage` | built into Electron 44 | Encrypt the user's TMDB token at rest (Keychain / DPAPI / libsecret) | TMDB feature | HIGH |
| Electron `net.fetch` | built into Electron 44 | TMDB HTTP from the main process (respects system proxy settings) | TMDB feature. The renderer CSP stays `connect-src 'none'`. | HIGH |
| `monocart-coverage-reports` | 2.13.2 | Merge renderer V8 coverage (CDP `Profiler.takePreciseCoverage`) with main-process coverage | Only if renderer coverage from e2e is wanted. It handles Chromium and Node V8 coverage in one report. | MEDIUM |
### Development Tools
| Tool | Purpose | Notes |
|---|---|---|
| clang/LLVM 18+ on `ubuntu-24.04` (or the OSS-Fuzz `base-builder` image through CFLite) | libFuzzer + ASan/UBSan builds of `dvdinfo`/`bdinfo` harnesses and the patched libs | Add `sudo sysctl vm.mmap_rnd_bits=28` before running ASan binaries on GitHub runners. High-entropy ASLR (`mmap_rnd_bits=32`) causes `AddressSanitizer:DEADLYSIGNAL` with older LLVM (runner-images#9515). Apple clang has no libFuzzer runtime, so fuzz on Linux only. |
| `xcrun notarytool` / `xcrun stapler` | Notarize and staple the DMG after electron-builder | electron-builder notarizes and staples the **.app** only. The dmg it then builds has no ticket. Add a step: `codesign` the dmg with Developer ID → `notarytool submit --wait` → `stapler staple`. Offline first launch then works. |
| `spctl -a -vvv -t install`, `codesign --verify --deep --strict`, `codesign -d --entitlements :-` | CI assertion that the app is accepted, and that only the engine binaries carry `disable-library-validation` | Turns SF-4 and SF-6 into regression tests |
| `Get-AuthenticodeSignature` / `signtool verify /pa /all` | CI assertion that the installer, the app exe, every engine exe and `spinarr-sandbox.exe` are signed and timestamped | Windows release job |
| `log stream --predicate 'sender == "Sandbox"'` (macOS) | Find SBPL denials while building the deny-default profile | Turn on `(debug deny)` only in test builds |
| `strace -f -c` / `scmp_sys_resolver` (Linux) | Enumerate engine syscalls per arch when tuning seccomp | Run against real scans of DVD, BD and ISO, and the CSS/AACS paths |
| `apparmor_parser --skip-kernel-load --debug` | Validate the shipped AppArmor profile in CI (the deb postinst already does a dry run) | electron-builder's postinst silently skips the profile when the AppArmor ABI is too old (22.04), which is fine |
## Per-capability prescriptions
### 1. macOS signing + notarization (SF-4, SF-6)
- **Entitlement files.** Split into three:
- **Signing hook.** Set `mac.sign: "build/sign-mac.js"`. It wraps `opts.optionsForFile` so that any path under `Contents/Resources/engine/` returns the engine plist, then calls `@electron/osx-sign`'s `sign()`. Keep `hardenedRuntime: true` and the default secure `timestamp`. Hardened runtime plus secure timestamp on **every** Mach-O, engine included, is a notarization requirement. osx-sign walks `Resources/` and signs those binaries automatically.
- **Notary auth.** Use the API key triple: `APPLE_API_KEY` = a path written from a base64 secret at job start, plus `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. The cert stays `CSC_LINK` / `CSC_KEY_PASSWORD` (`.p12`, base64).
- **CI gate.** Set `mac.forceCodeSigning: true` on tag builds, so an unsigned build cannot be published as a release.
- **Fuses interaction.** `resetAdHocDarwinSignature: true` is fine. It only matters for ad-hoc builds.
### 2. Windows signing (SF-4)
- **Signing config.** Use `win.azureSignOptions` with `publisherName`, `endpoint` (for example `https://eus.codesigning.azure.net/`), `codeSigningAccountName` and `certificateProfileName`. File digest and timestamp default to SHA256 and `http://timestamp.acs.microsoft.com` (code-verified).
- **What gets signed.** electron-builder signs `Spinarr.exe`, every `.exe` in `extraResources` (engine and `spinarr-sandbox.exe`), and the NSIS installer and uninstaller. Add `signExts: [".dll"]` only if a DLL is ever shipped. Today none are; libdvdcss is user-supplied.
- **Supply-chain note.** electron-builder runs `Install-Module -Name TrustedSigning -MinimumVersion 0.5.0` from PSGallery, which is **unpinned** (code-verified). Mitigate by pre-installing a pinned version in an earlier step: `Install-Module TrustedSigning -RequiredVersion <x>`. The later install is then a no-op.
- **SmartScreen expectation.** Expect "unrecognized app" warnings on the first releases whatever the cert type. Reputation builds per consistent publisher identity and download volume. Document this in the README instead of telling users to bypass it.
- **Alternative.** SignPath Foundation offers free OSS signing (Microsoft lists it). The project is two days old with one maintainer, so eligibility is doubtful. Revisit after 1.0.
### 3. Release provenance (SF-4)
- **Release job.** After download-artifact: compute `SHA256SUMS.txt`, then:
- **Job permissions.** `id-token: write`, `attestations: write`, `contents: write`. Scope `contents: write` to the publish job only.
- **Publishing.** Turn on Immutable Releases. Publish with `gh release create --draft`, or a SHA-pinned `softprops/action-gh-release` v3.0.3. Then un-draft manually. Immutability applies on publish, so upload everything, including the `.sigstore.json` bundle, while the release is still a draft.
- **Not minisign** (jedisct1/minisign 0.12, last release Jan 2025). A long-lived private key held by one maintainer is a key-loss and compromise liability. Keyless Sigstore ties the signature to the workflow identity instead.
### 4. Windows engine sandbox (SF-1): the riskiest item
- **Raw optical device from the AppContainer: LOW confidence it works.** AppContainer access checks only count the package SID, capabilities and ALL APPLICATION PACKAGES. *Everyone* does not count. Device objects often lack an ALL APPLICATION PACKAGES ACE: `\Device\Null` does, which breaks `NUL` inside AppContainers (landstrip#204). Changing a device DACL needs admin and may not persist.
- **Reading files on the mounted disc (`D:\VIDEO_TS`, `D:\BDMV`) from the AppContainer.** UDF/CDFS security descriptors are supplied by the file system and cannot be ACL-edited (read-only media). Unknown, so test it.
- **`NUL` device** is inaccessible inside the AppContainer. Make sure ffmpeg never opens `NUL`: use `-f null -` to a pipe, not to `NUL`.
- **Network shares and NAS output** (common for Plex/Jellyfin users). A zero-capability AppContainer cannot reach SMB. Always write to a local staging folder, then have the **main process** move the file to its final destination. Do the same on all OSes, for symmetry with the atomic-output work in SF-10.
- **Spike passes** (device and disc filesystem are readable from the AppContainer): ship AppContainer for every input.
- **Spike fails for physical discs only:**
- **Do not** try LPAC for 1.0. It strips ALL APPLICATION PACKAGES as well, so device and system access gets *harder*, not easier.
- Microsoft Learn "Implementing an AppContainer" and the Pavel Yosifovich ("Fun with AppContainers") and blahcat ("Cheap sandboxing with AppContainers") samples: launch plus ACL grant code.
- M2Team/Privexec 5.1.0: a C++ AppContainer launcher.
- The Chromium sandbox (`sandbox/win`), also used by Firefox: the restricted-token levels and job-object UI limits. Too big to vendor; read it for policy.
- google/sandboxed-api: Linux-only (Sandbox2).
- Windows Sandbox: a Hyper-V VM, Pro/Enterprise only, no per-process use.
- Microsoft MXC / `CreateProcessInSandbox`: an `Experimental_` API on Insider builds (2026). Revisit after 1.0.
### 5. macOS deny-default SBPL (SF-2)
- Pass the **resolved** Homebrew `Cellar/<lib>/<ver>/lib` directories, and their dependency dirs (libaacs → libgcrypt, libgpg-error), as parameters. Do not pass `/usr/local` or `/opt/homebrew`.
- Use `literal` / `subpath` only. Never splice paths into the profile text (the current `-D` param approach is correct).
- **No `mach-lookup`.** This kills the pasteboard, LaunchServices, windowserver, tccd and securityd lookups the audit found.
- **No `network*`.**
- **No `/private/tmp` reads.**
- Recommendation: support **VUK-from-KEYDB only** inside the deny-default sandbox for 1.0, and fail with a specific message when only device keys or a host cert are available.
- Alternatively, add a separate narrowly-scoped "aacs-mmc" profile variant that is reviewed on its own.
### 6. Linux seccomp + bwrap on Ubuntu 24.04+ (SF-7)
- **Filter generator.** Write `engine/seccomp-gen.c`, linked against libseccomp-dev at build time. It emits `seccomp-<arch>.bpf` into `engine/bin`.
- **Policy.** Use **default-allow with an explicit deny list** (the Flatpak model), not an allow-list. An allow-list for ffmpeg plus glibc plus a user-supplied libdvdcss/libaacs breaks whenever glibc or distro versions drift.
- **Deny with `EPERM`:**
- **Fork control.** `clone` without `CLONE_THREAD` → `EPERM` blocks fork while keeping ffmpeg threads. Return **`ENOSYS` for `clone3`**, as Flatpak does, because seccomp cannot inspect `clone3` flags and glibc falls back to `clone`.
- **Foreign architectures.** Add the non-native ABIs (i386 and x32 on x86_64) with a deny-all action.
- **Keep `ioctl(SG_IO)` allowed.** libaacs and libdvdcss need it on `/dev/sr*`.
- **`execve` cannot be denied in a bwrap-loaded filter.** bwrap installs the filter *before* it execs the engine. If blocking exec matters, add an in-process `prctl(PR_SET_NO_NEW_PRIVS)` + `seccomp()` call at the start of `dvdinfo`/`bdinfo` main (and an ffmpeg patch) that denies `execve`/`execveat` after startup. Treat this as an optional hardening step, flagged as a later phase.
- **bwrap selection.** Order:
- **Packaging.** Ship the AppArmor profile through `linux.appArmorProfile`, merged with electron-builder's own app profile, which also allows `userns` for Electron's sandbox on 24.04+ (code-verified template). The **AppImage cannot install a profile** (no root). On 24.04+ the AppImage's engine sandbox will only work where the user has relaxed userns. The AppImage is therefore a "reduced isolation" channel unless the probe passes. Say so in the docs, and make the deb the recommended Ubuntu install.
- **CI matrix.** `ubuntu-22.04`, `ubuntu-24.04` and `ubuntu-26.04` (all exist in runner-images). Set `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1` explicitly on 24.04/26.04 so tests reflect a stock desktop whatever the runner default is. Run two variants: installed `.deb` (profile loaded, probe passes) and AppImage (probe fails → no auto-scan).
### 7. Fuzzing in CI (SF-8)
- **`fuzz_dvd_ifo`.** Uses libdvdread's stream API (`DVDOpenStream2` with `pf_seek`, `pf_read`, `pf_readv` over an in-memory buffer). The input is a small UDF image, seeded with the synthetic fixture ISOs. Exercises `ifoOpen` and the title/PGC/cell tables, then `DVDOpenFile` + `DVDReadBlocks` on VOBs. That also covers NAV packets via libdvdnav `dvdnav_open_stream`.
- **`fuzz_bd_mpls_clpi`.** Uses libbluray `bd_open_files()` with in-memory `dir_open` / `file_open` callbacks serving a synthetic BDMV tree whose MPLS/CLPI/index.bdmv bytes come from the fuzzer. Then `bd_get_titles` / `bd_get_title_info` for every playlist. That is exactly what `bdinfo` does.
- **ffmpeg.** OSS-Fuzz already fuzzes the `mpegps` demuxer (VOB container) through `tools/target_dem_fuzzer.c`. Spinarr only needs to fuzz the **dvdvideo demuxer glue and the six local patches**. `target_dem_fuzzer` feeds data through AVIO, and the `dvdvideo` demuxer opens a *path* through libdvdread. That means a custom harness: write the fuzz input to a tmpfs ISO and call `avformat_open_input` with `-f dvdvideo`. Low throughput but meaningful. Mark as phase-specific research.
- **CI.** ClusterFuzzLite in `code-change` mode on PRs (10 minutes), `batch` nightly (1 hour per target), `prune` weekly, and `coverage` weekly. Store the corpus in a separate branch or storage repo.
- **ASan replay.** Add a plain job that builds the existing `test/security` corpus scanners with ASan/UBSan and replays all 70 crash cases. This needs `vm.mmap_rnd_bits=28`.
- **Upstream.** Contributing the libdvdread and libbluray harnesses to OSS-Fuzz is a high-leverage post-1.0 move.
### 8. TMDB (collector workflow)
- **Endpoints.**
- **Auth header.** `Authorization: Bearer <read access token>`. The v4 read token works on v3 endpoints. Never put a v3 `api_key` query param in URLs, because it leaks into logs.
- **Key model.** **Bring your own token**, stored with `safeStorage`, with a "Get a free key" link and a test button. Do not embed a project key in a public repo; TMDB staff explicitly warn against it.
- **Rate limits.** About 40 requests per second, "could change at any time; respect the 429". Spinarr needs fewer than 5 requests per disc. Back off on 429 using `Retry-After`.
- **Terms (last updated 2023-10-20):**
- **Where it runs.** Main process only, through `net.fetch`.
- **Privacy.** The engine never sees the network. The query sent is only the disc volume label or the user-edited title.
### 9. Coverage
- **Unit, security and engine suites.** Run `c8 --all --src app --exclude 'test/**' --reporter=text --reporter=lcov --check-coverage --lines <baseline> node --test "test/unit/*.test.js" ...`. Start the thresholds at the measured baseline minus 1, then ratchet up.
- **e2e, main process.** Launch Electron (unpackaged `electron .`, so fuses don't apply) with `NODE_V8_COVERAGE=<dir>`. On test teardown, call `v8.takeCoverage()` through the `SPINARR_TEST` hook, then `c8 report --temp-directory <dir> --all`. Works per community evidence: MEDIUM.
- **e2e, renderer.** Optional. `webContents.debugger.attach()` → `Profiler.startPreciseCoverage`, then `takePreciseCoverage` at the end, merged with monocart. `preload.js` runs in an isolated world, so V8 coverage does not see it reliably.
- **C coverage of the scanners.** CFLite's `coverage` mode (clang source-based) covers the fuzz targets. The engine tests could also build `dvdinfo`/`bdinfo` with `--coverage` on Linux and produce `gcovr` output. Nice to have.
### 10. VM USB passthrough on the Intel Mac
- **Primary hypervisor.** **VMware Fusion Pro (free).** Use whole-device USB passthrough ("Connect to Windows/Linux" for the drive), never "CD/DVD → use physical drive". The emulated path does not forward vendor SCSI commands reliably.
- **Paid fallback.** **Parallels Desktop 26** (still supports Intel hosts and has its own USB passthrough), if Fusion has trouble with a specific drive.
- **Avoid VirtualBox** for this. MakeMKV users report USB-passthrough BD rips that recognize the drive but stall at 0 KB, or fail after a while.
- **Avoid UTM/QEMU usbredir** on a macOS host for mass storage. macOS's own storage driver claims the device, and reliability is unproven.
- **Acceptance test inside each guest:**
- **Region-change counter.** Do not let a guest OS change the drive's RPC-2 region. Only 5 changes are allowed, and the last one is permanent.
## Installation
# Dev dependencies (no new runtime deps; UI stays dependency-free)
# optional, only if renderer e2e coverage is wanted
# Linux build-time (engine/build.sh, CI): seccomp generator + vendored bwrap
# CI-only tools (pin by version or SHA in workflows)
#   zizmor 1.30.1 (pipx/uv), pinact 5.0.0, cosign 3.1.3 via sigstore/cosign-installer v4.1.2
#   actions/attest v4.2.2, Azure TrustedSigning PS module (pin -RequiredVersion), clusterfuzzlite@v1 (SHA)
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| Azure Artifact Signing | OV cert on a cloud HSM (DigiCert KeyLocker, SSL.com eSigner, Sectigo) | If identity validation for Artifact Signing stalls, or the Azure subscription is unwanted. SmartScreen behaviour is identical. |
| Azure Artifact Signing | SignPath Foundation (free for OSS) | After 1.0, once the project has history and users. Free, but approval-gated with a managed pipeline. |
| Azure Artifact Signing | EV cert | Never for SmartScreen: no instant reputation since 2024. Only for an enterprise procurement requirement. |
| Custom `mac.sign` hook | `mac.signIgnore` for the engine + `codesign` in `afterPack` | If the hook proves brittle across electron-builder upgrades. Pre-sign the engine in `afterPack` (before electron-builder signs the bundle), and skip it in osx-sign. The outer seal still covers it. |
| Helper `.exe` launcher | `koffi` 3.3.3 FFI or a N-API addon (node-addon-api 8.9.2) | Never for 1.0. It adds the first runtime npm dependency or an Electron-ABI native module to the *main* process, the most privileged component. |
| AppContainer | Restricted token + job object + low integrity | Only as the physical-disc fallback if the spike fails. It **cannot block network** unelevated, and low integrity breaks libaacs SPTI (write access). |
| Vendored bwrap + scoped AppArmor profile | Depend on `/usr/bin/bwrap` (deb `Depends: bubblewrap`) only | Keep it as a probed fallback. Alone it fails on stock Ubuntu 24.04+. |
| Vendored bwrap | `bwrap` with setuid | Never. Debian/Ubuntu ship it non-setuid, and adding setuid is a privilege-escalation surface. |
| Deny-list seccomp | Allow-list seccomp | Only after 1.0, with a strace-derived per-arch list tested on several distros. |
| ClusterFuzzLite | Plain clang libFuzzer job on `ubuntu-24.04` | A fine first step if the CFLite Docker image or build setup slows the phase down. Harnesses are portable to CFLite later. |
| c8 | `node --experimental-test-coverage` | When it leaves Experimental. It already supports thresholds and lcov in Node 22.8+. |
| cosign keyless | minisign 0.12 | If users ask for an offline, non-Sigstore verification path. Needs key-custody planning. |
| BYO TMDB token | Embedded project key (the Jellyfin model) | If BYO friction measurably hurts adoption. Then consider a tiny server-side proxy so no key is ever public, which adds a hosted service. |
| VMware Fusion | Parallels Desktop 26 | If a specific drive misbehaves under Fusion passthrough |
## What NOT to Use
| Avoid | Why | Use Instead |
|---|---|---|
| `APPLE_ID` + app-specific password for notarization | Ties CI to a personal Apple ID with 2FA quirks, and is harder to rotate | App Store Connect API key (`APPLE_API_KEY*`) |
| `entitlementsInherit` carrying `disable-library-validation` | Applies to every helper and nested binary, not just the engine (SF-6) | Custom `mac.sign` with per-path entitlements |
| `actions/attest-build-provenance` for new code | v4 is just a wrapper, and the README says to use `actions/attest` | `actions/attest@<sha> # v4.2.2` |
| Unsigned `SHA256SUMS.txt` on a mutable release | Whoever can edit the release can swap both files | Immutable Releases + attestations + cosign bundle |
| Mutable action tags (`@v4`) | Tag hijack risk (SF-5) | SHA pins via pinact + Dependabot |
| `pip install 'meson>=1.3'` unpinned | Floating build input | `pip install meson==<x.y.z>` with `--require-hashes`, or distro packages |
| A Node native addon or FFI for the Windows sandbox | Puts native code and Win32 handle juggling in the privileged main process | `spinarr-sandbox.exe` |
| Windows Sandbox / Hyper-V / WSL for the engine | Pro-only, heavyweight, no optical passthrough | AppContainer |
| LPAC for the engine (1.0) | Removes ALL APPLICATION PACKAGES too, making device and system DLL access harder | Regular AppContainer, zero capabilities |
| An AppArmor profile on `/usr/bin/bwrap` | Grants userns to every caller, and collides with other vendors' profiles, breaking bwrap system-wide | Profile attached to Spinarr's own bwrap path |
| `(allow default)` SBPL with deny-lists | Leaks Mach services, `/tmp` and stat (SF-2) | `(deny default)` with explicit allows |
| Allowing all of `/opt/homebrew` or `/usr/local` in SBPL | Any Homebrew-installed library or tool becomes loadable or readable | Resolved per-library `Cellar` directories as params |
| Treating the CI crash-corpus run as fuzzing | Non-sanitized, no coverage feedback (audit §4) | libFuzzer + ASan via CFLite, plus ASan corpus replay |
| VirtualBox USB passthrough for disc validation | Reported stalls with BD rips | VMware Fusion |
| Embedding a TMDB API key in the repo | TMDB kills exposed keys, which would take down everyone's lookup at once | BYO token + `safeStorage` |
## Stack Patterns by Variant
- Use AppContainer for every input type, auto-scan included.
- The engine never needs the network, and Windows matches macOS and Linux.
- Use AppContainer for ISO and folder inputs, plus a restricted-token + job-object fallback for physical discs, with auto-scan off and an explicit click.
- Because an honest, partial sandbox beats a false claim. Update the README and in-app copy to match.
- Sandbox probe fails → sandbox kind `none` → no auto-scan, plus a banner pointing to the `.deb`.
- Because the AppImage cannot install an AppArmor profile.
- Fail with a specific message on macOS and Windows sandboxed paths for 1.0.
- Because MMC needs DiskArbitration/IOKit on macOS and SPTI write handles on Windows, which widens the sandbox.
## Version Compatibility
| Package A | Compatible With | Notes |
|---|---|---|
| electron-builder 26.15.3 | `@electron/osx-sign` 1.3.3, `@electron/notarize` 2.5.0 (bundled) | The custom `mac.sign` hook should `require('@electron/osx-sign')` from electron-builder's own dependency tree, not a separately installed newer major, to avoid an options-shape mismatch |
| electron-builder 26.15.3 `azureSignOptions` | PowerShell `TrustedSigning` module ≥ 0.5.0; runners `windows-2022` / `windows-2025` | The module runs through PowerShell on the Windows runner. Signing cannot be done on Linux/macOS runners. |
| `actions/attest` v4.2.2 | `gh attestation verify` (gh ≥ 2.49) | Public repo, so it uses public-good Sigstore |
| cosign v3.1.3 | Bundle format only for `sign-blob` | Use `--bundle`; detached `.sig/.pem` outputs are gone |
| bubblewrap 0.13.0 | Kernel ≥ 5.12 if built with `-Dassume_kernel=5.12.0` | Do **not** set `assume_kernel`; glibc ≥ 2.35 targets (22.04, kernel 5.15) are fine either way, but leave the default for older-kernel distros |
| `bwrap --seccomp FD` | bubblewrap ≥ 0.1.x; `--add-seccomp-fd` ≥ 0.5.0 | Use `--seccomp` with a single combined filter for maximum compatibility if `/usr/bin/bwrap` on 22.04 (0.6.x) is the fallback |
| electron-builder deb AppArmor template | AppArmor ABI 4.0 (Ubuntu 24.04+) | Postinst dry-runs the profile and silently skips on 22.04, which is correct because 22.04 has no userns restriction |
| c8 12.0.0 | Node ≥ 20 (project requires ≥ 20; CI uses 22) | Use `--all` with `--src app` |
| VMware Fusion 25H2 | Intel host, macOS 15 | Check 26H1's host-support notes before upgrading |
| Ubuntu runner ASan | `vm.mmap_rnd_bits` must be ≤ 31 for older LLVM | `sudo sysctl vm.mmap_rnd_bits=28` |
## Sources
- **electron-builder 26.15.3 installed source** (`node_modules/app-builder-lib/out/mac/MacTargetHelper.js`, `macPackager.js`, `winPackager.js`, `codeSign/windowsSignAzureManager.js`, `templates/linux/*`, `scheme.json`): per-file entitlements, custom sign hook ordering, notarization env vars, Azure options, extraResources `.exe` signing, AppArmor template. **HIGH (code-verified).**
- npm registry (`npm view`), 2026-10-10: electron-builder 26.15.3, @electron/notarize 3.1.2, @electron/osx-sign 2.7.1 (latest; 1.3.3 bundled), c8 12.0.0, @cyclonedx/cyclonedx-npm 6.0.1, monocart-coverage-reports 2.13.2, koffi 3.3.3. **HIGH.**
- GitHub releases API, 2026-10-10: actions/attest v4.2.2, attest-build-provenance v4.2.2, cosign v3.1.3, cosign-installer v4.1.2, syft v1.54.1, sbom-action v0.24.3, bubblewrap v0.13.0, libseccomp v2.6.1, Azure/artifact-signing-action v2.0.0, zizmor v1.30.1, pinact v5.0.0, harden-runner v2.22.1, scorecard-action v2.4.4, softprops/action-gh-release v3.0.3, minisign 0.12, NtObjectManager tools v2.0.0. **HIGH.**
- [actions/attest-build-provenance README](https://github.com/actions/attest-build-provenance): "As of version 4 ... simply a wrapper on top of actions/attest". **HIGH.**
- [Microsoft Learn: Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) (updated 2026-08-29): Artifact Signing price, individual eligibility (US/CA), EV no longer bypasses SmartScreen, SignPath Foundation. **HIGH.**
- [Azure/artifact-signing-action](https://github.com/Azure/artifact-signing-action): OIDC auth, Windows-only runners. **HIGH.**
- [GitHub Changelog: Immutable releases GA (2025-10-28)](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/) and [public preview (2025-08-26)](https://github.blog/changelog/2025-08-26-releases-now-support-immutability-in-public-preview/). **HIGH.**
- [Sigstore: Signing blobs](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/) and [cosign PR #5083](https://github.com/sigstore/cosign/pull/5083): bundle-only `sign-blob` in v3. **HIGH.**
- [Electron-builder DMG notarization gap](https://github.com/bottomless/agent-duel/pull/26) and similar PRs: the app is notarized, the dmg is not. **MEDIUM.**
- [Microsoft Learn: Implementing an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer), [Fun with AppContainers](https://scorpiosoftware.net/2019/01/15/fun-with-appcontainers/), [Cheap sandboxing with AppContainers](https://blahcat.github.io/2020-12-29-cheap-sandboxing-with-appcontainers/). **HIGH** for the launch and ACL mechanics.
- [landstrip#204](https://github.com/landstrip/landstrip/issues/204): `\Device\Null` lacks an ALL APPLICATION PACKAGES ACE, so AppContainer gets access denied. **MEDIUM** (the mechanism generalizes to device objects; the CD-ROM case is unverified).
- [OpenAI: Building the Codex Windows sandbox](https://openai.com/index/building-codex-windows-sandbox/) (fetch blocked; summarized via [Codex sandbox deep dive](https://codex.danielvaughan.com/2026/07/18/codex-cli-windows-sandbox-architecture-powershell-ast-safety-elevated-unelevated-appcontainer-restricted-tokens/)): a restricted token cannot block network unelevated. **MEDIUM.**
- [Origin: MXC internals (2026-06-04)](https://www.originhq.com/research/mxc-execution-containers-internals): `CreateProcessInSandbox` is experimental, Insider-only. **MEDIUM.**
- libdvdcss `src/device.c` and `src/ioctl.c`; libaacs `src/file/mmc_device_win32.c` and `mmc_device_darwin.c` (code.videolan.org, master): Windows open flags, SPTI ioctl 0x4D014 (read+write), macOS DiskArbitration force-unmount + IOKit MMC. **HIGH (source-verified).**
- Chromium `sandbox/policy/mac/common.sb` and `utility.sb` (chromium/chromium GitHub mirror): deny-default baseline, cryptex paths, sysctl list. **HIGH.**
- [zylos.ai: unprivileged userns restrictions vs sandboxes (2026-09-01)](https://zylos.ai/research/2026-09-01-unprivileged-userns-restrictions-container-agent-sandboxes/), [openai/codex#38715](https://github.com/openai/codex/issues/38715), [claude-desktop-debian#542](https://github.com/aaddrick/claude-desktop-debian/issues/542), [Ubuntu 23.10 userns blog](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces): Ubuntu 24.04+ bwrap failure, profile collision, vendor-owned binary pattern. **MEDIUM-HIGH.**
- `google/oss-fuzz/projects` (GitHub API): ffmpeg present without dvdread; no libdvdread, libdvdnav or libbluray projects. **HIGH.**
- [actions/runner-images#9515](https://github.com/actions/runner-images/issues/9515): ASan vs `mmap_rnd_bits=32`. **HIGH.**
- [TMDB rate limiting](https://developer.themoviedb.org/docs/rate-limiting), [TMDB FAQ](https://developer.themoviedb.org/docs/faq), [TMDB API Terms of Use (2023-10-20)](https://www.themoviedb.org/api-terms-of-use), [TMDB staff on per-user keys](https://www.themoviedb.org/talk/65bb413111c066017bd01c3d). **HIGH** for the terms; key policy is judgment.
- [Node.js test runner coverage docs (v26.11.1)](https://nodejs.org/api/test.html#collecting-code-coverage): still Experimental. **HIGH.**
- [c8 README](https://github.com/bcoe/c8/blob/main/README.md); [AfterFrame PR #55](https://github.com/YIWANG3/AfterFrame/pull/55) for Electron main-process `NODE_V8_COVERAGE`. **MEDIUM.**
- [VMware Fusion 25H2 release notes](https://techdocs.broadcom.com/us/en/vmware-cis/desktop-hypervisors/fusion-pro/25H2/release-notes/vmware-fusion-25h2-release-notes.html), [Fusion free for all use](https://appleinsider.com/inside/macos/tips/how-to-get-vmware-fusion-pro-13-for-free), [Parallels Desktop 26](https://www.parallels.com/blogs/parallels-desktop-26/), [MakeMKV forum: VMs and passthrough](https://forum.makemkv.com/forum/viewtopic.php?t=30287), [VirtualBox MakeMKV thread](https://forums.virtualbox.org/viewtopic.php?f=2&t=97754). **MEDIUM**; drive-specific behaviour is LOW until tested.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
