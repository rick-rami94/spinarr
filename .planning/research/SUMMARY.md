# Project Research Summary

**Project:** Spinarr v1.0 (brownfield milestone)
**Domain:** Open-source, cross-platform, sandboxed, lossless DVD/Blu-ray → MKV ripper (Electron 44 + native engine) for Plex/Jellyfin collectors
**Researched:** 2026-10-10
**Confidence:** MEDIUM overall (HIGH on code-verified mechanics and vendor docs; LOW on the single riskiest unknown — Windows raw-device access from an AppContainer)

## Executive Summary

Spinarr v0.1.3 is a credible, well-architected prototype (audit: Architecture 7/10, Security 6/10) that already proves the hard part — bit-exact remuxing with a sandboxed, patched ffmpeg engine. The four research tracks converge on the same conclusion: **v1.0 is mostly about closing gaps that were deferred, not about redesigning what works.** The engine-privilege boundary is sound; what's missing is (1) the sandbox actually holding on Windows and on modern Linux, (2) verification that can't be fooled by a disc that reads "complete" but is corrupt or mis-mapped, (3) a scanner that sees the whole disc (all Blu-ray clips, not just clip 0; DVD cell ranges) so main-feature and TV-episode logic can be trusted, and (4) the trust chain around the binary itself — signing, notarization, provenance, GPL source — so a stranger can install it without a warning dialog and without Spinarr quietly violating its own license.

The recommended approach is a capability-request sandboxing pattern (one seam, three OS-specific backends) built on a disc-identity-keyed catalog and a reserve→stage→fsync→rename output model. This foundation unblocks everything else: retries, batch mode, Windows ACL grants, and macOS/Linux profile narrowing all depend on jobs writing only to a per-job staging directory rather than the user's whole library. Collector-facing work (naming presets, TV episode detection, obfuscation-aware Blu-ray main-feature picking, opt-in TMDB) sits on top of a richer scanner schema (v2) that must ship first, because four downstream features all need it.

The dominant risk is the Windows engine sandbox: whether a zero-capability AppContainer can open a raw optical device and issue the SCSI/DVD IOCTLs libdvdcss and libaacs need is **unverified and rated LOW confidence** by both STACK.md and ARCHITECTURE.md independently, and PITFALLS.md treats it as the #1 critical pitfall. This must be resolved with a real spike (NtObjectManager on a Windows 11 VM with the actual USB drives) before the Windows sandbox design is locked, because the fallback (restricted token + job object) cannot block network access unelevated — a direct conflict with the core safety promise. A second cluster of risk sits around macOS AACS: libaacs force-unmounts and remounts the disc via DiskArbitration during the MMC handshake, which collides with Spinarr's existing "abandon vanished source" watcher and needs its own sandbox profile variant. A third, lower-risk but certain issue is Ubuntu 24.04+ breaking the existing bubblewrap sandbox outright via unprivileged-userns restrictions — this has reproducible upstream evidence and a known fix (vendor bwrap + a profile scoped to that exact binary path, never to the system `/usr/bin/bwrap`).

## Key Findings

### Recommended Stack

The core stack (Electron 44.7.0, plain JS UI, static patched ffmpeg 8.0.1/libdvdread/libdvdnav/libbluray) is already decided and out of scope for this research. What v1.0 adds is almost entirely tooling and a small amount of native C, with **zero new runtime npm dependencies** preserved throughout.

**Core technologies:**
- Apple Developer ID + `notarytool` via App Store Connect API key — the only path that avoids a Gatekeeper bypass; electron-builder 26 already wires this up (code-verified)
- Custom `mac.sign` hook wrapping `@electron/osx-sign` — electron-builder only distinguishes "the app" from "everything else"; a custom hook is required to give the engine binaries `disable-library-validation` without also granting it to Electron's own helpers (closes SF-6)
- Azure Artifact Signing (`win.azureSignOptions`) — PFX certs are no longer issuable (CA/B Forum HSM rule since June 2023); this is the modern, individually-eligible (US/Canada) path, and EV no longer buys instant SmartScreen reputation since 2024
- `actions/attest` + GitHub Immutable Releases + `cosign sign-blob` (keyless, bundle format) — fixes the "SHA256SUMS hosted next to the files it covers" anti-pattern for free, using Sigstore
- A small native C launcher `spinarr-sandbox.exe` (AppContainer + Job Object) — Node's `child_process` cannot set the Win32 process-thread attributes this needs; a standalone helper avoids putting native code in the privileged main process
- Vendored `bwrap` + a path-scoped AppArmor profile — the only way to grant userns on Ubuntu 24.04+ without opening it to every other unprivileged caller on the system
- ClusterFuzzLite + libFuzzer + ASan/UBSan — libdvdread, libdvdnav and libbluray have **no OSS-Fuzz project**; Spinarr's fuzzing is the only coverage that exists for its highest-risk parsers
- TMDB with a **bring-your-own token** model, `safeStorage`-encrypted — TMDB staff explicitly warn against embedding a shared key in a public repo

### Expected Features

**Must have (table stakes):**
- Media-server-correct naming (Plex `{tmdb-N}`/`{edition-}` vs Jellyfin `[tmdbid-N]`/suffix editions) with a server-profile setting and a path preview
- TV episode workflow (manual show/season/start, chapter-split DVDs, continue-numbering across discs) — the single biggest gap versus ARM/MakeMKV
- "Play all" title detection and skip, and a multi-angle selector (today: silently angle 1)
- Read-error retries (configurable, default 5) with a located failure message and a Retry button
- Robust Blu-ray main-feature selection that never silently picks a decoy playlist
- Keyed AACS end-to-end, validated on a real retail disc
- First-run checklist for user-supplied libdvdcss/libaacs/KEYDB.cfg
- Signed, notarized installers; desktop notifications; auto-eject in batch mode

**Should have (differentiators):**
- Honest uncertainty badges ("disc hides the real movie among 37 look-alikes: pick one") instead of silent guessing — no competitor does this
- Continue-numbering across a multi-disc season box set, keyed by content fingerprint, not label
- Offline title identification (bdmt_eng.xml, KEYDB disc-ID title) before any network call
- Per-rip verification report and a path preview before committing 40 GB

**Defer (v2+):**
- BD-J execution to resolve obfuscation (executes untrusted disc code — breaks the safety promise)
- "Ignore read errors" rip mode (contradicts "bit-exact or fail loudly")
- Auto-apply first TMDB result without a confidence gate
- Plex/Jellyfin library-refresh API, posters/NFO, multi-disc auto-join, parallel multi-drive ripping

### Architecture Approach

The guiding rule carries forward unchanged and now governs every new capability: all disc-byte parsing happens in the sandboxed engine; main parses only validated JSON; all network access lives in main; the renderer sees only minimal DTOs. The target architecture introduces a **capability-request sandboxing pattern** — the runner never assembles sandbox paths itself; each engine call declares `{read, write, device, decrypt}` and each platform backend (macOS SBPL, Linux bwrap+seccomp, Windows AppContainer+job) turns that into its own mechanism. This is the one seam all three sandbox workstreams share.

**Major components (new or refactored):**
1. `disc/catalog.js` — scan/probe truth keyed by `discId` (not mount path), so a different disc at the same drive letter can't reuse a stale scan and so verification has a trustworthy source of expected durations/streams
2. `rip/queue.js` + `rip/output.js` — a pure reducer for job state (retry policy is security-aware: read errors retry, signal-killed engines never auto-retry) plus a reserve→stage→fsync→rename output model where the sandbox only ever gets write access to one empty per-job staging directory
3. `engine/caps.js` + `platform/{mac,linux,win}.js` — the capability-request seam and its three backends
4. `sandbox/macProfile.js`, Linux `--seccomp` blobs + vendored `bwrap`, and `spinarr-sandbox.exe` — the three sandbox implementations, each gated by a startup functional probe that decides whether auto-scan is even allowed
5. `lib/analyze-bd.js`, `lib/episodes.js`, `lib/naming.js`, `lib/verify.js` — pure, Electron-free heuristics for obfuscation clustering, TV detection, server-profile naming, and per-stream verification
6. `metadata/tmdb.js` and `autorip.js` — the only module allowed to touch the network, and the batch-mode controller that consumes everything else last

### Critical Pitfalls

1. **Windows AppContainer may not be able to open the optical device at all** — libdvdcss/libaacs need SPTI with a read+write handle, and device objects typically lack the ACE AppContainer needs. Spike this first, in week one of the sandbox phase, with NtObjectManager against the real drives in a VM, before committing to a design. If it fails, fall back to a fd-broker for output (closes SF-10 too) plus either a narrow device-helper for AACS or an honestly-documented weaker restricted-token mode for physical encrypted rips — never silently claim full sandboxing.
2. **libaacs force-unmounts and remounts the disc on macOS mid-handshake**, which collides with Spinarr's existing `abandonVanishedSource()` watcher and will kill AACS rips that are actually succeeding. Key jobs by BSD device name/UUID, not mount path, and give the watcher a grace window during the handshake.
3. **Ubuntu 24.04+ breaks `/usr/bin/bwrap` for every unprivileged caller** via the userns-restriction sysctl. The fix is a vendored, path-scoped AppArmor profile attached only to Spinarr's own bwrap binary — never profile the shared system path, which would grant userns to every other caller and can collide with other vendors doing the same thing.
4. **A deny-default sandbox profile that looks closed but is secretly reopened** — reaching for `(import "bsd.sb")`/`(import "system.sb")` on macOS, or an allow-list seccomp policy on Linux that breaks on the next glibc, silently restores the exact Mach-lookup and filesystem access the hardening was meant to remove. Build from `(deny default)` with zero imports and explicit, tested denials.
5. **Verification that passes a corrupted or desynced rip** — exit-code-plus-90%-duration checks miss silently-returned garbage sectors and Blu-ray multi-clip audio/subtitle streams that start after clip 0. Move to per-stream read-vs-muxed packet counts and per-track duration tolerances, with a regression fixture that has a truncated audio track and must fail.
6. **Legal self-harm hiding in the existing repo** — a direct link to a libdvdcss DLL download, and named retail disc titles in test/doc files, both reproduce the exact fact pattern that triggered takedowns against DeCSS and youtube-dl. These are cheap, must happen in the first phase, and are unrelated to any other technical work.

## Implications for Roadmap

### Phase 0: Interim safety gate
**Rationale:** One conditional, removes the worst exposure (zero-click unsandboxed auto-scan on Windows/Linux) immediately and cheaply, before any other work starts.
**Delivers:** Auto-scan refuses to run whenever the sandbox probe hasn't passed, enforced as a main-process invariant (not a UI toggle) with an e2e test per entry point.
**Avoids:** Pitfall 24 (auto-scan gate implemented as a UI toggle that a new code path bypasses).

### Phase 1: Foundations — capability seam, disc identity, atomic output, queue reducer
**Rationale:** Every sandbox backend, every retry/batch feature, and the Windows ACL-grant story all depend on these four pieces existing first. Building sandboxes against today's broad "whole output folder" grant would mean rewriting all three profiles once staging dirs land.
**Delivers:** `engine/caps.js`, `disc/catalog.js` keyed by `discId`, `rip/output.js` (reserve→stage→fsync→rename), `rip/queue.js` pure reducer with journal.
**Addresses:** the groundwork beneath nearly every FEATURES.md item; directly fixes the "renderer-trusted duration" finding.
**Avoids:** Pitfall 14 (atomic output that isn't), Pitfall 3's anti-pattern of trusting renderer-sent data.

### Phase 2: Sandbox everywhere (the riskiest phase)
**Rationale:** Needs phase 1's capability API and staging dir. The Windows spike is the single biggest unknown in the whole milestone and should start in this phase's first week so its outcome (full AppContainer vs. fd-broker vs. documented fallback) is known before AACS-on-Windows work is scoped.
**Delivers:** macOS deny-default per-tool SBPL with denial tests; Linux bwrap+seccomp+vendored-binary+AppArmor-profile with a functional probe and Ubuntu 24.04 CI; Windows `spinarr-sandbox.exe` launcher with AppContainer, job object, and an ACE grant/revoke ledger.
**Addresses:** SF-1, SF-2, SF-6, SF-7 from PROJECT.md's Active requirements.
**Avoids:** Pitfalls 1, 3, 4, 5 (Windows device access, macOS profile re-opening, Ubuntu 24.04 breakage, seccomp execve/EPERM-vs-ENOSYS mistakes).

### Phase 3: Rip correctness — verification redesign, retries, atomic durability in practice
**Rationale:** Needs the catalog (truth), the stderr ring buffer, and the queue reducer's retry policy from phase 1. Blu-ray multi-clip verification and batch mode both depend on verification that can actually fail a bad rip, so this must land before phases 4 and 6.
**Delivers:** Per-stream read-vs-muxed packet verification, per-track duration tolerance, retry with located failure messages, scratched-disc behaviour, `powerSaveBlocker` for long rips.
**Addresses:** R-07, SF-9, R-16.
**Avoids:** Pitfall 8 (verification that passes corrupted rips), Pitfall 17 (sleep kills long rips), Pitfall 18 (naive whole-title retry).

### Phase 4: Scanner schema v2 + Blu-ray done properly
**Rationale:** One C scanner change (full BD clip lists + aggregated streams, DVD cell ranges, discId, angles) feeds four downstream consumers — obfuscation clustering, stream aggregation, angle selection, and TV/play-all detection — so it should ship once, in one pass, with one corpus update, rather than being touched four separate times. The AACS real-disc work depends on phase 2's macOS deny-default profile existing first, because the DiskArbitration/IOKit allows only make sense once that profile is being written deliberately.
**Delivers:** dvdinfo/bdinfo schema v2; obfuscation-cluster detection with an honest "pick one" fallback (never silent); angle selection end to end; keyed AACS validated on the real BU40N across a VUK-only disc, a bus-encrypted disc, and a not-in-KEYDB refusal case.
**Addresses:** the Blu-ray-done-properly and multi-angle Active requirements.
**Avoids:** Pitfall 2 (macOS unmount/watcher conflict), Pitfall 9 (AACS generalizing from one disc/drive state), Pitfall 10 (obfuscated decoy playlist crowned main feature), Pitfall 19 (angle selection without verification).

### Phase 5: Renderer refactor (safe-by-default templating)
**Rationale:** Independent of phases 2–4, but must land before phase 6's UI work, because TV/episode names, TMDB match strings, and angle/naming previews triple the amount of untrusted text the renderer displays.
**Delivers:** Auto-escaping `html.js` tagged templates with a Trusted Types policy; CSP enforced via response header.
**Addresses:** the hardened-renderer requirement generally.
**Avoids:** a latent XSS surface opening up the moment TMDB and episode-name strings start flowing into the DOM.

### Phase 6: Collector workflow (naming, TV, TMDB, batch) — last
**Rationale:** This is the integrator. Naming needs a server-profile setting; TV episode detection needs phase 4's richer cell/clip data; batch mode needs naming, the classifier, retries, verification, eject, and the sandbox probe gate on every OS. It cannot be done first because it would be built against data that doesn't exist yet (clip 0 only, no cell ranges).
**Delivers:** Plex/Jellyfin naming presets with path preview; TV episode workflow with continue-numbering; opt-in TMDB with runtime-ranked matching, attribution, and a confidence gate; batch/auto-rip with eject, notifications, and a content-fingerprint duplicate warning.
**Addresses:** the full Plex/Jellyfin collector workflow Active requirement set.
**Avoids:** Pitfall 11 (TMDB as a path-traversal/privacy channel), Pitfall 12 (naive TV duration-cluster heuristics), Pitfall 13 (naming right for one server, wrong for the other).

### Phase 7 (parallel track from phase 1, finalized last): Trust & distribution
**Rationale:** Signing and provenance work is independent of the sandbox/correctness/feature phases and should start in parallel from day one — notarization is where hardened-runtime + dlopen + sandbox interaction problems surface early, and a signed `spinarr-sandbox.exe` reduces Defender/SmartScreen friction when beta-testing the Windows sandbox. Per-binary entitlements can only be finalized once the engine binary set is final (after phases 2b/2c). The legal-hygiene quick fixes (README link, retail titles in docs/tests) are cheap and should happen in the very first days of this track, unrelated to any other technical dependency.
**Delivers:** macOS notarization via API-key auth and a custom `mac.sign` hook; Windows Azure Artifact Signing; `actions/attest` + Immutable Releases + cosign checksums; GPL corresponding-source bundle attached to every release; CI supply-chain hardening (SHA-pinned actions, protected release environment).
**Addresses:** every item under PROJECT.md's "Trust and distribution" Active group.
**Avoids:** Pitfalls 6, 7, 15, 16, 29 (macOS signing/entitlement mistakes, Windows PFX/SmartScreen misconceptions, legal self-harm, GPL source-path gaps, signing secrets reachable from PR workflows).

### Phase Ordering Rationale

- **Dependency chain is the primary driver, not feature grouping.** Four research files converge on the same build order: interim gate → capability/staging/catalog/queue foundations → sandboxes → verification → scanner-v2/Blu-ray → renderer hardening → collector workflow, with trust/distribution running the whole time as a parallel track.
- **The riskiest unknown (Windows device access) is pulled as early as possible** inside its phase so its outcome can change downstream scope (AACS-on-Windows design) before that work is estimated.
- **Everything that touches untrusted text (TMDB, episode names) waits for the renderer hardening phase**, because the collector-workflow phase roughly triples the untrusted-text surface.
- **AACS-on-macOS waits for the deny-default profile to exist deliberately**, not as an afterthought, because the DiskArbitration/IOKit allows it needs only make sense in that context.

### Research Flags

Needs deeper, phase-specific research during planning:
- **Phase 2 (Windows sandbox):** the device-access spike is unresolved (LOW confidence); its result changes the phase's scope materially. This is the single most important spike in the milestone.
- **Phase 2 (Linux seccomp):** the exact syscall allowlist for the static ffmpeg plus a user-supplied libdvdcss/libaacs needs empirical derivation via `strace` on real rips, not a static list.
- **Phase 4 (AACS, macOS):** the exact `iokit-open` user-client class and the volume-watcher grace-window behaviour during libaacs's unmount/remount need the real BU40N to confirm.
- **Phase 4 (Blu-ray obfuscation):** no published deterministic resolution method exists outside BD-J execution (which is out of scope for safety reasons); the heuristic approach is LOW-MEDIUM confidence and must plan for "ask the user," not "solve it."
- **Phase 6 (TV episode heuristics):** thresholds need validation against real multi-angle/TV DVDs (owned hardware); play-all detection via cell/clip overlap is HIGH confidence for DVD, MEDIUM for Blu-ray.

Phases with standard, well-documented patterns (research-phase can likely be skipped or kept light):
- **Phase 1 (foundations):** pure-JS reducer and fsync/rename patterns are well-established; code-verified against the installed electron-builder source.
- **Phase 5 (renderer hardening):** Trusted Types + tagged-template escaping is a known, mechanical pattern.
- **Phase 7 (trust & distribution):** signing/notarization/attestation mechanics are HIGH confidence, code-verified against the installed electron-builder 26.15.3 source and vendor docs.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Signing, provenance, coverage and TMDB are HIGH (code-verified against installed electron-builder source, or vendor docs). Windows sandbox design is MEDIUM; raw optical-device access from an AppContainer is explicitly LOW until a spike runs. |
| Features | MEDIUM-HIGH | Naming rules are HIGH (read directly from Plex/Jellyfin docs and source). Competitor behaviour is MEDIUM (forums, source, config files). Blu-ray obfuscation heuristics are LOW-MEDIUM — no deterministic published method exists outside BD-J. |
| Architecture | MEDIUM | HIGH for code-level integration points (libbluray, ffmpeg, electron-builder, libaacs/libdvdcss source all read directly). MEDIUM for macOS deny-default and Linux seccomp mechanics. LOW for Windows raw-device access, consistent with STACK and PITFALLS. |
| Pitfalls | MEDIUM | Signing, bwrap/AppArmor, TMDB terms, libaacs device code, ffmpeg options and legal case history are verified against vendor docs, upstream source, or multiple independent reports. The Windows AppContainer conclusions are code-supported but not yet reproduced on real hardware. Blu-ray obfuscation heuristics are LOW. |

**Overall confidence:** MEDIUM. The one load-bearing LOW-confidence item — Windows AppContainer raw optical-device access — is independently flagged by all three technical research files (STACK, ARCHITECTURE, PITFALLS) as the top risk and the top required spike, which is itself a strong signal that the research converged correctly rather than missing something.

### Gaps to Address

- **Windows raw-device access from an AppContainer is unverified.** Resolve with the NtObjectManager spike against real hardware in a VM at the very start of the sandbox phase; the decision tree (full AppContainer / fd-broker / documented fallback) is already specified in STACK.md and ARCHITECTURE.md and should be used directly during phase planning.
- **macOS AACS sandbox requirements (exact `iokit-open` class, DiskArbitration mach-lookup list, watcher grace window) are MEDIUM confidence** pending a real BU40N test; budget time in phase 4 for iterative profile tuning using `log stream --predicate 'sender=="Sandbox"'`.
- **Blu-ray obfuscation has no reliable automatic resolution.** Plan the UX and batch-mode behavior around "detect and ask," not "solve," and treat any heuristic improvement as a bonus, not a dependency for shipping.
- **No physical Windows, Linux, or Apple Silicon hardware exists.** All non-Mac-Intel validation routes through VM USB passthrough (VMware Fusion primary, Parallels fallback) plus CI plus a public beta; results from VMs must be labeled distinctly from hardware-validated results, per PITFALLS.md Pitfall 22.
- **TMDB API key policy (bundled project key vs. pure bring-your-own) is a judgment call**, not fully resolved between FEATURES.md (leans toward a bundled key with override) and STACK.md/ARCHITECTURE.md (lean toward pure bring-your-own to avoid a single point of revocation). Decide explicitly during phase 6 planning.

## Sources

### Primary (HIGH confidence)
- electron-builder 26.15.3 installed source (`node_modules/app-builder-lib`) — entitlements, signing hooks, Azure/notarize options, AppArmor template (code-verified)
- libbluray 1.5.0, ffmpeg 8.0.1, libdvdread, libaacs 0.11.1/0.12.0, libdvdcss source (code.videolan.org, github.com/FFmpeg/FFmpeg) — angle ranges, device open flags, SPTI requirements, force-unmount behavior (source-verified)
- Plex and Jellyfin official naming documentation and Jellyfin source (`PathExtensions.cs`, `NamingOptions.cs`)
- Microsoft Learn: AppContainer implementation, SmartScreen reputation, code-signing options, SPTI ioctl docs
- TMDB API Terms of Use, FAQ, rate-limiting docs
- US Copyright Office §1201 triennial rulemakings; EFF/TorrentFreak legal case history (DeCSS, youtube-dl, SlySoft/AnyDVD, DVDFab)

### Secondary (MEDIUM confidence)
- MakeMKV forum (read-retry defaults, obfuscation reports, BU40N host-certificate revocation thread)
- ARM (automatic-ripping-machine) source, config, and GitHub discussions
- Ubuntu bug 2089378, VS Code #316046, protontricks #400 — bwrap/userns restriction on 24.04+
- OpenAI Codex Windows-sandbox writeup and related issue trackers — AppContainer device-access limitations

### Tertiary (LOW confidence)
- SSIM frame-continuity Blu-ray deobfuscation (single-author forum report, failed on a third disc)
- Doom9 forum playlist heuristics
- KEYDB Windows path variants (community guide, not cross-verified)

---
*Research completed: 2026-10-10*
*Ready for roadmap: yes*
