# Requirements: Spinarr v1.0

**Defined:** 2026-10-10
**Core Value:** Every rip is a complete, bit-exact copy of what's on the disc, or it fails loudly. Opening a disc can never compromise the user's computer.

Finding IDs in brackets (SF-, R-, DD-) refer to the local engineering audit. Research references point to `.planning/research/`.

## v1 Requirements

### Engine Sandbox & Security (SAFE)

- [ ] **SAFE-01**: A disc is never scanned automatically while the engine sandbox is inactive, on any OS. The user sees why, and must click to scan. [SF-1]
- [ ] **SAFE-02**: On macOS, every engine tool runs under a deny-by-default sandbox profile, one profile per tool. Tests prove these are denied: `/tmp` reads, `$HOME` stat, Mach lookups (pasteboard, LaunchServices) and network. A real-drive rip still succeeds. [SF-2]
- [ ] **SAFE-03**: On Linux, Spinarr ships its own bubblewrap with an AppArmor profile scoped to that binary. Engines run with a seccomp deny-list filter. A startup probe checks the sandbox actually works, and Settings shows the real status. [SF-7]
- [ ] **SAFE-04**: On Ubuntu 24.04+ the deb's sandbox works out of the box. The AppImage reports reduced isolation and disables auto-scan when bwrap can't run. The Electron renderer sandbox is never silently disabled.
- [ ] **SAFE-05**: On Windows, scans and disc-image or unencrypted rips run in an AppContainer with no capabilities, inside a job object. Access is granted per job, and the engine has no network access. [SF-1]
  - Must also close the SAFE-01 residual: the unsandboxed engine re-opens disc files lazily after the spawn-time same-disc check, a crafted playlist clip_id can name files the fingerprint skips, and a same-size rewrite with restored timestamps passes the check (01-REVIEW.md WR-10, WR-08, T-01-44; disclosed in SECURITY.md).
- [ ] **SAFE-06**: On Windows, an early spike decides how encrypted physical discs are handled.
  - If the AppContainer can open the drive device, they use it.
  - Otherwise they use a weaker sandbox: restricted token, low integrity, job object, no network. Settings and the docs say so plainly.
- [ ] **SAFE-07**: Engine processes never get write access to the output folder or network shares. Main opens the output file and passes it to the engine, or the engine writes only to a per-job staging folder.
- [ ] **SAFE-08**: Output files are reserved atomically, with an exclusive create and no-replace rename. Nothing follows a symlink, and main never writes into a location an attacker controls. [SF-10]
- [ ] **SAFE-09**: The app's macOS entitlements are JIT only. Library validation is relaxed only on the engine binaries. [SF-6]
- [ ] **SAFE-10**: libFuzzer harnesses for libdvdread IFO and libbluray MPLS/CLPI run in CI (ClusterFuzzLite). The malicious-disc corpus is replayed against ASan builds in CI. [SF-8]
- [ ] **SAFE-11**: DVD job durations, playlists and stream lists come only from the main-process scan, never from the renderer. Rips of unscanned sources are rejected. [SF-9]
- [ ] **SAFE-12**: The renderer escapes everything by default (a tagged-template helper plus a Trusted Types policy), so new UI can't introduce HTML injection.
- [ ] **SAFE-13**: Settings → System describes the sandbox accurately for each OS and mode. No copy claims more isolation than is enforced. [DD-7]

### Rip Correctness (RIP)

- [ ] **RIP-01**: Verification checks every mapped stream (video, audio, subtitles) against the scanned title, using packet counts and per-track durations. The tolerance is tight and documented. A rip that drops any stream content fails. [R-07]
- [ ] **RIP-02**: Verification compares bytes read against the scan's expected size, so drives that return junk data for bad sectors can't pass a damaged rip.
- [ ] **RIP-03**: Read errors are retried a configurable number of times (default 5, like MakeMKV) before the rip fails. There is never a "skip bad sectors and keep going" mode.
- [ ] **RIP-04**: A failed rip says where it failed (title, approximate position) and offers a one-click **Retry**.
- [ ] **RIP-05**: Finished files are fsynced before the final rename, and stale `.part` or staging files are swept at startup. No partial file survives a quit on any OS (including Windows). [R-16]
- [ ] **RIP-06**: The system doesn't sleep while a rip is running.
- [ ] **RIP-07**: The scan catalog is keyed by a disc ID (libdvdread `DVDDiscID` / Blu-ray `disc_id`), so a different disc at the same mount path never reuses a stale scan.
- [ ] **RIP-08**: The rip queue is a tested state machine module, and its journal survives an app restart. Interrupted jobs show as interrupted, never as done.
- [ ] **RIP-09**: On multi-angle titles the user can choose the angle (DVD and Blu-ray), the chosen angle is ripped, and this is verified on a real multi-angle DVD.

### Blu-ray (BD)

- [ ] **BD-01**: The scanner schema v2 reports for each title:
  - disc ID
  - every clip with its streams, merged across clips (not just clip 0)
  - angles
  - DVD cell/sector ranges
  - main-title hints
- [ ] **BD-02**: Main-feature selection groups decoy playlists (same clips and duration, different order) and assigns a confidence level. When confidence is low, Spinarr asks the user and never guesses silently.
- [ ] **BD-03**: AACS discs whose per-disc key (VUK) is in the user's KEYDB.cfg rip end to end inside the sandbox. Verified on a real retail disc on the BU40N.
- [ ] **BD-04**: AACS discs that need the drive handshake or bus encryption are refused, with a clear explanation. Spinarr never triggers the drive-certificate handshake, so there's no revocation risk.
- [ ] **BD-05**: The macOS libaacs unmount/remount during a rip isn't mistaken for a disc removal.
- [ ] **BD-06**: A large Blu-ray main feature (25–50 GB) rips and verifies on a real drive. Time, free-space checks and verification are recorded.

### Collector Workflow (COLL)

- [ ] **COLL-01**: In Settings the user picks Plex or Jellyfin as the naming profile, and it controls folder and file names (ID tags, editions, extras folders).
- [ ] **COLL-02**: Movies are saved as `Title (Year)/Title (Year).mkv`, with an optional edition and TMDB ID tag in the server's format.
- [ ] **COLL-03**: TV episodes are saved as `Show (Year)/Season NN/Show (Year) - SNNEMM - Name.mkv`, with specials in `Season 00` and multi-episode files as `SNNEMM-EMM`.
- [ ] **COLL-04**: Extras go into server-recognised folders (Featurettes, Behind The Scenes, Deleted Scenes, and so on).
- [ ] **COLL-05**: File-name sanitisation keeps titles readable: `Mission: Impossible` becomes `Mission - Impossible`, and Windows reserved names and length limits are handled.
- [ ] **COLL-06**: On series discs, episode titles are detected and numbered in order, and "play all" titles are recognised and skipped. The user can adjust before ripping.
- [ ] **COLL-07**: Episode numbering continues across discs of the same season, identified by disc content rather than the label.
- [ ] **COLL-08**: The user can enable TMDB lookup by pasting their own API token, stored encrypted with safeStorage. Lookup is off until a token is set.
- [ ] **COLL-09**: With lookup on, Spinarr suggests a movie or show match (title, year, episode names) from the disc label for the user to confirm. Requests go from the main process only; the engine and renderer never touch the network. TMDB attribution is shown.
- [ ] **COLL-10**: Batch mode: insert a disc, Spinarr rips the main feature (or confirmed episodes), verifies and ejects, ready for the next disc. It never auto-rips a low-confidence pick or an unsandboxed disc.
- [ ] **COLL-11**: The user is notified when each disc in batch mode finishes or needs attention.

### Cross-Platform (PLAT)

- [x] **PLAT-01**: Windows CI runs the full suite: unit, security corpus, engine (lossless oracle) and e2e.
- [ ] **PLAT-02**: CI runs on Ubuntu 22.04 and 24.04, including the bwrap sandbox test.
- [ ] **PLAT-03**: Eject and disc-removal are implemented and tested on macOS, Linux and Windows. The UI clears on every OS when the source disappears.
- [ ] **PLAT-04**: Windows and Linux builds are validated against the real USB drives through a VM with whole-device USB passthrough (VMware Fusion) from the Intel Mac. The results are recorded separately from bare-metal results.
- [ ] **PLAT-05**: A public beta (release candidates) runs before 1.0, with a tester call and an issue template for hardware reports. Tester-reported platforms are documented.

### Trust & Distribution (REL)

- [ ] **REL-01**: macOS builds are signed with a Developer ID and notarized, and the app and the dmg are both stapled. `spctl` accepts the dmg with no Gatekeeper bypass. [SF-4]
- [ ] **REL-02**: Windows builds and engine executables are signed with Azure Artifact Signing (OIDC, pinned signing module). [SF-4]
- [ ] **REL-03**: Every release has build-provenance attestations, a keyless cosign-signed SHA256SUMS and an SBOM generated from the engine pins. Immutable releases are on. [SF-4]
- [ ] **REL-04**: Every release attaches a GPL corresponding-source bundle (app source plus upstream engine tarballs plus patches), and the app ships third-party license notices. [R-13]
- [x] **REL-05**: Private vulnerability reporting is on, SECURITY.md has a fallback contact, and Dependabot alerts and updates are on. [SF-3]
- [x] **REL-06**: All GitHub Actions are pinned by commit SHA, toolchains are pinned, `main` is branch-protected with required checks, and the dependency audit covers Electron. [SF-5]
- [ ] **REL-07**: Releases before 1.0 are marked prerelease. A CHANGELOG is kept, and the release process is documented and followed.
- [x] **REL-08**: The README no longer links directly to a libdvdcss DLL download. Setup guidance stays neutral and never ships or fetches decryption components.

### Quality & Documentation (QUAL)

- [x] **QUAL-01**: Code coverage (c8) is measured in CI for unit and engine tests, with a recorded baseline and no regression.
- [x] **QUAL-02**: e2e is hermetic: test runs never read the real user's AACS or dvdcss folders. A scenario covers the default `accurateChapters=false` path.
- [ ] **QUAL-03**: Every documentation discrepancy from the audit (DD-1..DD-11) is resolved. The build fails on non-system linkage, and the security-testing report is current.
- [ ] **QUAL-04**: The hardware test matrix runs on the release candidate and is recorded in `docs/HARDWARE_TESTING.md`. It covers:
  - M-1..M-7
  - a multi-angle/TV DVD
  - a scratched disc
  - an AACS Blu-ray with a per-disc key
  - a large Blu-ray

## v2 Requirements

Deferred: tracked, but not in the v1.0 roadmap.

### Security
- **SAFE-V2-01**: A Windows sector broker, so encrypted physical rips run in a full AppContainer
- **SAFE-V2-02**: Replace `sandbox-exec` with an XPC service plus App Sandbox
- **SAFE-V2-03**: A libFuzzer harness for ffmpeg's `dvdvideo` demuxer and VOB/NAV parsing

### Blu-ray
- **BD-V2-01**: Full libaacs support, including the drive handshake and bus encryption
- **BD-V2-02**: Frame-comparison scoring and MovieObject analysis for obfuscated discs

### Product
- **PROD-V2-01**: Parallel multi-drive ripping
- **PROD-V2-02**: Accessibility audit automation (axe) in CI
- **PROD-V2-03**: Flatpak packaging
- **PROD-V2-04**: Upstream all engine patches and drop the fork once they're merged
- **PROD-V2-05**: A legal review of the AACS and key-file wording by counsel or the EFF

## Out of Scope

| Feature | Reason |
|---------|--------|
| BD+ and UHD (AACS 2.0) | Not legally or technically feasible for an open project |
| Shipping, downloading or linking to decryption libraries or keys | DMCA §1201 exposure; users bring their own |
| Running BD-J (Java) to resolve obfuscated playlists | Executes untrusted disc code |
| "Ignore read errors" / skip-bad-sectors mode | Breaks the core value (bit-exact or fail loudly) |
| Transcoding / re-encoding | Spinarr is a lossless remuxer; HandBrake covers transcoding |
| A bundled TMDB API key | TMDB staff advise against embedding keys in OSS apps |
| An auto-updater | Adds update-channel attack surface |
| 3D/MVC Blu-ray | Niche; revisit after 1.0 |
| Rewriting git history to fix authorship | Too disruptive; new commits use the real identity |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SAFE-01 | Phase 1 | In Progress (traverse-only bypass fixed in 01-15; residual documented and scoped to SF-1 / SAFE-05; awaiting re-verification) |
| SAFE-02 | Phase 4 | Pending |
| SAFE-03 | Phase 4 | Pending |
| SAFE-04 | Phase 4 | Pending |
| SAFE-05 | Phase 4 | Pending |
| SAFE-06 | Phase 4 | Pending |
| SAFE-07 | Phase 3 | Pending |
| SAFE-08 | Phase 3 | Pending |
| SAFE-09 | Phase 4 | Pending |
| SAFE-10 | Phase 2 | Pending |
| SAFE-11 | Phase 3 | Pending |
| SAFE-12 | Phase 7 | Pending |
| SAFE-13 | Phase 4 | Pending |
| RIP-01 | Phase 5 | Pending |
| RIP-02 | Phase 5 | Pending |
| RIP-03 | Phase 5 | Pending |
| RIP-04 | Phase 5 | Pending |
| RIP-05 | Phase 3 | Pending |
| RIP-06 | Phase 5 | Pending |
| RIP-07 | Phase 3 | Pending |
| RIP-08 | Phase 3 | Pending |
| RIP-09 | Phase 6 | Pending |
| BD-01 | Phase 6 | Pending |
| BD-02 | Phase 6 | Pending |
| BD-03 | Phase 6 | Pending |
| BD-04 | Phase 6 | Pending |
| BD-05 | Phase 6 | Pending |
| BD-06 | Phase 6 | Pending |
| COLL-01 | Phase 7 | Pending |
| COLL-02 | Phase 7 | Pending |
| COLL-03 | Phase 7 | Pending |
| COLL-04 | Phase 7 | Pending |
| COLL-05 | Phase 7 | Pending |
| COLL-06 | Phase 7 | Pending |
| COLL-07 | Phase 7 | Pending |
| COLL-08 | Phase 7 | Pending |
| COLL-09 | Phase 7 | Pending |
| COLL-10 | Phase 7 | Pending |
| COLL-11 | Phase 7 | Pending |
| PLAT-01 | Phase 1 | Complete |
| PLAT-02 | Phase 4 | Pending |
| PLAT-03 | Phase 5 | Pending |
| PLAT-04 | Phase 8 | Pending |
| PLAT-05 | Phase 8 | Pending |
| REL-01 | Phase 2 | Pending |
| REL-02 | Phase 2 | Pending |
| REL-03 | Phase 2 | Pending |
| REL-04 | Phase 2 | Pending |
| REL-05 | Phase 1 | Complete |
| REL-06 | Phase 1 | Complete |
| REL-07 | Phase 8 | Pending |
| REL-08 | Phase 1 | Complete |
| QUAL-01 | Phase 1 | Complete |
| QUAL-02 | Phase 1 | Complete |
| QUAL-03 | Phase 8 | Pending |
| QUAL-04 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 56 total
- Mapped to phases: 56
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-10*
*Last updated: 2026-10-10 after roadmap creation*
