# Security testing report

*Spinarr 0.1.0, tested on macOS 15 (x86_64), October 2026.*

## 1. Threat model

| Asset | Threat | Entry point |
|---|---|---|
| The user's files and account | Code execution or file read/write from a **malicious disc or disk image** | IFO/VOB structures parsed by libdvdread, libdvdnav and ffmpeg (C code) |
| The UI process | **HTML/script injection** from disc metadata | Volume label, folder names, language codes, codec names |
| The main process | A **compromised renderer** escalating through IPC | `window.spinarr` bridge |
| Users' trust | **Silent data loss**: a "successful" rip that is truncated or missing audio | ffmpeg exit codes, demuxer behaviour |
| Build integrity | **Supply chain**: tampered sources or libraries | `engine/build.sh` downloads, Homebrew dylibs |

The realistic attacker is someone who gets a user to open a crafted ISO, for example a download that Safari auto-mounts, or a burned disc.

## 2. Method

1. **Manual code review** of every source file, by the author plus an independent adversarial review.
2. **IPC abuse testing**: every handler called with hostile arguments from the live renderer (`e2e:sec_ipc_validation`).
3. **Renderer isolation testing**: Node access, navigation, window.open, CSP, permissions (`e2e:sec_renderer_isolation`).
4. **XSS testing** with hostile volume labels and folder names on real discs (`e2e:sec_xss_*`).
5. **Coverage-guided mutation fuzzing** of the IFO parser under AddressSanitizer and UBSan. Mutations are mirrored into `.BUP` files so libdvdread's backup fallback can't mask them. Bit flips, interesting values, and structure-aware mutations of program maps, cell tables and title tables.
6. **Sandbox verification**: attempted writes outside the output folder, reads of private files, and exec of a shell, all from inside the engine sandbox.
7. **Dependency audit**: `npm audit`, upstream versions, and source checksums plus a PGP signature.

## 3. Findings and fixes

| # | Severity | Finding | Status |
|---|---|---|---|
| F-1 | **High** | libdvdread `DVDReadBytes`: 32-bit size overflow means a 2 KB buffer receives up to 4 GB of disc data. Attacker-controlled **heap overflow** via `TT_SRPT.last_byte`. Also reachable from ffmpeg/ffprobe. | Fixed: `libdvdread-0001` (size_t maths, EOF bound, `table_len_ok`) |
| F-2 | **High** | libdvdread `ifoRead_PGCIT_internal`: a duplicate of a failed PGC causes a **NULL+0x10c write**. | Fixed: `libdvdread-0001` |
| F-3 | **High** | libdvdread `ifoRead_PGC_COMMAND_TBL`: **double free** on an error path. | Fixed: `libdvdread-0001` |
| F-4 | Medium | libdvdread `ifoRead_VTS_PTT_SRPT`: PTT offsets below the header cause a **heap read before the buffer**. Only found once libdvdread itself was built with ASan. | Fixed: `libdvdread-0001` |
| F-5 | Medium | libdvdread `ifoRead_TT_SRPT`: dangling pointer after a failed header read causes a **use-after-free** in `ifoClose`. Found by the second fuzz campaign. | Fixed: `libdvdread-0001` |
| F-6 | **High** | `open-path` IPC let the renderer launch any file (e.g. a `.command` on the disc). | Removed |
| F-7 | **High** | No navigation or window guards and `sandbox: false`, so injected HTML could navigate to `file:///Volumes/DISC/x.html` and inherit the bridge. | Fixed: Electron sandbox, navigation/window/webview blocked, IPC sender check, `app://` origin |
| F-8 | High | Any mounted volume with VIDEO_TS was scanned with no user action, making F-1 to F-5 zero-click via auto-mounted downloads. | Fixed: only physical optical media auto-scan |
| F-9 | Medium | `dvdinfo.c`: `cell_playback` NULL dereference, `cell_playback[-1]` read, sector-count wrap. | Fixed |
| F-10 | Medium | `dvdinfo.c` printed **invalid JSON** when the first title or chapter was skipped, so a single bogus title made a whole disc unscannable. | Fixed |
| F-11 | Medium | `rip` IPC trusted `outputDir`, `streams`, `title` and `fileName` (arbitrary write location, path traversal). | Fixed: validated in main; output folder only via the native picker |
| F-12 | Medium | The queue could jam permanently (setup throw, rename throw, spawn `error` unhandled). | Fixed |
| F-13 | Medium | Supply chain: no checksum on downloads, binaries linked user-writable Homebrew dylibs. | Fixed: pinned SHA-256 (ffmpeg PGP-verified), static patched libs, system-only linkage |
| F-14 | Low | `settings:set` persisted arbitrary keys; `eject` accepted any volume; test hook loadable via env in production. | Fixed: allowlists; hooks ignored in packaged builds |
| F-15 | Low | Corrupt BCD cell times produced multi-day titles, which could be crowned main feature. | Fixed: BCD validation; titles over 12 h never chosen |
| D-1 | **Data integrity** | A read error exited ffmpeg with **0**, so a truncated rip was reported as **Done**. | Fixed: `-xerror` plus a completeness check (`ripVerdict`) |
| D-2 | **Data integrity** | ffmpeg's `dvdvideodec` **dropped real AC3 frames** whose PTS duplicated the previous frame (a 32 ms gap every few seconds). | Fixed: `ffmpeg-0001` (CRC-checked duplicate detection) |
| D-3 | **Data integrity** | Titles that declare an audio track they never use (common on real discs) made ffmpeg report `out_time=N/A`, so good rips were **rejected as "0% copied"**. Found by e2e. | Fixed: progress also counts video frames |
| F-16 | Medium | Quitting with Cmd+Q left ffmpeg running and a `.part` file behind (Electron skips `window-all-closed` on `app.quit()`). Found by e2e. | Fixed: cleanup moved to `will-quit` |
| I-1 | Info | libdvdnav `assert`s abort on invalid cell state. | Kept on purpose (fail-safe); the app reports "stopped safely" |

### Defense in depth that doesn't depend on the parser fixes

Even if a new libdvdread bug is found, the engine runs under `sandbox-exec`:

| From inside the engine sandbox | Result |
|---|---|
| Write `~/Desktop/pwned.mkv` | `Operation not permitted` |
| Read `~/.zshrc` | `Operation not permitted` |
| `execve /bin/sh` | `Operation not permitted` |
| Network | denied (`deny network*`; ffmpeg is also built without network protocols) |
| Rip to the output folder | allowed |

## 4. Fuzzing results

All runs used `dvdinfo` built with `-fsanitize=address,undefined -fno-sanitize-recover=all`. From run 2 onward, libdvdread itself was also built with the sanitizers, which is how F-4 surfaced.

| Run | Target | Seed disc | Iterations | Crashes | Hangs | Invalid JSON |
|---|---|---|---|---|---|---|
| 1 (independent review) | original code, Homebrew libdvdread | NTSC 2-title | 8,000 | **302** (5 unique sites: 2 in `dvdinfo.c`, 3 in libdvdread) | 0 | **64** |
| 2 | patched `dvdinfo.c` + patched libdvdread (ASan) | NTSC 2-title | 20,000 | **1** (new: F-5 use-after-free) | 0 | 0 |
| 3 | + F-5 fix | multi-titleset feature disc | 20,000 | **0** | 0 | 0 |

Every crashing input is kept as a regression case in `test/fixtures/malicious/` (33 cases, about 40 KB each). `npm run test:security` replays them against the shipped binary on every CI run. Each must exit normally with valid JSON and sane durations. Reproduce a fuzz run with:

```sh
DVDINFO_BIN=/path/to/asan/dvdinfo python3 test/security/fuzz_dvdinfo.py 20000 <seed>
```

## 5. Automated security tests

Final run (`npm test`): **86/86** unit, security-corpus and engine tests, and **18/18** end-to-end runs (17 scenarios; the settings-persistence scenario launches the app twice).

| Scenario | Requirements | Result |
|---|---|---|
| Renderer isolation: no Node access, frozen bridge, navigation to https/file/app-traversal blocked, `window.open` denied, CSP blocks fetch, inline handlers and app-file reads, event-channel allowlist | SEC-01–03 | ✅ |
| IPC fuzzing from the live renderer: 17 hostile calls rejected, nothing enqueued, settings pollution ignored, `../../../../tmp` file name confined to the output folder | SEC-04–07 | ✅ |
| `<img onerror>` volume label and `<svg onload>` folder name rendered as text; no injected elements; safe output file name | SEC-08 | ✅ |
| All historical crash discs opened through the UI: each scanned or showed an error; app stays responsive | SEC-09 | ✅ |
| Mounted disk image listed but **not** auto-scanned; click to scan; eject | SEC-10, US-01, US-18 | ✅ |

The full per-story table is in `test/reports/e2e.md`, generated by each run.

## 6. Blu-ray (groundwork)

Blu-ray adds a second untrusted parser: **libbluray 1.5.0** (playlists, clip info, index and movie objects), reached through `bdinfo` and ffmpeg's `bluray:` input. It got the same treatment as the DVD path.

- **Built from pinned, checksum-verified source, statically linked.** BD-J (Java), fonts and XML are disabled, so only the playlist and stream code is compiled in.
- **Decryption is never bundled.** libaacs and libbdplus load at runtime only if the user installed them. The sandbox gives the engine **read-only** access to their key folders (`KEYDB.cfg`) and write access only to their caches.
- **Encrypted discs are refused by the backend,** not just greyed out in the UI (`e2e:us_bluray_encrypted` calls `rip` directly and is rejected). Rips are built from the main process's own scan, never from renderer-supplied playlist or stream data.
- **Fuzzing:** a structure-aware mutator (`test/security/fuzz_bdinfo.py`) over `index.bdmv`, `MovieObject.bdmv`, `*.mpls` and `*.clpi`, with `BACKUP/` mirrored.

| Run | Target | Iterations | Crashes | Hangs | Invalid JSON |
|---|---|---|---|---|---|
| BD-1 | libbluray 1.5.0 as released (ASan/UBSan) | 20,000 | **982** (6 sites) | **1** | 0 |
| BD-2 | with `libbluray-0002` | 20,000 | **0** | 0 | 0 |

| # | Severity | Finding (libbluray 1.5.0 unless noted) | Status |
|---|---|---|---|
| B-1 | **High** | `_fill_mark`: playlist mark's `play_item_ref` indexes the clip list before the range check (heap OOB read) | Fixed: `libbluray-0002` |
| B-2 | **High** | EP map: coarse `ref_ep_fine_id` never validated, so `clpi_lookup_spn` reads past `fine[]` | Fixed: the map is rejected at parse time |
| B-3 | **High** | `clpi_find_stc_spn`: `stc_id` below the ATC offset gives a negative index (OOB, use-after-free reads) | Fixed |
| B-4 | Medium | `clpi_lookup_spn`: `jj--` to `fine[-1]` when `before` is set | Fixed |
| B-5 | Low | `bs_seek_byte`: signed shift of disc-supplied offsets (undefined behaviour) | Fixed |
| B-6 | Medium (availability) | ffmpeg `bluray:` refused **any** playlist when none passed a hard-coded 180 s filter, so bonus features couldn't be opened; NULL `bd_get_title_info()` dereference | Fixed: `ffmpeg-0003` |
| D-4 | **Data integrity** | ffmpeg's `out_time` is the minimum across output streams, so a subtitle track ending early made good rips look 80% copied (and frame counts depend on the true frame rate) | Fixed: completeness is now verified from the finished MKV's own video-track duration |

The 37 crashing inputs (up to 3 per site) are kept in `test/fixtures/malicious-bd/` and replayed by `npm run test:security`.

**Not yet tested:** a real Blu-ray drive, commercial AACS discs with a user-supplied `KEYDB.cfg`, BD+ discs, and UHD (AACS 2.0), which remains out of scope.

## 7. Residual risks and next steps

- **Upstream:** send `libdvdread-0001`, `libbluray-0001/0002` and `ffmpeg-0001…0003` to VideoLAN and FFmpeg.
- **`sandbox-exec` is deprecated** by Apple, though it still works on macOS 15. Revisit it if it's removed, for example by moving the engine into an XPC service with App Sandbox entitlements.
- **libdvdcss is loaded from the user's Homebrew install.** On Intel Macs `/usr/local/lib` is user-writable. Packaged builds should use hardened runtime with library validation off only for that one dlopen, or ask the user to locate libdvdcss.
- **Packaging:** set Electron fuses (RunAsNode off, NODE_OPTIONS off, inspect off, ASAR integrity on), and sign and notarize.
- **More fuzzing:** a libFuzzer harness in CI, and fuzzing ffmpeg's `dvdvideo` + `mpegps` path with VOB mutations, not just IFO.
- **Real-hardware testing** of the physical-disc path (`/dev/rdisk*` access inside the sandbox) is pending a drive.
