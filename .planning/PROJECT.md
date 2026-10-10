# Spinarr

## What This Is

Spinarr is an open-source (GPL-3.0) desktop app for macOS, Windows and Linux that rips DVDs and Blu-rays to MKV losslessly. It copies streams bit for bit, with no re-encoding. It is for **Plex and Jellyfin collectors**: people backing up a shelf of discs they own into a media server, who want it easy, correct and safe, without becoming disc-format experts. It is a friendlier, auditable alternative to MakeMKV.

This milestone takes Spinarr from a credible prototype (v0.1.3) to a **v1.0 public release**: one you'd point strangers at, signed, sandboxed everywhere, and validated on real discs.

## Core Value

**Every rip is a complete, bit-exact copy of what's on the disc, or it fails loudly. Opening a disc can never compromise the user's computer.** Correctness and safety come before features and polish.

## Requirements

### Validated

<!-- Shipped in v0.1.x and confirmed by tests, CI and (where noted) real hardware.
     Source: ~/projects/spinarr-audit/SPINARR_ENGINEERING_AUDIT.md §4 -->

- ✓ DVD auto-detection and scan on macOS (real drive: LG GP63EX70, Space Jam CSS disc) — v0.1.0
- ✓ Lossless DVD remux to MKV: video bit-identical, every AC3 packet kept (oracle-tested; one real disc) — v0.1.0
- ✓ CSS-encrypted DVDs via the user's own libdvdcss (real drive) — v0.1.0
- ✓ Chapters, language tags, VobSub/PGS subtitles preserved (automated) — v0.1.x
- ✓ Main-feature preselection; short and duplicate titles hidden (automated) — v0.1.x
- ✓ Track selection, safe file naming, no-overwrite, rip queue with progress/ETA/cancel (automated) — v0.1.x
- ✓ ISO / VIDEO_TS / BDMV folder input, drag and drop (automated) — v0.1.x
- ✓ Unencrypted Blu-ray scan and rip on synthetic discs; LPCM → FLAC (automated) — v0.1.x
- ✓ AACS discs refused with a specific reason; user can install their own KEYDB.cfg (automated, refusal seen on a real BU40N) — v0.1.1
- ✓ Hardened Electron renderer, validated IPC, `app://` origin, CSP, Electron fuses in shipped builds (verified) — v0.1.x
- ✓ Engine sandbox on macOS (sandbox-exec) and Linux (bubblewrap), with network and home-folder access denied (verified) — v0.1.x
- ✓ Patched, checksum-pinned engine: ffmpeg 8.0.1, libdvdread 7.1.1, libdvdnav 7.0.0, libbluray 1.5.0; 11 fuzz-found memory-safety fixes — v0.1.0
- ✓ Installers for macOS (arm64/x64 dmg), Windows (NSIS), Linux (AppImage/deb) built in CI — v0.1.1
- ✓ Six UI skins, keyboard navigation, light/dark — v0.1.3

### Active

<!-- v1.0 scope. Hypotheses until shipped and validated.
     Finding IDs (SF-, R-, DD-) refer to the audit at ~/projects/spinarr-audit/. -->

**Trust and distribution**
- [ ] Releases are signed and notarized on macOS (Developer ID) and signed on Windows (Authenticode or Azure Trusted Signing), installing with no Gatekeeper or SmartScreen bypass (SF-4)
- [ ] Release artifacts carry signed checksums and build provenance attestations (SF-4)
- [ ] Private vulnerability reporting works, with a fallback contact; Dependabot alerts and updates are on (SF-3)
- [ ] CI is supply-chain hardened: actions pinned by SHA, toolchain pinned, `main` branch-protected, audit covers Electron (SF-5)
- [ ] Builds ship third-party license notices and a corresponding-source pointer (R-13)
- [ ] There's a changelog and a deliberate release process (prereleases until 1.0)

**Engine security**
- [ ] The Windows engine runs in a real sandbox (AppContainer or restricted token + job object): no network, no file access beyond source, output and caches (SF-1)
- [ ] Discs never auto-scan while the engine is unsandboxed, on any OS (SF-1)
- [ ] The macOS engine profile is deny-by-default, with tests that assert denial of `/tmp` reads, pasteboard/LaunchServices Mach lookups and `$HOME` stat (SF-2)
- [ ] The Linux bubblewrap sandbox has a seccomp filter and a startup functional probe; it works on Ubuntu 24.04+ (SF-7)
- [ ] The app's macOS entitlements are minimal; library-validation is relaxed only for the engine (SF-6)
- [ ] Fuzzing runs in CI with sanitizers (libFuzzer harnesses for IFO, MPLS/CLPI, VOB), and the crash corpus is replayed under ASan (SF-8)
- [ ] Output files are created atomically, with no TOCTOU or symlink-following writes (SF-10)

**Rip correctness (core value)**
- [ ] Rip verification checks every mapped stream (video, audio, subtitles) against the scanned title, with a tight, documented tolerance (R-07)
- [ ] DVD job durations come from the main-process scan, never from the renderer (SF-9)
- [ ] The user can choose the angle on multi-angle titles, and the chosen angle is what gets ripped
- [ ] Read errors are retried, and a failed rip can be retried from the UI; scratched-disc behaviour is defined and tested
- [ ] Finished files are durable (fsync before rename); no stale `.part` files after a crash or quit on any OS (R-16)

**Blu-ray done properly**
- [ ] Main-feature selection is robust to playlist obfuscation (decoy playlists)
- [ ] Audio and subtitle streams are aggregated across all clips of a playlist, not just clip 0
- [ ] AACS discs rip end to end with the user's own libaacs and KEYDB.cfg, inside the sandbox, verified on a real retail disc
- [ ] Large Blu-ray rips (25–50 GB) are validated on a real drive for time, disk space and correctness

**Plex/Jellyfin collector workflow**
- [ ] Output naming follows Plex/Jellyfin conventions: `Movie (Year)/Movie (Year).mkv` and `Show/Season NN/Show - SNNEMM.mkv`
- [ ] TV series discs: episode titles are detected and numbered, and "play all" titles are skipped
- [ ] Opt-in movie/TV lookup (TMDB) fills in the title, year and episode names; network access stays in the main process, never in the engine
- [ ] Batch mode: insert disc → rip main feature (or episodes) → eject, for working through a shelf

**Cross-platform 1.0**
- [ ] Windows and Linux CI run the full suite: unit, security corpus, engine and e2e
- [ ] Windows and Linux are validated against a real drive through a VM with USB passthrough from the Intel Mac, plus a public beta call for testers before 1.0
- [ ] Eject and disc-removal work and are tested on all three OSes

**Quality and docs**
- [ ] Code coverage is measured in CI with a baseline
- [ ] Docs match reality: all audit discrepancies DD-1..DD-11 resolved
- [ ] The hardware test matrix (M-1..M-7 + Blu-ray + AACS + multi-angle/TV + scratched disc) is run on the release candidate and recorded

### Out of Scope

- BD+ and UHD (AACS 2.0) discs — not legally or technically feasible for an open project, and MakeMKV territory
- Shipping, downloading or linking to decryption keys or libdvdcss/libaacs — legal exposure (DMCA §1201); users bring their own
- Transcoding or re-encoding — Spinarr is a lossless remuxer; HandBrake covers transcoding
- An auto-updater — adds update-channel attack surface; signed releases plus a "new version" notice is enough for 1.0
- Parallel multi-drive ripping — rare for the target user; the serial queue is fine for 1.0
- Rewriting existing git history to fix commit authorship — too disruptive; new commits use the real identity
- 3D/MVC Blu-ray — niche; revisit after 1.0
- Replacing sandbox-exec with an XPC service and App Sandbox — larger re-architecture; the deny-default profile is the 1.0 fix

## Context

- **Codebase:** about 1,960 lines of app JS (Electron 44.7.0, no framework, no runtime npm dependencies) and 380 lines of C scanners. A statically built ffmpeg carries six local patches. See the full audit: `~/projects/spinarr-audit/SPINARR_ENGINEERING_AUDIT.md` (10k words, evidence-labelled) and the summary `~/projects/spinarr-audit/SPINARR_REVIEW_HANDOFF.md`. **These audit files are local only and must not be committed.**
- **State at milestone start:** v0.1.3 at commit `4347f47`, published as Latest (unsigned). 156 node tests and 24 e2e scenarios pass locally and in CI on macOS, Linux and Windows.
- **Audit scores (1–10):** Architecture 7, Code 7, Security 6, Tests 7, Reliability 5, Performance 6, UX 6, Cross-platform 4, Docs 7, Release readiness 3, OSS sustainability 3.
- **Key architecture:**
  - Renderer → validated IPC → main process → sandboxed engine processes (`dvdinfo`, `bdinfo`, `ffprobe`, `ffmpeg`).
  - Platform specifics live in `app/platform.js`; pure logic in `app/lib.js`.
  - The e2e suite drives the real app via the `SPINARR_TEST` hook.
- **Hardware available:**
  - one Intel Mac (macOS 15)
  - an LG GP63EX70 USB DVD drive
  - an HL-DT-ST BU40N USB Blu-ray drive
  - discs: multi-angle/TV DVDs, a scratched disc, retail AACS Blu-rays with the user's own keys
  - **no** physical Windows, Linux or Apple Silicon machine; those are validated via VMs with USB passthrough plus CI plus beta testers
- **Existing project docs:** `docs/USER_STORIES.md` (US-/SEC- IDs, manual plan M-1..M-7), `docs/SECURITY_TESTING.md`, `docs/HARDWARE_TESTING.md`, `docs/ENCRYPTED_DISCS.md`, `docs/RELEASING.md`.
- **Conventions:**
  - Every user-facing change maps to a user story and comes with a test.
  - Disc-derived text is escaped before reaching HTML; IPC arguments are validated in main.
  - Any new engine capability needs a sandbox review on every OS.
  - The UI stays dependency-free.

## Constraints

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

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1.0 public release is the milestone goal (P0 + P1 audit items + collector features) | Users should get a product they can trust, not a beta | — Pending |
| Pay for macOS and Windows code signing | Removes the Gatekeeper/SmartScreen bypass anti-pattern (audit SF-4) | — Pending |
| Build a full Windows engine sandbox, not just a guard | Same safety bar on every OS; Windows is likely the biggest user base | — Pending |
| Blu-ray 1.0 includes keyed AACS, verified on a real disc | Most retail Blu-rays are AACS; unencrypted-only is not useful to collectors | — Pending |
| Primary audience: Plex/Jellyfin collectors | Drives naming, episodes, TMDB lookup and batch mode into scope | — Pending |
| TMDB lookup is opt-in and main-process only | Preserves the "engine has no network" guarantee and user privacy | — Pending |
| Ship all platforms as 1.0, gated by CI + VM USB passthrough + a public beta | Only the Intel Mac is available as physical hardware | — Pending |
| Repo-local git identity going forward; no history rewrite | Fixes attribution without breaking tags or releases | ✓ Done (2026-10-10) |
| Keep sandbox-exec (deny-default) for 1.0; XPC later | Smaller change that closes SF-2 now | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-10 after initialization*
