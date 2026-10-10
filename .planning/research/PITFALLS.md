# Pitfalls Research

**Domain:** Open-source, sandboxed, signed Electron disc ripper (DVD/Blu-ray → lossless MKV) for Plex/Jellyfin collectors. Brownfield: Spinarr v0.1.3 → v1.0.
**Researched:** 2026-10-10
**Confidence:** MEDIUM overall. Signing, bwrap/AppArmor, TMDB, libaacs device code, ffmpeg options, and the legal history are verified against vendor docs, upstream source, or multiple reports. The Windows AppContainer device-access conclusions are code-supported but **not yet reproduced** on a real machine. Blu-ray obfuscation heuristics are LOW.

**Area labels used below.** The roadmap's phase names may differ. These map one-to-one onto PROJECT.md's Active groups:

| Label | Covers |
|---|---|
| **A: Trust & Distribution** | signing, notarization, attestations, CI hardening, notices, release process |
| **B: Engine Sandbox** | macOS deny-default, Linux bwrap+seccomp, Windows sandbox, the auto-scan gate |
| **C: Fuzzing** | libFuzzer + ASan in CI |
| **D: Rip Correctness & Durability** | verification, angles, retries, atomic output, fsync, large files |
| **E: Blu-ray & AACS** | obfuscation, multi-clip streams, keyed AACS in the sandbox |
| **F: Collector Workflow** | naming, TV episodes, TMDB, batch mode |
| **G: Cross-platform Validation** | VM USB passthrough, beta program, hardware matrix |
| **H: Legal & Docs** | GPL compliance, DMCA positioning, doc accuracy |

---

## Critical Pitfalls

### Pitfall 1: Building the Windows sandbox on AppContainer, then finding the engine can't open the drive (or the NAS)

**What goes wrong:**
An AppContainer token gets access only to objects whose DACL grants `ALL APPLICATION PACKAGES` or the container SID. These are not granted by default:
- Volume and device objects (`\\.\D:`)
- Most of the user profile
- SMB shares

This is what libdvdcss and libaacs do on Windows:
- **libdvdcss** (`src/device.c`) opens `\\.\X:` with `GENERIC_READ|GENERIC_WRITE` and falls back to `GENERIC_READ`.
- **libaacs** (`mmc_device_win32.c`) opens `\\.\X:` with `GENERIC_READ|GENERIC_WRITE` and sends `IOCTL_SCSI_PASS_THROUGH_DIRECT`.

Microsoft documents that SPTI requires a handle opened for **both** read and write. That has three consequences:
- **AppContainer:** CSS and AACS both fail with access denied.
- **Low integrity level (no-write-up):** CSS may still work, but AACS's SPTI handshake fails.
- **Network output:** writing to a NAS from inside an AppContainer needs the `privateNetworkClientServer` capability. That capability re-opens the network, which breaks the core promise.

**Why it happens:**
Teams pick "AppContainer" from Chromium/Edge write-ups. Renderers never touch raw devices, and the device-access matrix only surfaces once someone runs it on real hardware. Spinarr has no physical Windows machine.

**How to avoid:**
1. **Spike first, before committing to a design.** Build a ~200-line C launcher and record a matrix:
   - **Token types:** {AppContainer, LPAC, restricted token + low IL, restricted token + medium IL + job}
   - **Operations:** {read `D:\VIDEO_TS\VIDEO_TS.IFO`; `CreateFile \\.\D:` R and RW; `IOCTL_DVD_START_SESSION`; `IOCTL_SCSI_PASS_THROUGH_DIRECT`; write to a local folder; write to an SMB share; `connect()` to 1.1.1.1; read `%USERPROFILE%\Documents`}
   - Run it in the Windows VM with the passed-through drive.
2. **Prefer a broker pattern for output.** The unsandboxed main process opens the `.part` file and hands it to ffmpeg as a seekable inherited handle. ffmpeg's `fd:` protocol supports seeking on regular files (verified in the ffmpeg-protocols docs). This means:
   - The sandbox never needs output-folder or SMB access.
   - It also fixes the SF-10 TOCTOU, because the broker opens with exclusive-create.
   - Note: `build.sh` currently enables only `file,pipe,bluray`. **Add `fd`.** Do not use `pipe:`, because the Matroska muxer needs seeks to write Cues and duration.
3. **Do not apply Chromium's full mitigation set blindly.**
   - `ProcessSignaturePolicy` MicrosoftSignedOnly blocks the user's own `libdvdcss-2.dll`.
   - Image-load policies such as "no remote" or "prefer System32" can break the per-user DLL folder.
4. **If no token type can open the device for SPTI, decide explicitly.** Either:
   - (a) ship keyed AACS on Windows only through a narrow device-helper process, or
   - (b) document that AACS on Windows runs in a weaker profile, and keep the auto-scan gate.

   Don't discover this in week 6.

**Warning signs:** `ERROR_ACCESS_DENIED` (5) from `CreateFile` on `\\.\D:` inside the sandbox; CSS works but AACS returns `AACS_ERROR_MMC_OPEN`; rips to `\\nas\share` fail only when sandboxed; Defender/SmartScreen flags the new launcher exe.

**Phase to address:** B (Windows sandbox). Spike in the first week of B. Gate E (AACS on Windows) on the result.
**Confidence:** MEDIUM. libdvdcss/libaacs open flags verified in upstream source; the SPTI RW requirement is from Microsoft docs; AppContainer device DACL behaviour comes from multiple reports. Not reproduced.

---

### Pitfall 2: libaacs on macOS unmounts the disc mid-scan, and Spinarr's own watcher kills the rip

**What goes wrong:**
libaacs's `mmc_device_darwin.c` does the following:
1. Uses DiskArbitration to call `DADiskUnmount(..., kDADiskUnmountOptionForce, ...)` on the disc (verified in current upstream source).
2. Takes exclusive SCSITask access via IOKit to run the AACS handshake.
3. Remounts the disc.

During that window, Spinarr reacts to the vanished mount:
- `/Volumes/<LABEL>` disappears.
- `watchVolumes()` fires.
- `abandonVanishedSource()` (`main.js:160-166`) sees the source gone and **kills the job**.
- The UI drive list blinks, and the remount may come back at a different path (`LABEL 1`).

Inside a **deny-default** sandbox-exec profile, the handshake also needs:
- `mach-lookup` of `com.apple.DiskArbitration.diskarbitrationd`
- `iokit-open` for the SCSITask user client
- a security trade-off: a DiskArbitration-capable engine can force-unmount **other** volumes.

**Why it happens:**
The macOS AACS path is never exercised in automation. The only AACS test so far was a refusal. Bus-encryption discs and drives without a cached VUK need the MMC path.

**How to avoid:**
- Make the scan and rip of an AACS source resilient to the remount:
  - Key jobs on BSD device name and volume UUID, not mount path.
  - Suppress vanish-abort while an AACS engine is in its handshake window.
  - Re-resolve the mount path after the handshake.
- Write the macOS deny-default profile with a **separate AACS variant**: allow DiskArbitration and `iokit-open` only when the scan reports AACS. Keep the CSS/unencrypted profile tight.
- Keep a sandbox-denial log in testing: `log stream --style compact --predicate 'sender=="Sandbox"'`.
- Prefer the VUK path where possible: a KEYDB entry keyed by disc ID needs no drive handshake. Note that bus-encrypted discs still need MMC (Pitfall 9).

**Warning signs:** AACS rips "cancelled" or "source vanished" at 0%; drive list flickers on AACS insert; `kDADiskUnmountOptionForce` dissent logs; sandbox denials for `diskarbitrationd`.

**Phase to address:** E (AACS end-to-end), co-designed with B (macOS deny-default profile).
**Confidence:** HIGH that libaacs force-unmounts (source read). MEDIUM on the exact sandbox operations needed (verify with denial logs).

---

### Pitfall 3: A deny-default sandbox-exec profile that "works" because it silently re-allows what SF-2 was about

**What goes wrong:**
The deny-default profile can fail in two directions:
- **Too tight:** the engine aborts at dyld/libSystem init (exit 134/SIGABRT). This needs reads of `/System/Library/dyld/` and `/usr/lib`, plus `sysctl-read`. The same failure is documented in the Nix darwin sandbox and in Codex's sandbox profiles.
- **Too loose, by shortcut:** the developer reaches for `(import "bsd.sb")` or `(import "system.sb")`. Those base profiles bring back broad `mach-lookup` and file-read allowances, so the pasteboard and LaunchServices lookups the audit flagged return quietly.

The specific risks for this profile:
- Homebrew dylibs are loaded via `/opt/homebrew/opt/...` symlinks into `/Cellar`. libaacs's own deps (`libgcrypt`, `libgpg-error`) must be readable at their **realpaths**.
- libdvdcss falls back to `getpwuid()`, which goes to opendirectoryd over Mach, when `HOME` or `DVDCSS_CACHE` is unset.
- **App Translocation.** Opening a notarized app straight from the dmg runs it from `/private/var/folders/.../AppTranslocation/...`, which the current profile denies by subpath. It works only because `ENGINE` is re-allowed by realpath, so test it.

**How to avoid:**
- Write the profile from `(deny default)` with **no imports**. Add each allowance with a comment and a failing test.
- Assert denial of the following, as the PROJECT.md requirement says:
  - reads of `/private/tmp`
  - `stat` in `$HOME`
  - `mach-lookup` of `com.apple.pasteboard.1`, `com.apple.coreservices.launchservicesd`, `com.apple.windowserver.active`, `com.apple.tccd`
  - TCP and UDP
- Probe with a custom binary like the audit's E-7 probe, and run it in CI on `macos-14` (arm64) as well as on the Intel machine.
- Test the matrix: {Intel, arm64} × {Homebrew `/usr/local`, `/opt/homebrew`} × {launched from Applications, translocated from the dmg}.

**Warning signs:** engine exits 134 with an empty stderr; `Sandbox: ffmpeg(1234) deny(1) ...` lines in the unified log; the profile file contains `import`; the in-app copy (`app.js:383`) still claims "no access beyond disc and output" with no test asserting it.

**Phase to address:** B (macOS).
**Confidence:** HIGH (multiple independent reports of the dyld/sysctl failures; audit-verified Mach lookups).

---

### Pitfall 4: Linux sandbox silently fails (or is silently absent) on Ubuntu 24.04, and so does the Electron renderer sandbox

**What goes wrong:** Ubuntu 23.10+ sets `kernel.apparmor_restrict_unprivileged_userns=1`. On 24.04, unprivileged `/usr/bin/bwrap` fails with `bwrap: setting up uid map: Permission denied`:
- Ubuntu bug 2089378 ("bwrap needs an apparmor profile to work") is open against 24.04.1.
- VS Code issue #316046 reports the same; its fix was to load `bwrap-userns-restrict` from `apparmor-profiles` extras on 24.04. 25.04 ships it by default.

Spinarr selects bwrap when the binary *exists* (`platform.js:159`), so every scan fails on a stock 24.04 desktop. That is the most common Linux desktop.

The **Electron app itself** has the same problem:
- AppImages fail with "The SUID sandbox helper binary was found, but is not configured correctly".
- electron-builder 26 falls back to `--no-sandbox` for AppImage. **That disables the Chromium renderer sandbox** that the audit counted as a control.
- electron-builder 26's **deb** installs an AppArmor profile for the app; the AppImage gets none.
- AppImage also needs `libfuse2` (`libfuse2t64` on 24.04) just to launch.

**Why it happens:** CI runs `ubuntu-22.04` only, where userns is unrestricted.

**How to avoid:**
- Run a **functional probe** at startup: `bwrap --unshare-all ... /bin/true`, or better, the engine's `--version` under the real arguments. Cache the result.
- Expose three sandbox states in the UI: active, unavailable with a reason, or unsupported. The auto-scan gate (SF-1) keys off the probe, not off file existence.
- Add `ubuntu-24.04` (and, if runners allow, a 25.04/Fedora container with userns policies) to CI for the engine and e2e suites.
- In the deb, document or ship an AppArmor profile. Do not ship a profile for `/usr/bin/bwrap` that loosens it system-wide. Let the deb `Recommends: apparmor-profiles` and give clear instructions.
- Assert in e2e that the renderer is actually sandboxed on Linux. Check the `--no-sandbox` absence in `process.argv`, or `app.commandLine.hasSwitch('no-sandbox')`. Fail the AppImage job if electron-builder injected it, or make the UI warn.

**Warning signs:** every Linux beta report says "Could not read the disc structure"; `uid map` in stderr; the AppImage launches with `--no-sandbox` in `ps`.

**Phase to address:** B (Linux) and G (CI coverage).
**Confidence:** HIGH (multiple issue trackers and Ubuntu bug).

---

### Pitfall 5: A seccomp filter that blocks `execve` can't be installed by bwrap, and EPERM-vs-ENOSYS breaks glibc

**What goes wrong:**
- **`execve` can't be denied from outside.** Filters passed with `bwrap --seccomp FD` / `--add-seccomp-fd` are installed **before** bwrap execs the engine, and seccomp filters survive `execve`. A filter that denies `execve` therefore kills the engine's own launch. The audit's "execve allowed" note (SF-7) can't be closed from outside the process.
- **EPERM vs ENOSYS.** Filters that return `EPERM` for newer syscalls (`clone3`, `faccessat2`, `openat2`, `statx`, `rseq`) break glibc and musl fallbacks, which only retry on `ENOSYS`. Docker and Flatpak both hit `clone3` breakage this way.
- **x86_64 multi-ABI bypass.** Filters that don't check `AUDIT_ARCH` can be bypassed via the x32 or i386 syscall ABI.
- **Architecture mismatch.** A BPF blob compiled for x86_64 is wrong on arm64. Spinarr ships linux-arm64.

**How to avoid:**
- **Two-stage approach:**
  - **Stage 1:** a bwrap filter that denies dangerous syscalls (`ptrace`, `keyctl`, `bpf`, `perf_event_open`, `userfaultfd`, `mount`, `unshare`, `setns`, socket families other than `AF_UNIX`, and `ioctl` `TIOCSTI`). Return `ENOSYS` for unknown new syscalls.
  - **Stage 2:** a tiny self-sandbox call in `dvdinfo`/`bdinfo`/`ffmpeg` `main()` after argument parsing. A `prctl(PR_SET_NO_NEW_PRIVS)` plus an in-process filter denies `execve`/`execveat`/`fork`. This mirrors OpenBSD `pledge`. Spinarr already carries ffmpeg patches.
- Generate the BPF at **build time** per architecture, using a small C helper linked against libseccomp. This keeps the zero-runtime-npm-deps rule. Pass it to bwrap via an extra stdio fd from `spawn`.
- Test that the filter loads on 22.04, 24.04 and an arm64 runner, and that a probe syscall (`socket(AF_INET)`, `execve`) is denied.

**Warning signs:** engine dies with `SIGSYS` on one distro only; "Operation not permitted" from `pthread_create` on newer glibc; the seccomp blob is checked in as a single file for both architectures.

**Phase to address:** B (Linux).
**Confidence:** MEDIUM-HIGH. Seccomp-across-exec semantics and the clone3/EPERM issue are well established. The exact syscall list must be derived empirically with `strace -f -c` on real rips.

---

### Pitfall 6: macOS signing that passes locally but fails notarization, or passes notarization but breaks the engine

**What goes wrong:**
Each of these has been reported in Electron projects:
- **Missing signing flags on helper binaries.** Engine binaries in `extraResources` are not signed with hardened runtime and a secure timestamp. Notarization rejects with "The signature does not include a secure timestamp" or "The executable does not have the hardened runtime enabled" (electron-builder #5190, #4637, the Apple forums).
- **Engine signed without `disable-library-validation`.** dlopen of Homebrew libdvdcss/libaacs then fails at runtime with "mapping process and mapped file (non-platform) have different Team IDs". Notarization passes, but every encrypted disc breaks. Ad-hoc builds hid this, which is why SF-6 is "latent".
- **Library validation disabled app-wide.** `disable-library-validation` applied to the **whole app** via `entitlementsInherit` (current `package.json:81-82`) weakens the Electron main process and helpers for no reason.
- **Fuses flipped after signing.** A custom `afterSign` hook that flips fuses invalidates the signature, and users see "Spinarr is damaged".
- **Architecture mismatch.** arm64 dmg ships x64 engine binaries (or vice versa). Rosetta hides it on Apple Silicon until a user with arm64-only Homebrew libs hits "incompatible architecture" on dlopen.
- **Stale credentials.** CI uses an Apple ID app-specific password (`release.yml:81-83`), which breaks on account security changes. `altool` was retired in Nov 2023; notarytool is required.

**How to avoid:**
- Sign the engine binaries explicitly with their own `engine.entitlements.plist`, which has **only** `com.apple.security.cs.disable-library-validation`. Use `--options runtime --timestamp`, before or within electron-builder's `afterPack`. Then verify electron-builder didn't re-sign them with the inherit set.
- The app/helper entitlements get `allow-jit` only.
- Add a CI post-build gate on every artifact:
  - `codesign --verify --deep --strict`
  - `codesign -d --entitlements - <each engine binary>`, which must match the expected set
  - `spctl -a -vvv -t exec Spinarr.app`
  - `xcrun stapler validate`
  - `lipo -archs` on every Mach-O, which must match the dmg's arch
- Switch notarization to an App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`).
- Run an encrypted-disc smoke test on the **signed** artifact, not on the dev build. Library validation only bites once the binary is signed.

**Warning signs:** notarization log JSON lists `Contents/Resources/engine/*`; CSS rips work in `npm start` but fail in the installed app; `codesign -d --entitlements` on the main binary shows `disable-library-validation`.

**Phase to address:** A (signing), with a dependency on B (macOS profile must allow the signed engine's dlopen paths).
**Confidence:** HIGH.

---

### Pitfall 7: Windows signing planned around a PFX secret, and an expectation that signing removes SmartScreen

**What goes wrong:**
- **PFX files are no longer issued.** Since **1 June 2023**, CA/B Forum rules require publicly trusted code-signing keys to be generated and stored in FIPS 140-2 L2 / CC EAL4+ hardware. A new OV/EV cert cannot be issued as a `.pfx`, but `release.yml:84-85` still expects `WIN_CSC_LINK` as a base64 PFX.
- **Signing doesn't buy reputation.** **EV certificates no longer bypass SmartScreen** (Microsoft changed this in 2024; EV and OV now both build reputation). The first signed releases will still show "Windows protected your PC" until reputation accrues.
- **Unsigned PE files.** Engine `ffmpeg.exe`, `ffprobe.exe`, `dvdinfo.exe`, `bdinfo.exe`, the new sandbox launcher, and the NSIS uninstaller must all be signed. Unsigned children of a signed app are a classic AV-heuristic trigger.
- **Azure Artifact Signing quirks.** Azure Trusted Signing, renamed Azure Artifact Signing, issues short-lived certs, so **timestamping is mandatory**. electron-builder has a reported race when signing many files concurrently with it. Individual-developer identity validation is US/Canada only (Rick qualifies).

**How to avoid:**
- Use Artifact Signing via `win.azureSignOptions`, which is mutually exclusive with `signtoolOptions` in electron-builder 26. Authenticate through GitHub OIDC with a federated credential, not a client secret.
- Restrict signing jobs to tag pushes in a protected `release` environment with required reviewers.
- Add a CI gate: `Get-AuthenticodeSignature` over **every** PE in the unpacked app and installer, expecting `Valid` with a timestamp.
- Keep honest README copy: "signed by Rick Ramirez; Windows may still show a SmartScreen notice for new releases while reputation builds". Never tell users to disable SmartScreen.
- Submit early builds to Microsoft's WDSI portal if Defender flags them. Static mingw ffmpeg builds and NSIS stubs are frequent false positives.

**Warning signs:** a CA asking to ship a USB token; `SignerCertificate` present but `TimeStamperCertificate` null; beta testers reporting Defender quarantining `ffmpeg.exe`.

**Phase to address:** A.
**Confidence:** HIGH (CA/B Forum, Microsoft Learn, electron-builder docs).

---

### Pitfall 8: Verification that passes corrupted rips (silent bad-sector data and multi-clip desync)

**What goes wrong:** `ripVerdict` passes if the exit code is 0, there's no read-error text, and the **video** duration is ≥ 90% of expected. That misses two failure modes:
- **Silent corruption.** ffmpeg's own dvdvideo docs warn that *"some drives may silently fail on reading bad sectors from the disc, returning random bits instead … A second pass and integrity checks would be needed."* A scratched disc can therefore produce a full-duration MKV with garbage GOPs and no error text.
- **Multi-clip desync.** For Blu-ray, multi-clip playlists (seamless branching, obfuscated discs) produce timestamp discontinuities at clip boundaries. An audio track can drift or truncate while video duration still matches.
- **Missing streams.** Audio and subtitle completeness isn't checked at all, so streams that start in clip 2+ (only clip 0 is scanned today) silently vanish.

**How to avoid:**
- **Byte accounting.** The expected payload is known from the scan:
  - DVD: IFO cell sector ranges × 2048
  - BD: CLPI SPN counts × 192
  - Compare against bytes ffmpeg actually read (`-progress` `total_size` on input, or demuxer stats) within a tight tolerance.
- **Per-stream durations.** Every mapped stream's Matroska `DURATION` tag must be within ±1–2 s of expected. Document the tolerance with measured real-disc jitter, which answers audit question 3.
- **Decode-error pass (optional "Verify thoroughly").** Use `ffmpeg -v error -xerror -i out.mkv -map 0 -f null -` with decoders that are already compiled in. Count errors. Run it by default only on the last N% and around chapter and clip boundaries, to keep cost bounded.
- **Duration from the scan.** Take DVD durations from the scan cache (SF-9) before tightening anything, or the tighter check guards a renderer-supplied number.

**Warning signs:** a scratched-disc test that "passes" on the first try; Plex reports playback glitches in files Spinarr marked verified; video OK but audio track `DURATION` short.

**Phase to address:** D (verification), with E needing the multi-clip version.
**Confidence:** HIGH (ffmpeg docs for the silent-read problem). MEDIUM for BD discontinuity behaviour (needs real-disc confirmation).

---

### Pitfall 9: "AACS verified on a real disc" generalises from one disc and one drive state

**What goes wrong:**
- **Disc-specific success.** libaacs succeeds on a disc only if the user's KEYDB has a **VUK for that disc ID**, or a valid processing key and a **non-revoked host certificate**.
- **Bus encryption.** Bus-encrypted discs need a working host cert even when a VUK is present, because sectors are re-encrypted on the bus.
- **Permanent revocation.** Drives **permanently** revoke older host certs once they read a disc with a newer MKB. The MakeMKV forum has a thread specifically titled "BU40N – AACS host certificate is revoked", the same drive model Rick owns.
- **Test order can destroy the setup.** Inserting the newest disc first can make an older, previously-working libaacs setup fail on the same drive forever.
- **Opaque errors.** libaacs error codes (`AACS_ERROR_NO_CERT`, `CERT_REVOKED`, `MMC_FAILURE`, `NO_DK`) are opaque. Today the UI special-cases only −1 and −6.

**How to avoid:**
- Build the AACS matrix deliberately:
  - (a) a VUK-only disc with no bus encryption
  - (b) a bus-encrypted disc
  - (c) a disc not in KEYDB, which must produce a clear refusal
- Record the MKB version and drive firmware in `HARDWARE_TESTING.md`.
- Map every libaacs error code to a distinct, actionable message: "this disc's key isn't in your key file" vs "your drive rejects the host certificate" vs "your drive/firmware doesn't allow this".
- Never claim "AACS supported". Claim "AACS discs whose keys you provide".
- Read the libaacs/libbluray `BD_DEBUG` mask output into a diagnostics bundle for beta testers.

**Warning signs:** a test plan that says "one retail AACS disc"; support reports of "worked last week, now fails" after a new release was inserted.

**Phase to address:** E, recorded in G's hardware matrix.
**Confidence:** MEDIUM-HIGH (multiple MakeMKV/doom9 reports and ArchWiki; mechanics consistent with the AACS spec).

---

### Pitfall 10: Blu-ray main-feature pick crowns a decoy playlist

**What goes wrong:**
- **Decoy playlists.** Lionsgate (and some Disney/Sony) Blu-rays ship tens to hundreds of playlists with **identical duration, chapter count and size**, but with the clips in scrambled order. Picking the wrong one yields a "complete", verifiable, unwatchable movie. Spinarr's current dedupe makes the lowest-numbered decoy the main feature (audit §6).
- **BD-J selection.** On BD-J discs the real playlist is chosen by Java menu code. MakeMKV detects obfuscation and, for some discs, uses a Java runtime to resolve it. Community practice is to look the correct playlist up per title on the MakeMKV/AnyDVD forums.
- **Duration-only checks can't help.** Every candidate passes them.

**How to avoid:**
- Treat "≥2 candidates with the same clip **set** but a different clip **order**" as an explicit **obfuscation detected** state. Never auto-pick silently.
- Show candidates with a filmstrip: thumbnails at each chapter start, decoded in the sandbox, so the user can spot scrambled scenes.
- For HDMV (non-BD-J) discs, parse `MovieObject.bdmv` and `index.bdmv` to see which playlists the "Play" path actually references. This is cheap and deterministic.
- In batch mode, an obfuscated disc must **stop and ask**, never rip and eject.
- Keep the libbluray `bd_get_main_title()` result as one signal, not the decision.

**Warning signs:** a scan with >20 playlists of near-identical length; the duplicate-hiding logic hides 30+ titles on one disc.

**Phase to address:** E (and F's batch mode must respect it).
**Confidence:** MEDIUM on the phenomenon (multiple forums). LOW on any automatic resolution heuristic. Plan for user choice.

---

### Pitfall 11: Network-sourced metadata becomes a path-traversal and privacy channel (TMDB)

**What goes wrong:**
- **Path traversal.** TMDB titles contain `/`, `:`, `?`, `*`, trailing dots, and Windows reserved names: "AC/DC: Let There Be Rock" and "What If…?", for example. Fed into `Show/Season NN/...` path templates, they create unintended subdirectories or invalid names. **Network data is as untrusted as disc data.**
- **Privacy.** The disc volume label is sent to TMDB, so TMDB learns what the user owns.
- **CSP pressure.** Posters require loosening the renderer CSP (`img-src`), which today is `connect-src 'none'`.
- **Shared key revocation.** An API key embedded in an OSS repo is shared by every install. If someone abuses it (it's trivially extractable), TMDB revokes it and every copy's lookup breaks at once.
- **Attribution.** TMDB's terms require the notice *"This product uses the TMDB API but is not endorsed or certified by TMDB"*, plus the TMDB logo (less prominent than yours), in an About/Credits section.
- **Rate limits.** The rate limit is "somewhere in the 40 requests per second range" per TMDB's docs, subject to change. Honour 429s. Batch mode across a shelf can burst.

**How to avoid:**
- Pass every TMDB string through the same `safeFile` path as disc labels, and add tests with hostile titles: `..`, `/`, `CON`, trailing `.`, 300-char names, RTL override characters.
- Keep requests in main via Electron `net` with a fixed host allowlist (`api.themoviedb.org`, `image.tmdb.org`).
- Make the feature opt-in with a first-use disclosure: "sends the disc title to TMDB".
- Ship an app key with a user-override field and graceful 401/429 handling ("lookup unavailable, name manually"). Cache results locally.
- Fetch posters in main and pass them as `data:` URLs, so the CSP stays tight. Or skip posters for 1.0.
- Add the attribution and logo to About, plus a test that asserts it exists.

**Warning signs:** a TV rip lands in `Season 01/AC/DC...`; CSP diff in a TMDB PR; the key hard-coded in `renderer/`.

**Phase to address:** F.
**Confidence:** HIGH (TMDB ToS/FAQ/rate-limit docs).

---

### Pitfall 12: TV episode detection that trusts duration clusters and title order

**What goes wrong:** Real TV DVDs and BDs break naive heuristics in several ways:
- **"Play all" titles.** A "play all" title is the concatenation of episode PGCs or playlists. Today it wins main feature because it's longest.
- **Episodes as chapters.** Some discs store episodes as **chapters of a single title**.
- **Title order ≠ episode order.**
- **Shared cells.** Recap, intro and credit cells are shared across titles, which fools byte-based duplicate detection.
- **Lookalike extras.** A 22-minute featurette clusters with episodes.
- **Length outliers.** Double-length pilots fall outside the cluster.
- **Multi-disc numbering.** Disc 2 starts mid-season.
- **Aired vs DVD order.** TMDB and Plex default to **aired** order, and DVD order differs for many shows (Firefly and Futurama are canonical examples). Plex lets a show use TVDB ordering instead. Jellyfin's TMDB provider historically lacked episode-group support (jellyfin#4322). Auto-numbering "correctly" by disc order therefore still mismatches the user's server.

**How to avoid:**
- Detect "play all" structurally, not by duration sums: a title whose **cell or sector ranges (DVD) or clip IDs (BD)** are the union of ≥2 other titles. Extend `dvdinfo` to emit cell sector ranges, which also helps byte accounting (Pitfall 8).
- Offer a "split by chapters" mode for single-title episode discs.
- Always show a confirmable episode table: the user sets starting season and episode. Persist a per-series counter across a batch.
- Make "Aired / DVD order" an explicit choice, shown next to the TMDB match.
- Send extras to `Extras/` (or Plex/Jellyfin's `Featurettes/`, `Deleted Scenes/`, etc.) rather than numbering them.

**Warning signs:** a 4-episode disc producing 5 "episodes"; a 3-hour "S01E01"; users renaming files after every rip.

**Phase to address:** F.
**Confidence:** MEDIUM (domain knowledge plus Jellyfin/Plex ordering docs and issues).

---

### Pitfall 13: Output naming that is right for Plex and wrong for Jellyfin, NAS shares, or Windows

**What goes wrong:**
- **Provider ID syntax differs.** Plex uses `{tmdb-12345}` and `{edition-Director's Cut}`. Jellyfin uses `[tmdbid-12345]`, and different edition and version syntax. Picking one silently degrades matching on the other.
- **SMB character mapping.** Colons written from macOS to SMB shares are mapped by SFM to private-use code points. The Linux NAS running Plex then sees a garbage character.
- **Windows path limits.** The Windows 260-char path limit is hit by `Show (Year)/Season 01/Show (Year) - S01E01 - Long Episode Title.mkv` on a deep NAS path.
- **FAT32 file size.** FAT32 USB drives cap files at 4 GiB, so ffmpeg fails at the 4 GB mark with "File too large". On a DVD that happens near the end of the rip, after 15+ minutes.

**How to avoid:**
- Add a "Media server: Plex / Jellyfin / generic" setting that selects the ID and edition syntax. Default to no ID tag if the TMDB match is unconfirmed.
- Use a cross-platform filename normaliser: replace `:` with ` - `; strip `<>:"/\|?*`, control characters and trailing `. `; avoid reserved names; cap components at ~200 bytes UTF-8.
- Preflight the output filesystem with `statfs` (`fs.statfsSync` is already used in `main.js:483`). Refuse FAT32 for titles >4 GiB, check free space ≥ expected bytes × 1.05, and warn on network filesystems.
- Test long paths on Windows: Node handles `\\?\` itself, but ffmpeg's long-path handling must be checked with a >260-char path.

**Warning signs:** Plex shows "Unmatched" for every Jellyfin-style name; filenames containing `` on the NAS; rips failing at exactly 4,294,967,295 bytes.

**Phase to address:** F (naming) and D (preflight).
**Confidence:** HIGH for FAT32 and the Plex/Jellyfin syntax difference. MEDIUM for SFM colon mapping and ffmpeg long paths.

---

### Pitfall 14: "Atomic" output that isn't: rename overwrites, fsync semantics, and AV locks

**What goes wrong:**
- **Node's rename always overwrites.** `fs.rename` replaces existing files on POSIX, and libuv uses `MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)` on Windows. A "no-overwrite" guarantee built on exists-check-then-rename is a TOCTOU (SF-10). The engine also runs with `-y` (`lib.js:72`).
- **Windows rename EPERM.** On Windows, renames fail transiently with `EPERM`/`EBUSY` while Defender (or Plex's scanner, or Windows Search) holds the fresh 30 GB file. That's why `graceful-fs` and `write-file-atomic` retry renames for up to 60 s.
- **fsync is not uniform.** Node's `fsync` on macOS maps to `F_FULLFSYNC` (libuv), which is correct but slow. On SMB/exFAT it may be slow or unsupported, and a 50 GB file on a USB HDD can take minutes to flush. Treating an fsync error as a failed rip throws away a good 50 GB file. Treating it as silent hides durability.
- **Directory fsync.** On Linux, durability of the rename itself needs an fsync of the **directory**.

**How to avoid:**
- **Exclusive create.** Have main open the `.part` with exclusive-create and no-follow (`wx` plus an `lstat` check on the parent), then pass it to ffmpeg as `fd:`. This removes ffmpeg's `-y` and closes the symlink and overwrite race in one move.
- **Exclusive final placement.** Use `fs.linkSync(part, final)` and then unlink the part: `link` fails atomically with `EEXIST`. Fall back to rename-with-recheck only on filesystems without hard links (FAT, exFAT, some SMB) and record that in the log.
- **Windows retries.** Retry `EPERM`/`EBUSY`/`EACCES` with backoff for up to ~60 s on Windows.
- **Flush policy.** fsync the file, then the directory (POSIX). Show a "Finishing (flushing to disk)…" state. Treat `ENOTSUP`/`EINVAL` from fsync on network filesystems as a logged warning, not a failure.
- **Cleanup.** On next launch, sweep `*.mkv.part` older than the current session in known output folders. Fix the Windows quit path that leaves `.part` behind (R-16).

**Warning signs:** `EPERM: operation not permitted, rename` in Windows beta logs; a second rip of the same title replacing the first; `.part` files in Plex's "unmatched" view.

**Phase to address:** D.
**Confidence:** HIGH (libuv/graceful-fs history, libuv `F_FULLFSYNC`).

---

### Pitfall 15: Legal self-harm: linking to decryption tools, naming retail titles, "bypass" marketing

**What goes wrong:**
The pattern from history is that **trafficking** in circumvention tools (17 U.S.C. §1201(a)(2)/(b)(1)) is what kills projects, not individual use:
- **Universal v. Reimerdes / Corley (2000–2001):** enjoined *posting and hyperlinking* DeCSS.
- **DVDFab:** AACS LA won an injunction in 2014 and ~$15M later, with domains seized and intermediaries ordered to cut off service.
- **SlySoft (AnyDVD):** closed in Feb 2016 after AACS LA pushed the USTR to pressure Antigua. Its successor RedFox vanished in 2024.
- **youtube-dl (2020):** the RIAA's §1201 takedown on GitHub cited **test cases naming specific copyrighted works**. It was reinstated after EFF intervened and those references were removed. GitHub now reviews §1201 claims with experts and runs a developer defense fund.

The US Copyright Office has **repeatedly declined** a personal space-shifting exemption, most recently in the 2021 and 2024 triennial rulemakings. "It's my disc" is not a §1201 defence.

Concrete Spinarr exposure found while researching:
- **Rule violation in the README.** `README.md:69` links directly to VideoLAN's `libdvdcss` Windows DLL download. PROJECT.md's Out of Scope explicitly rules out "linking to … libdvdcss/libaacs".
- **Named retail titles.** `docs/HARDWARE_TESTING.md:7,29` and `test/unit/lib.test.js:246` name a specific commercial CSS title ("Space Jam SE"), which is exactly the youtube-dl fact pattern.
- **Out-of-repo test notes.** Maintainer notes reference specific retail AACS titles. Keep those out of the repo.

**How to avoid:**
- Neutral references: "the libdvdcss library from your OS package manager or its upstream project", with no direct binary links or key-database links. Never link FindVUK or KEYDB sources.
- Replace retail titles in docs and tests with neutral descriptors ("Commercial R1 CSS DVD-9, sample A") and synthetic labels (`SAMPLE_SE_DISC_1`).
- Vocabulary: "back up discs you own", "uses decryption libraries you install". Never "remove copy protection", "bypass", or "crack". Settings copy should match.
- Keep a takedown runbook: a mirror (Codeberg/GitLab), the GitHub counter-notice process, and the EFF contact. Don't rewrite history (consistent with PROJECT.md).
- Get one hour with a lawyer or the EFF before 1.0's public announcement, especially for the "Install KEYDB.cfg" UX and AACS wording.

**Warning signs:** any PR adding "download libaacs/KEYDB for me"; issue templates asking users to paste KEYDB lines; a release note naming a studio title.

**Phase to address:** H. The README link and named titles are quick fixes, so do them in the first phase.
**Confidence:** HIGH on the case history (EFF, TorrentFreak, Copyright Office). This is not legal advice; flag for counsel.

---

### Pitfall 16: GPL binaries without a working corresponding-source path

**What goes wrong:**
- **Source tarballs aren't in the repo.** The engine is a GPLv3 combined work (`--enable-gpl --enable-version3`, statically linking GPL-2.0+ libdvdread/libdvdnav and LGPL libbluray). The upstream tarballs it's built from are **gitignored** (`engine/deps/`), so GitHub's auto-generated source zip for a tag does **not** contain the corresponding source.
- **Upstream may not keep old tarballs.** GPLv3 §6(d) allows pointing at a third-party server only if *you* ensure it stays available while you offer the binary. Upstream mirrors do prune old releases.
- **Missing notices.** Windows mingw builds also statically pull in libgcc/winpthreads, which need notices. Electron's `LICENSES.chromium.html` must survive packaging.
- **Mac App Store is not an option.** It is GPL-incompatible (VLC was removed in 2011). This is already out of scope.

**How to avoid:**
- Attach `spinarr-<ver>-engine-src.tar.xz` to every release, containing the upstream tarballs, the six patches, `build.sh`, and the toolchain versions. Reference it from an in-app "Licenses & Source" screen and from a `THIRD_PARTY_NOTICES` file in each bundle.
- Add a CI check that each installer contains the notices file and that the release has the source asset.
- Make the `build.sh` linkage check **fail**, not warn (DD: `RELEASING.md:39` vs `build.sh:124`), so a binary can't accidentally link something whose license you didn't list.

**Warning signs:** a release with no `*-src.tar.xz`; `LICENSES.chromium.html` missing from `Resources/`; a bug report asking "where's the ffmpeg source for 1.0.2?"

**Phase to address:** A (notices in bundles, source asset in the release workflow) and H.
**Confidence:** HIGH.

---

## Moderate Pitfalls

### Pitfall 17: Sleep, App Nap and USB power management kill long Blu-ray rips
**What goes wrong:**
- A 25–50 GB rip on a USB BD drive takes 30–90 min at riplock-limited speeds.
- The system sleeps or the display locks, the USB drive is suspended, and the engine gets EIO.
- On macOS, App Nap throttles the main process's progress IPC.
- There is no `powerSaveBlocker` anywhere in `app/` today.

**Prevention:**
- Call `powerSaveBlocker.start('prevent-app-suspension')` per job and release it on completion or cancel.
- Map EIO-after-resume to "the computer went to sleep" rather than "scratched disc".
- **Area:** D. **Confidence:** HIGH that the blocker is absent and that Electron provides it; MEDIUM on the failure symptom.

### Pitfall 18: Read-error "retry" that re-reads the whole title
**What goes wrong:**
- A naive Retry button re-runs ffmpeg from sector 0.
- On a scratched disc the drive's internal retries take 10–120 s per bad sector, so each attempt costs the full rip time plus the stalls.
- Retry also makes zero-filled or garbage sectors (Pitfall 8) more likely to pass.
- USB drives can hang rather than error, and the scan's 180 s timeout then misfires.

**Prevention:**
- Define behaviour first: a retry count, a "skip unreadable sectors" option **only** with an explicit "imperfect copy" label, and a log of the sector ranges skipped.
- For 1.0, a whole-job retry with a clean error is acceptable if verification is strong.
- Sector-level imaging with retries (the ddrescue model) is a post-1.0 feature.
- Make timeouts progress-based: no bytes for N s means stalled. Don't use wall-clock limits.
- **Area:** D. **Confidence:** MEDIUM.

### Pitfall 19: Multi-angle: passing `-angle` isn't enough
**What goes wrong:**
- ffmpeg's dvdvideo demuxer accepts `angle` and also a `region` option. Its docs note that *"some discs may use this to default playback at a particular angle in different regions"*.
- Scan-time angle counts can differ per chapter: only some cells are multi-angle.
- Verification must confirm the chosen angle was ripped. Durations are identical across angles, so duration checks prove nothing.

**Prevention:**
- Pass both `-angle N` and an explicit `-region` (matching the drive's region).
- Verify by comparing a decoded frame hash at a known multi-angle cell against a per-angle reference produced during scan, or at minimum by byte counts of the angle's cells.
- **Area:** D. **Confidence:** MEDIUM (ffmpeg docs verified; the verification method is a proposal).

### Pitfall 20: macOS TCC prompts and identity churn
**What goes wrong:**
- macOS asks for "Removable Volumes", "Network Volumes" and "Documents/Desktop" access the first time.
- Denials surface as `EPERM` that looks like a sandbox or engine failure.
- Moving from ad-hoc to Developer ID changes the code identity, so earlier grants don't carry over and users get re-prompted.

**Prevention:**
- Detect `EPERM` on the source or output outside the engine sandbox and show a TCC-specific message with a "Open Privacy Settings" button.
- Mention the one-time re-prompt in the 1.0 release notes.
- **Area:** A/G. **Confidence:** MEDIUM.

### Pitfall 21: Fuzzing in CI that is noisy, short, or fuzzes the wrong binary
**What goes wrong:**
- **Apple clang has no libFuzzer runtime.** `libclang_rt.fuzzer_osx.a not found`, so macOS CI needs Homebrew LLVM. Linux runners are simpler.
- **Short runs find little.** 5-minute PR fuzz runs rarely find anything new without a persisted corpus.
- **Leak noise.** libdvdread leaks on error paths, so every run "fails" under LeakSanitizer.
- **Wrong target.** Harnesses built against upstream libs instead of the **patched** engine libs fuzz code you don't ship.
- **Public crash artifacts.** Crash inputs uploaded as artifacts on a public repo publicly disclose unfixed memory bugs.
- **Coverage gaps.** **libdvdread, libdvdnav and libbluray are not in OSS-Fuzz** (no `projects/<name>` there; ffmpeg is). Nobody else is fuzzing Spinarr's highest-risk parsers. ffmpeg's OSS-Fuzz build likely doesn't enable libdvdnav, so the dvdvideo demuxer path is probably unfuzzed too (LOW).

**Prevention:**
- Use **ClusterFuzzLite** on Linux: PR mode (short), a nightly batch (long), and a persisted corpus with pruning.
- Build sanitizer variants from `engine/build.sh` with the same patches.
- In-memory harnesses: `DVDOpenStream` with callbacks for libdvdread; the filesystem-callback open for libbluray (verify the API in 1.5.0).
- Set `-rss_limit_mb`/`-malloc_limit_mb`, and `detect_leaks=0` until leaks are triaged.
- Route crashes to private advisories, not public artifacts.
- Replay the crash corpus under ASan as a required check.
- **Area:** C. **Confidence:** HIGH (Apple clang, OSS-Fuzz presence checked via the repo). MEDIUM (exact harness APIs).

### Pitfall 22: VM USB passthrough results treated as hardware validation
**What goes wrong:**
- **Host contention.** The macOS host grabs and mounts the disc before the VM claims the drive. libaacs or DVD Player on the host may hold it.
- **Bus mismatch.** BD drives need the VM's USB 3 (xHCI) controller; on USB 2 emulation they enumerate as CD-only or time out.
- **Timing artifacts.** USB redirection adds latency, so scratched-disc stalls cause guest-side USB resets that real hardware wouldn't have, and the reverse.
- **Linux device ACLs.** On a headless Linux guest over SSH, `/dev/sr0` is not accessible: logind's `uaccess` ACL applies only to the active local seat, so tests fail unless the user is in `cdrom`/`optical`.
- **Persistent drive state.** AACS host-cert revocation (Pitfall 9) follows the **drive**, across host and guests.

**Prevention:**
- Eject and unmount on the host first, and disable the host's "When you insert a video DVD" action.
- Use a VMware Fusion (free for personal use) or VirtualBox USB 3 controller, and record the hypervisor and version in each result.
- Run Linux guest tests in a logged-in desktop session.
- Label VM results "VM-validated", distinct from "hardware-validated" by beta testers.
- Collect drive model, firmware and USB bridge in a diagnostics bundle.
- **Area:** G. **Confidence:** MEDIUM (VirtualBox forum reports plus logind behaviour).

### Pitfall 23: Beta program without a diagnostics bundle
**What goes wrong:**
- With no in-house Windows, Linux or Apple Silicon hardware, beta reports like "it didn't work" are unactionable.
- Users paste logs containing disc titles, home paths and KEYDB fragments.

**Prevention:**
- Add a "Copy diagnostics" action. It should include: versions, OS/arch, sandbox kind and probe result, drive model and firmware, libdvdcss/libaacs found and their architecture, libaacs error codes, and the last N engine stderr lines.
- It must exclude: paths (relativised), volume labels (hashed), and anything from KEYDB.
- Use an issue form that requests it.
- **Area:** G. **Confidence:** HIGH (process).

### Pitfall 24: Disc auto-scan gate implemented as a UI toggle rather than an engine-level invariant
**What goes wrong:**
- "Never auto-scan unsandboxed" is enforced in renderer code.
- A new code path (drag-and-drop of an ISO, batch mode's insert loop, a retry) calls `scan` without going through the gate.

**Prevention:**
- Enforce it in main: `runEngine` refuses auto-triggered scans when `sandboxKind !== active`, and requires an explicit user-intent flag tied to a click.
- Batch mode must check the same invariant.
- Add an e2e test per entry point.
- **Area:** B/F. **Confidence:** HIGH (design).

---

## Minor Pitfalls

### Pitfall 25: Drive region and riplock surprises
**What goes wrong:**
- RPC-2 drives with no region set refuse CSS reads.
- libdvdcss falls back to slow title-key cracking on region mismatch (minutes, which looks like a hang).
- Region changes are limited (usually 5).
- "Riplock" firmware caps video-disc read speed, so ETAs look broken.

**Prevention:**
- Never set the region programmatically.
- Show "drive region not set" distinctly.
- Base the ETA on measured throughput, not nominal drive speed.

### Pitfall 26: Leftover `app-update.yml` and an "update available" notice
**What goes wrong:**
- electron-builder still writes `Resources/app-update.yml` even though there's no updater.
- A "new version" check that fetches GitHub releases from the renderer would violate the CSP.

**Prevention:**
- Strip the file.
- Do the release check in main, with an opt-out, against the GitHub API only.

### Pitfall 27: Apple Silicon users running the x64 build (or Intel Homebrew under Rosetta)
**What goes wrong:**
- dlopen fails with "incompatible architecture" and is reported as "libdvdcss not installed".

**Prevention:**
- Parse dlopen errors for architecture mismatch and tell the user which build or which Homebrew to use.
- CI's `macos-14` runner is arm64, so test dlopen there with arm64 Homebrew libs.

### Pitfall 28: Unsigned `SHA256SUMS.txt` next to the files it covers
**What goes wrong:**
- Checksums hosted beside the artifacts add nothing against a compromised release.

**Prevention:**
- Use GitHub artifact attestations (`actions/attest-build-provenance`) plus a Sigstore/minisign-signed checksum file.
- Document `gh attestation verify`.

### Pitfall 29: Signing secrets reachable from PR workflows
**What goes wrong:**
- Any workflow on `pull_request_target`, or with mutable-tag actions holding `contents: write`, can exfiltrate signing credentials.
- This is SF-5, but the impact grows once real certs exist.

**Prevention:**
- Run signing only in a `release` environment with required reviewers.
- Pin actions by SHA.
- Use OIDC federation for Azure.
- Use an App Store Connect API key scoped to Developer role.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Select bwrap by file existence, no probe | Zero code | Every scan fails on Ubuntu 24.04+; SF-1 gate can't key off reality | Never (fix in B) |
| `(import "bsd.sb")` in the macOS profile | Profile works first try | Silently re-allows pasteboard/LaunchServices; SF-2 not actually closed | Never |
| One entitlements file for app + engine | Simpler config | Library validation off for Electron main/helpers (SF-6) | Never once Developer ID-signed |
| `ffmpeg -y` + exists-check + `renameSync` | Simple | TOCTOU/overwrite; Windows rename EPERM; no durability | Only until D lands |
| Video-duration ≥90% verification | Catches early stops | Passes silent bad-sector corruption and missing audio/subs | Never for 1.0 (core value) |
| Embedded TMDB key, no override | Works out of the box | One abuse revokes lookup for every install | OK if paired with override + graceful 401 |
| Restricted-token-only Windows sandbox (no network block) | Avoids AppContainer device issues | Engine compromise has network | Only if documented and the auto-scan gate stays; prefer the fd-broker + AppContainer design if the spike allows |
| Random-mutation fuzzers labelled "coverage-guided" | Looks done | Doc/reality gap (DD); weak bug finding | Never: rename or replace with libFuzzer |
| Hard-coded Homebrew prefixes in patches | Works on default installs | MacPorts/custom prefixes fail; user-writable dylib path (SF-11) | Acceptable for 1.0 with a clear error |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Apple notarytool | Apple ID + app-specific password; signing only the `.app`, not `extraResources` Mach-Os | API key auth; explicitly sign every Mach-O with runtime + timestamp; `stapler validate` gate |
| Azure Artifact Signing | Client secret in repo secrets; parallel signing race; no timestamp | OIDC federated credential; serialize or retry signing; timestamp always; verify every PE |
| libaacs (macOS) | Assume the mount path is stable | It force-unmounts and remounts via DiskArbitration; key jobs by device/UUID |
| libaacs (Windows) | Assume read-only device handles suffice | SPTI needs `GENERIC_READ|GENERIC_WRITE` on `\\.\X:` |
| libaacs (Linux) | Assume SG_IO needs write access | Verified non-issue: kernel `scsi_cmd_allowed()` permits `REPORT_KEY` and `MAINTENANCE_IN`/`SEND_KEY` (0xA3) on read-only fds, so `O_RDONLY` in bwrap is fine |
| bubblewrap | `--seccomp` filter that denies `execve` | Filter persists across exec; deny execve in-process after startup |
| ffmpeg output | `pipe:` for broker-controlled output | `fd:` protocol (seekable on regular files); add `--enable-protocol=fd` |
| ffmpeg bluray: | Trust initial stream probe | Streams starting in later clips get missed; map by PID from the multi-clip scan |
| TMDB | Treat responses as trusted, auto-accept first hit, omit attribution | Sanitize to filenames; user confirms match; About-screen notice + logo; honour 429 |
| Plex vs Jellyfin | One naming syntax | Server-specific ID/edition syntax setting |
| GitHub releases | Rely on auto source zip for GPL | Attach full engine source bundle per release |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No sleep prevention | EIO mid-rip after ~30 min idle | `powerSaveBlocker('prevent-app-suspension')` per job | Any BD rip longer than the sleep timer |
| fsync of 50 GB on USB HDD/SMB | "Stuck at 100%" for minutes | Explicit "Flushing" state; fsync as a separate step with its own progress text | Files >10 GB on slow media |
| Full decode verification by default | Verification takes as long as the rip | Byte accounting + per-stream durations by default; full decode opt-in | Any BD |
| Wall-clock timeouts (scan 180 s) | Scratched discs or libdvdcss key cracking "time out" | Progress-based stall detection | Damaged discs, region-mismatch CSS |
| Whole-title retry | Each retry costs full rip time | Bounded retries, clear failure, post-1.0 sector imaging | Scratched discs |
| Free space checked once | ENOSPC at 48 GB of 50 GB | Preflight ≥ expected × 1.05; watch during rip; clean `.part` on ENOSPC | NAS/USB targets near full |
| Batch TMDB lookups | 429s mid-shelf | Cache + serial requests + backoff | Large batch sessions |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Auto-scan when the sandbox probe failed | Zero-click C parser exposure at user privilege (SF-1) | Main-process invariant, all entry points, e2e per entry point |
| AACS profile variant used for all discs | DiskArbitration/IOKit power granted when not needed | Select profile by scan-reported encryption |
| Chromium-style signature mitigation on Windows engine | User libdvdcss DLL can't load, so pressure to disable the sandbox entirely | Omit MicrosoftSignedOnly; keep the DLL folder ACL'd to the user only |
| ACL grants to the AppContainer SID left on user folders | Persistent permission changes on Documents/NAS | Broker-owned fd output; no ACL edits on user data |
| TMDB strings in paths/HTML unescaped | Path traversal, stored XSS in renderer | Same `safeFile` + `esc()` as disc data; hostile-title tests |
| Crash inputs as public CI artifacts | Disclosure of unpatched parser bugs | Private storage; advisories |
| Signing creds reachable from PR CI | Malware signed as Spinarr | Protected environment, OIDC, SHA-pinned actions |
| Homebrew dylib path user-writable (SF-11) | Persistence via the dylib the engine loads | Accept (it's inside the sandbox) but document; the deny-default profile still applies |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| One "can't decrypt" message for every libaacs error | Users can't tell a missing key from a revoked drive | Distinct message per libaacs error code |
| Silent auto-pick on obfuscated BDs | Unwatchable "verified" rip, discovered weeks later in Plex | "Obfuscation detected: choose" with chapter filmstrip |
| Batch mode that never stops | Bad discs, obfuscated discs, TV discs ripped wrong, then ejected | Batch stops on any ambiguity (obfuscation, TV numbering, low-confidence TMDB match) |
| SmartScreen/Gatekeeper copy that says "bypass" | Trains users into unsafe habits; contradicts signed 1.0 | Signed builds; honest note that SmartScreen may still warn for new releases |
| TCC denial shown as engine error | Users blame the disc | TCC-specific error + settings deep link |
| Sandbox status hidden | Users on Ubuntu 24.04 don't know they're unprotected | Persistent status chip: Sandboxed / Not sandboxed (why) |
| Aired vs DVD order not exposed | Episodes mismatched in Plex | Explicit order choice next to the TMDB match |

## "Looks Done But Isn't" Checklist

- [ ] **Notarization:** `spctl` accepts the app, *and* an encrypted DVD rips from the **installed, signed** app (library validation only bites when signed).
- [ ] **Engine entitlements:** `codesign -d --entitlements -` shows `disable-library-validation` on engine binaries only, not on `Spinarr` or the Helpers.
- [ ] **Windows signing:** every PE (app, engine exes, launcher, installer, uninstaller) is `Valid` with a timestamp.
- [ ] **macOS profile:** the denial tests (`/tmp`, `$HOME` stat, pasteboard, LaunchServices, TCP/UDP) pass, *and* AACS works under the AACS variant on the real BU40N.
- [ ] **Linux sandbox:** works on stock Ubuntu 24.04 (or clearly reports unavailable, with auto-scan off); the AppImage renderer isn't running `--no-sandbox` without a warning.
- [ ] **seccomp:** loads on x86_64 *and* arm64; `socket(AF_INET)` denied; `execve` denied post-init.
- [ ] **Windows sandbox:** the spike matrix is recorded; network `connect()` fails from the engine; output is written via a broker handle; NAS output works.
- [ ] **Verification:** a deliberately corrupted fixture (zeroed sectors mid-title) **fails**; a fixture with an audio track truncated at 80% **fails**.
- [ ] **Durability:** kill -9 during the rename window leaves no `.part` after next launch; no overwrite when the target appears mid-rip (race test).
- [ ] **FAT32:** a rip >4 GiB to FAT32 is refused at preflight, not at minute 15.
- [ ] **Obfuscation:** a synthetic BD with 10 same-length, reordered-clip playlists triggers "choose", not an auto-pick.
- [ ] **TV:** a "play all" fixture is excluded structurally (cell/clip overlap); disc 2 continues numbering.
- [ ] **TMDB:** attribution in About; hostile-title tests; works with the key revoked (graceful fallback).
- [ ] **GPL:** the release has an `-engine-src.tar.xz`; bundles contain `THIRD_PARTY_NOTICES` and `LICENSES.chromium.html`.
- [ ] **Legal hygiene:** no direct decryption-library download links; no retail titles in repo docs or tests.
- [ ] **Power:** a 60-minute rip survives the display sleep timer.
- [ ] **AACS matrix:** VUK-only, bus-encrypted, and not-in-KEYDB cases all recorded with drive firmware and MKB version.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| AppContainer can't access the device (Pitfall 1) | MEDIUM | Fall back to restricted token + job + low IL for CSS. Narrow device-helper for AACS, or AACS-on-Windows in a documented weaker mode. Keep the auto-scan gate |
| Notarized build breaks dlopen (6) | LOW | Re-sign the engine with the engine-only entitlements; ship x.y.1 |
| Signing key/credential leak (29) | HIGH | Revoke the Developer ID cert / Artifact Signing profile; publish an advisory; re-sign; rotate OIDC trust |
| Drive host-cert revoked during testing (9) | MEDIUM (per drive) | Continue with VUK-only discs; document; can't be undone in firmware by Spinarr |
| Shipped corrupted "verified" rips (8) | HIGH (trust) | Advisory + a "re-verify library" tool that runs the decode pass over existing MKVs |
| §1201 takedown notice (15) | MEDIUM | Follow GitHub's 1201 review/counter-notice; remove any cited references; mirror; EFF contact |
| TMDB key revoked (11) | LOW | User-override key; new app key in the next release; feature degrades gracefully |
| GPL source request without assets (16) | LOW | Publish a source bundle for every shipped version from tags + `engine/build.sh` pins |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Windows device access / AppContainer | B (spike first), gates E-Windows | Recorded spike matrix; e2e: engine `connect()` fails, rip to NAS works |
| 2 libaacs unmount vs watcher | E + B-macOS | Real BU40N AACS rip completes inside the deny-default AACS profile |
| 3 macOS deny-default profile | B | Denial assertion tests on Intel + `macos-14` arm64; translocation launch test |
| 4 Ubuntu 24.04 bwrap / Electron sandbox | B + G | `ubuntu-24.04` CI job; probe result in UI; no silent `--no-sandbox` |
| 5 seccomp design | B | Per-arch filter-load test; denied-syscall probes |
| 6 macOS signing/entitlements | A | Post-build codesign/spctl/stapler/lipo gate; signed-artifact CSS smoke |
| 7 Windows signing/SmartScreen | A | Authenticode gate on all PEs; honest README copy |
| 8 Verification strength | D (+E for multi-clip) | Corrupted-sector and truncated-audio fixtures fail |
| 9 AACS generalisation | E + G | AACS matrix recorded with firmware/MKB |
| 10 BD obfuscation | E | Synthetic decoy-playlist fixture triggers "choose" |
| 11 TMDB safety/ToS | F | Hostile-title tests; attribution test; revoked-key test |
| 12 TV detection | F | Play-all/chapter-episode fixtures; numbering continuity |
| 13 Naming/filesystems | F + D | Plex/Jellyfin syntax tests; FAT32 preflight test; long-path Windows test |
| 14 Atomic output/fsync | D | Race and kill tests; Windows EPERM retry test |
| 15 Legal hygiene | H (quick fixes in the first phase) | grep gate in CI for download links/retail titles |
| 16 GPL source | A + H | Release workflow asserts source asset + notices present |
| 17 Sleep | D | Long-rip test with sleep timer |
| 21 Fuzzing | C | ClusterFuzzLite running; ASan corpus replay required check |
| 22–23 VM/beta | G | VM vs hardware labels in the matrix; diagnostics bundle in issue form |
| 24 Auto-scan gate | B (+F batch) | e2e per scan entry point with sandbox forced off |

**Ordering implications for the roadmap:**
1. **H quick fixes and A's CI hardening first.** They're cheap and prerequisites for real signing credentials existing safely.
2. **B before E.** The macOS AACS profile variant and the Windows device-access spike decide what "AACS end-to-end, sandboxed" can mean.
3. **D's verification before E and F.** Blu-ray multi-clip and batch mode both depend on verification that actually fails bad rips.
4. **Within F, naming before TMDB.** Filename sanitisation must exist before any network data reaches paths.
5. **G throughout, release-candidate matrix last.** Beta testers need signed builds (A) and a diagnostics bundle before the call goes out.

**Research flags (need deeper, phase-specific research):**
- **B, Windows:** sandbox device access (spike required; LOW-MEDIUM confidence today).
- **B, Linux:** exact syscall allowlist for the static ffmpeg plus user libaacs (derive with `strace`).
- **E:** BD obfuscation resolution, HDMV `MovieObject` parsing, and ffmpeg's behaviour at clip discontinuities.
- **C:** confirm libbluray 1.5.0's in-memory/filesystem-callback open API for harnesses.

## Sources

**Vendor / official docs (HIGH)**
- ffmpeg dvdvideo demuxer docs (silent bad-sector reads, `angle`/`region` options): https://ffmpeg.org/ffmpeg-formats.html#dvdvideo
- ffmpeg `fd` protocol (seekable on regular files): https://ffmpeg.org/ffmpeg-protocols.html#fd
- Microsoft, IOCTL_SCSI_PASS_THROUGH_DIRECT (handle needs read+write): https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddscsi/ni-ntddscsi-ioctl_scsi_pass_through_direct
- Microsoft, SmartScreen reputation: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- Microsoft, Code signing options / Artifact Signing: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options ; https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
- CA/Browser Forum Code Signing Baseline Requirements (HSM key storage since 2023-06-01): https://cabforum.org/working-groups/code-signing/requirements/
- electron-builder Windows signing and notarization: https://www.electron.build/docs/features/code-signing/code-signing-win/ ; https://www.electron.build/docs/features/code-signing/notarization/
- TMDB API Terms of Use / FAQ / rate limiting: https://www.themoviedb.org/api-terms-of-use ; https://developer.themoviedb.org/docs/faq ; https://developer.themoviedb.org/docs/rate-limiting
- Jellyfin movie naming: https://jellyfin.org/docs/general/server/media/movies/
- libuv fs docs (fsync → F_FULLFSYNC on macOS): https://docs.libuv.org/en/v1.x/fs.html
- US Copyright Office 1201 rulemakings (no space-shifting exemption): https://www.copyright.gov/1201/2024/2024_Section_1201_Registers_Recommendation.pdf ; https://cdn.loc.gov/copyright/1201/2021/2021_Section_1201_Registers_Recommendation.pdf

**Upstream source read directly (HIGH)**
- libaacs `src/file/mmc_device_darwin.c` (`DADiskUnmount` with `kDADiskUnmountOptionForce`, SCSITask exclusive access): https://code.videolan.org/videolan/libaacs/-/blob/master/src/file/mmc_device_darwin.c
- libaacs `mmc_device_win32.c` and `mmc_device_linux.c` (open flags): https://code.videolan.org/videolan/libaacs/-/tree/master/src/file
- libdvdcss `src/device.c` (Windows `\\.\X:` open modes): https://code.videolan.org/videolan/libdvdcss/-/blob/master/src/device.c
- Linux `drivers/scsi/scsi_ioctl.c` `scsi_cmd_allowed()` (SEND_KEY allowed read-only): https://github.com/torvalds/linux/blob/master/drivers/scsi/scsi_ioctl.c
- OSS-Fuzz projects (ffmpeg present; libdvdread/libdvdnav/libbluray absent as of 2026-10-10): https://github.com/google/oss-fuzz/tree/master/projects

**Issue trackers / postmortems (MEDIUM-HIGH)**
- Ubuntu bug 2089378 "bwrap needs an apparmor profile to work": https://www.mail-archive.com/ubuntu-bugs@lists.ubuntu.com/msg6116426.html
- VS Code #316046 (bwrap on 24.04, `bwrap-userns-restrict`): https://github.com/microsoft/vscode/issues/316046
- protontricks #400 (`setting up uid map: Permission denied`): https://github.com/Matoking/protontricks/issues/400
- Electron AppImage on 24.04: joplin #11251, electron-builder #8440, OpossumUI #2706: https://github.com/laurent22/joplin/issues/11251 ; https://github.com/electron-userland/electron-builder/issues/8440 ; https://github.com/opossum-tool/OpossumUI/issues/2706
- electron-builder notarization of helper binaries: #5190, #4637: https://github.com/electron-userland/electron-builder/issues/5190 ; https://github.com/electron-userland/electron-builder/issues/4637
- electron-builder Artifact Signing issue #8828: https://github.com/electron-userland/electron-builder/issues/8828
- ToDesktop, "EV certs do not grant immediate reputation anymore": https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore
- Nix #5888 (sandbox and dyld shared cache): https://github.com/NixOS/nix/issues/5888 ; Codex #46406 (deny-default abort 134): https://github.com/openai/codex/issues/46406
- AppContainer device/path access: codex #45871, PowerShell #27253: https://github.com/openai/codex/issues/45871 ; https://github.com/PowerShell/PowerShell/issues/27253
- graceful-fs Windows rename retries; libuv #1981; write-file-atomic #227: https://www.npmjs.com/package/graceful-fs ; https://github.com/libuv/libuv/pull/1981 ; https://github.com/npm/write-file-atomic/issues/227
- Apple clang lacks libFuzzer runtime: https://gist.github.com/mcandre/6ad2edee00c693b057743aafba20f1df
- Jellyfin #4322 (TMDB episode groups): https://github.com/jellyfin/jellyfin/issues/4322
- MakeMKV forum, "BU40N – AACS host certificate is revoked": https://forum.makemkv.com/forum/viewtopic.php?t=31715 ; playlist obfuscation: https://forum.makemkv.com/forum/viewtopic.php?t=16283
- ArchWiki Blu-ray (libaacs KEYDB, VUK vs host cert): https://wiki.archlinux.org/title/Blu-ray
- VirtualBox forums (USB optical passthrough): https://forums.virtualbox.org/viewtopic.php?t=105530

**Legal history (HIGH for facts; not legal advice)**
- EFF, GitHub reinstates youtube-dl: https://www.eff.org/deeplinks/2020/11/github-reinstates-youtube-dl-after-riaas-abuse-dmca ; TorrentFreak on GitHub's $1M defense fund: https://torrentfreak.com/github-reinstates-youtube-dl-and-puts-1m-in-takedown-defense-fund-201116/
- SlySoft closure (TorrentFreak, 2016): https://torrentfreak.com/popular-blu-ray-ripper-shuts-down-following-legal-pressure-160224/ ; AnyDVD/RedFox: https://en.wikipedia.org/wiki/AnyDVD
- DVDFab/AACS injunction and damages: https://en.wikipedia.org/wiki/RedFox (context) and TorrentFreak coverage
- Universal City Studios v. Reimerdes / Universal v. Corley (DeCSS linking injunction): general legal record (training knowledge, HIGH confidence, not re-fetched)

**Project evidence (local)**
- `app/main.js:160-166` (vanish-abort), `app/lib.js:72,115-128,143-155`, `app/platform.js:63-84,159`, `package.json` entitlements, `.github/workflows/release.yml:79-89`, `engine/build.sh:89-99`, `.gitignore` (`engine/deps/`), `README.md:69`, `docs/HARDWARE_TESTING.md:7,29`, `test/unit/lib.test.js:246`
- Audit handoff (local only; not to be committed)

---
*Pitfalls research for: open-source sandboxed Electron DVD/Blu-ray ripper (Spinarr v1.0)*
*Researched: 2026-10-10*
