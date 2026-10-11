# Roadmap: Spinarr v1.0

## Overview

Spinarr v0.1.3 already proves the hard part: bit-exact remuxing with a patched, sandboxed engine. v1.0 closes the gaps that make it safe to point strangers at. The milestone starts by shutting the worst exposure (unsandboxed auto-scan) and fixing cheap repo hygiene. It then lays foundations that every later phase depends on: a disc-ID scan catalog, atomic staged output and a tested queue. On those, the engine sandbox gets enforced on every OS, verification gets strict enough to fail a damaged rip, and the scanner learns to see the whole disc, which unlocks Blu-ray done properly and the Plex/Jellyfin collector workflow. Trust and distribution (signing, provenance, GPL source, fuzzing in CI) runs as a parallel-capable track from Phase 2. The milestone ends with a release-candidate gate: the hardware matrix, VM validation, docs reconciliation and a public beta before 1.0.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Safety Gate & CI Baseline** - No unsandboxed auto-scan anywhere, plus quick wins: vuln reporting, SHA-pinned CI, neutral README, hermetic e2e, coverage baseline, full Windows CI
- [ ] **Phase 2: Trust & Distribution** - Signed and notarized installers, provenance attestations, signed checksums, SBOM, GPL source bundle, fuzzing in CI (parallel-capable track)
- [ ] **Phase 3: Rip Foundations** - Disc-ID scan catalog, main-process-only scan truth, staged atomic durable output, and a journaled queue state machine
- [ ] **Phase 4: Sandbox Everywhere** - Windows AppContainer spike first, then deny-default engine sandboxes on macOS, Linux and Windows with honest status reporting
- [ ] **Phase 5: Verified Rips** - Per-stream verification that fails damaged rips, read retries, located failures with Retry, no sleep mid-rip, eject/removal on all OSes
- [ ] **Phase 6: Scanner v2 & Blu-ray** - Whole-disc scanner schema, decoy-aware main feature, angle selection, keyed AACS and large Blu-ray rips on real hardware
- [ ] **Phase 7: Collector Workflow** - Safe-by-default renderer, Plex/Jellyfin naming, TV episodes, opt-in TMDB lookup and batch mode
- [ ] **Phase 8: Release Candidate & 1.0** - Hardware matrix on the RC, VM validation of Windows/Linux, docs match reality, prerelease/changelog process and public beta

## Phase Details

### Phase 1: Safety Gate & CI Baseline

**Goal**: The worst exposure is closed immediately (no disc is ever scanned unsandboxed without the user's click), and the repo and CI are in a state that later phases can safely build on.
**Depends on**: Nothing (first phase)
**Requirements**: SAFE-01, REL-05, REL-06, REL-08, QUAL-01, QUAL-02, PLAT-01
**Success Criteria** (what must be TRUE):

  1. On any OS where the sandbox probe has not passed, inserting a disc does not scan it; the user sees why and must click to scan, and an e2e test covers every scan entry point (insert, drag-drop, folder/ISO open).
  2. A security researcher can file a private vulnerability report on GitHub, SECURITY.md lists a fallback contact, and Dependabot alerts and update PRs are active.
  3. Every GitHub Action is pinned by commit SHA, toolchains are pinned, `main` rejects merges without required checks, and the dependency audit covers Electron.
  4. The README contains no direct link to a libdvdcss DLL; setup guidance is neutral and nothing in the repo ships or fetches decryption components.
  5. CI on Windows runs the full suite (unit, security corpus, engine lossless oracle, e2e), e2e never reads the real user's AACS/dvdcss folders and covers `accurateChapters=false`, and c8 coverage is reported with a recorded baseline that fails on regression.

**Plans**: 10 plans
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — GitHub-side setup: approve, push branch, open draft PR, enable private reporting + Dependabot alerts/security updates (checkpoint)
- [x] 01-02-PLAN.md — Main-process gate: lib scanGate/validateScanOptions, gated scan/probe/rip, sandboxTrusted(), SPINARR_TEST_HOME hook, remove dvdcss-page sink
- [x] 01-03-PLAN.md — CI hardening: SHA pins, .nvmrc, hashed meson/zizmor, Dependabot config, c8 on Linux, Windows full suite with pinned oracle, Electron audit + zizmor
- [x] 01-04-PLAN.md — c8 wiring (zero thresholds) + Windows-portable engine/corpus tests + accurateChapters=false engine case
- [x] 01-05-PLAN.md — Neutral libdvdcss guidance (platform.js, README, docs) + SECURITY.md fallback contact and truthful gate wording

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-06-PLAN.md — Renderer chokepoint requestScan/confirmScan, consent prompt, neutral DLL copy, gate-static + neutrality unit tests

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-07-PLAN.md — Prompt-aware e2e harness, hermetic home per launch, gate scenarios per entry point, IPC refusal, prompt-path XSS

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 01-08-PLAN.md — Hermetic key-dir scenario + CI real-home sentinel, accurateChapters=false e2e scenario

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 01-09-PLAN.md — Push, get CI green on all four jobs, commit floored Linux c8 baseline, confirm check names

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 01-10-PLAN.md — Branch protection on main (checkpoint, last step) + optional merge and v0.1.4 release (checkpoint)

**UI hint**: yes

### Phase 2: Trust & Distribution

**Goal**: A stranger can download a Spinarr release, verify where it came from, install it without any Gatekeeper or SmartScreen bypass, and get the GPL corresponding source; the engine's riskiest parsers are fuzzed continuously.
**Depends on**: Phase 1 (parallel-capable with Phases 3-7; re-run signing once the final engine binary set exists after Phase 4)
**Requirements**: REL-01, REL-02, REL-03, REL-04, SAFE-10
**Success Criteria** (what must be TRUE):

  1. A macOS user opens the downloaded dmg and app with no Gatekeeper warning; `spctl` accepts the stapled dmg and the notarized, stapled app.
  2. Windows installer and engine executables carry an Azure Artifact Signing signature produced from CI via OIDC with a pinned signing module.
  3. Every release has build-provenance attestations, a keyless cosign-signed SHA256SUMS, and an SBOM generated from the engine pins, and the release is immutable once published.
  4. Every release attaches a GPL corresponding-source bundle (app source, upstream engine tarballs, patches), and the installed app shows third-party license notices.
  5. CI runs libFuzzer harnesses for libdvdread IFO and libbluray MPLS/CLPI via ClusterFuzzLite, and replays the malicious-disc corpus against ASan builds on every change.

**Plans**: TBD
**Research flag**: light (signing/notarization/attestation mechanics are HIGH confidence)

### Phase 3: Rip Foundations

**Goal**: Scan truth, output files and job state are trustworthy: scans are tied to the physical disc, only the main process decides what a job contains, output is reserved and committed atomically from a per-job staging area, and the queue survives a restart honestly.
**Depends on**: Phase 1
**Requirements**: RIP-05, RIP-07, RIP-08, SAFE-07, SAFE-08, SAFE-11
**Success Criteria** (what must be TRUE):

  1. Swapping in a different disc at the same mount path or drive letter triggers a fresh scan; the stale scan is never reused (catalog keyed by DVDDiscID / Blu-ray disc_id).
  2. A rip request carrying renderer-supplied durations, playlists or streams, or naming an unscanned source, is rejected; DVD job details come only from the main-process scan.
  3. Engines write only into an empty per-job staging folder (or a main-opened file handle), never into the output folder or a network share; output names are reserved with exclusive create and no-replace rename, and a planted symlink in the output path is never followed.
  4. Finished files are fsynced before the final rename, and after a quit or crash on any OS (including Windows) no `.part` or staging file survives the next startup.
  5. Quitting mid-queue and relaunching shows interrupted jobs as interrupted (never done); the queue is a standalone state-machine module with its own tests.

**Plans**: TBD
**Research flag**: light (standard reducer and fsync/rename patterns)

### Phase 4: Sandbox Everywhere

**Goal**: Opening a disc cannot compromise the computer on any OS: every engine tool runs deny-by-default with no network, each OS's sandbox is functionally probed at startup, and the app tells the user exactly how much isolation is in force.
**Depends on**: Phase 3 (capability seam and per-job staging folder)
**Requirements**: SAFE-02, SAFE-03, SAFE-04, SAFE-05, SAFE-06, SAFE-09, SAFE-13, PLAT-02
**Success Criteria** (what must be TRUE):

  1. The Windows device-access spike runs first (NtObjectManager against the real drives via VM USB passthrough) and its outcome is recorded as a decision: encrypted physical rips use the AppContainer if it can open the drive, otherwise a disclosed restricted-token + low-integrity + job-object sandbox with no network.
  2. On Windows, scans and disc-image or unencrypted rips run in a zero-capability AppContainer inside a job object with per-job access grants and no network.
  3. On macOS, each engine tool runs under its own deny-default profile; tests prove `/tmp` reads, `$HOME` stat, pasteboard/LaunchServices Mach lookups and network are denied, a real-drive rip still succeeds, and the app's entitlements are JIT-only with library validation relaxed only on engine binaries.
  4. On Linux, engines run under Spinarr's own bubblewrap with a path-scoped AppArmor profile and a seccomp deny-list; the deb works out of the box on Ubuntu 24.04+, the AppImage reports reduced isolation and disables auto-scan when bwrap can't run, the Electron renderer sandbox is never silently disabled, and CI runs the bwrap sandbox test on Ubuntu 22.04 and 24.04.
  5. Settings → System shows the real, probed sandbox status for the current OS and mode, and no copy (in-app or docs) claims more isolation than is enforced.

**Plans**: TBD
**UI hint**: yes
**Research flag**: DEEP. Windows AppContainer raw optical-device access is LOW confidence and must be spiked in the first plan; Linux seccomp list must be derived empirically via strace on real rips.

### Phase 5: Verified Rips

**Goal**: Every rip is either a complete, bit-exact copy of the scanned title or a loud, located failure the user can retry, and long rips are not killed by sleep or confused by disc removal.
**Depends on**: Phase 4 (catalog truth and queue from Phase 3; retries run inside the sandboxed engine)
**Requirements**: RIP-01, RIP-02, RIP-03, RIP-04, RIP-06, PLAT-03
**Success Criteria** (what must be TRUE):

  1. A rip that drops or truncates any mapped stream (video, audio or subtitles) fails verification, proven by a regression fixture with a truncated audio track; the packet-count and per-track duration tolerance is documented.
  2. A rip whose bytes read fall short of the scan's expected size fails, so a drive returning junk for bad sectors cannot pass a damaged rip.
  3. Read errors are retried a configurable number of times (default 5) before failing; there is no skip-bad-sectors mode, and on a scratched disc the failure names the title and approximate position and offers a one-click Retry.
  4. The computer does not sleep while a rip is running.
  5. Ejecting or removing the disc works and is tested on macOS, Linux and Windows, and the UI clears on every OS when the source disappears.

**Plans**: TBD
**UI hint**: yes

### Phase 6: Scanner v2 & Blu-ray

**Goal**: The scanner sees the whole disc, so Blu-ray main-feature picks are honest about uncertainty, multi-angle titles rip the chosen angle, and keyed AACS and large retail Blu-rays rip and verify end to end inside the sandbox on real hardware.
**Depends on**: Phase 5 (verification must be able to fail a bad rip); Phase 4 (macOS deny-default profile for AACS IOKit/DiskArbitration allows)
**Requirements**: BD-01, BD-02, BD-03, BD-04, BD-05, BD-06, RIP-09
**Success Criteria** (what must be TRUE):

  1. Scanner schema v2 reports, per title, the disc ID, every clip with streams merged across clips (not just clip 0), angles, DVD cell/sector ranges and main-title hints, and the malicious-disc corpus is updated for it.
  2. On a disc with decoy playlists, Spinarr groups the look-alikes, shows a confidence level, and asks the user when confidence is low; it never silently picks.
  3. On a multi-angle DVD and Blu-ray title the user can choose the angle, and the chosen angle is what gets ripped, verified on a real multi-angle DVD.
  4. A retail AACS Blu-ray whose VUK is in the user's KEYDB.cfg rips end to end in the sandbox on the BU40N without the libaacs unmount/remount being treated as disc removal; discs needing the drive handshake or bus encryption are refused with a clear explanation and the handshake is never triggered.
  5. A 25-50 GB Blu-ray main feature rips and verifies on the real drive, with time, free-space checks and verification results recorded.

**Plans**: TBD
**UI hint**: yes
**Research flag**: DEEP. macOS AACS `iokit-open` class and watcher grace window need the real BU40N; obfuscation heuristics are LOW-MEDIUM confidence, so plan around "detect and ask", not "solve".

### Phase 7: Collector Workflow

**Goal**: A Plex or Jellyfin collector can work through a shelf of movies and TV seasons: correctly named files land in the right folders, episodes are numbered across discs, metadata lookup is opt-in and private, and batch mode rips, verifies and ejects disc after disc without ever guessing.
**Depends on**: Phase 6 (cell/clip data, confidence levels); Phase 5 (verification, retries, eject)
**Requirements**: SAFE-12, COLL-01, COLL-02, COLL-03, COLL-04, COLL-05, COLL-06, COLL-07, COLL-08, COLL-09, COLL-10, COLL-11
**Success Criteria** (what must be TRUE):

  1. All renderer output is escaped by default via a tagged-template helper and a Trusted Types policy, so disc-derived, episode and TMDB strings cannot inject HTML (lands before the new collector UI).
  2. The user picks Plex or Jellyfin in Settings and sees movies saved as `Title (Year)/Title (Year).mkv` (with optional edition and TMDB ID tag in that server's format), episodes as `Show (Year)/Season NN/Show (Year) - SNNEMM - Name.mkv` (specials in Season 00, multi-episode `SNNEMM-EMM`), extras in server-recognised folders, and readable sanitised names that respect Windows reserved names and length limits.
  3. On a series disc, episode titles are detected and numbered in order, "play all" titles are skipped, the user can adjust before ripping, and numbering continues across discs of the same season identified by content rather than label.
  4. With their own TMDB token pasted in (stored encrypted via safeStorage; lookup off until set), the user gets a suggested movie/show match with year and episode names to confirm; requests come only from the main process and TMDB attribution is shown.
  5. In batch mode the user inserts a disc and Spinarr rips the main feature or confirmed episodes, verifies, ejects and notifies them when each disc finishes or needs attention; it never auto-rips a low-confidence pick or an unsandboxed disc.

**Plans**: TBD
**UI hint**: yes
**Research flag**: moderate. TV episode/play-all thresholds need validation on owned multi-angle/TV DVDs.

### Phase 8: Release Candidate & 1.0

**Goal**: v1.0 ships only after the release candidate is validated on real hardware and through VMs, the docs match reality, and a public beta has shaken out platform issues.
**Depends on**: Phases 2-7
**Requirements**: REL-07, QUAL-03, QUAL-04, PLAT-04, PLAT-05
**Success Criteria** (what must be TRUE):

  1. Releases before 1.0 are published as prereleases, a CHANGELOG is maintained, and the documented release process is followed for each RC.
  2. Every audit documentation discrepancy (DD-1..DD-11) is resolved, the build fails on non-system linkage, and the security-testing report reflects the current sandboxes.
  3. The hardware matrix (M-1..M-7, a multi-angle/TV DVD, a scratched disc, an AACS Blu-ray with a per-disc key, a large Blu-ray) is run on the RC and recorded in `docs/HARDWARE_TESTING.md`.
  4. Windows and Linux builds are validated against the real USB drives via VMware Fusion whole-device passthrough, with results recorded separately from bare-metal results.
  5. A public beta runs with a tester call and a hardware-report issue template, and tester-reported platforms are documented before 1.0 is tagged.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Phase 2 (Trust & Distribution) only needs Phase 1 and may run in parallel with Phases 3-7.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Safety Gate & CI Baseline | 6/10 | In Progress|  |
| 2. Trust & Distribution | 0/TBD | Not started | - |
| 3. Rip Foundations | 0/TBD | Not started | - |
| 4. Sandbox Everywhere | 0/TBD | Not started | - |
| 5. Verified Rips | 0/TBD | Not started | - |
| 6. Scanner v2 & Blu-ray | 0/TBD | Not started | - |
| 7. Collector Workflow | 0/TBD | Not started | - |
| 8. Release Candidate & 1.0 | 0/TBD | Not started | - |
