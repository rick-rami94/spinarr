# Spinarr

<p align="center">
  <a href="https://github.com/rick-rami94/spinarr/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/rick-rami94/spinarr/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/rick-rami94/spinarr/actions/workflows/release.yml"><img alt="Release build" src="https://github.com/rick-rami94/spinarr/actions/workflows/release.yml/badge.svg"></a>
  <a href="https://github.com/rick-rami94/spinarr/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/rick-rami94/spinarr?display_name=tag&sort=semver&color=ffb547"></a>
  <a href="https://github.com/rick-rami94/spinarr/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/rick-rami94/spinarr/total?color=ffb547"></a>
  <a href="LICENSE"><img alt="License: GPL-3.0-or-later" src="https://img.shields.io/github/license/rick-rami94/spinarr?color=blue"></a>
</p>
<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-12%2B%20·%20arm64%20%7C%20x64-000000?logo=apple&logoColor=white">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%7C%2011%20·%20x64-0078D4?logo=windows&logoColor=white">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-AppImage%20%7C%20deb%20·%20x64%20%7C%20arm64-FCC624?logo=linux&logoColor=black">
</p>
<p align="center">
  <img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white">
  <img alt="Node 20+" src="https://img.shields.io/badge/Node-%E2%89%A520-5FA04E?logo=nodedotjs&logoColor=white">
  <img alt="FFmpeg 8" src="https://img.shields.io/badge/FFmpeg-8.0.1-007808?logo=ffmpeg&logoColor=white">
  <img alt="Lossless remux" src="https://img.shields.io/badge/output-lossless%20MKV-8A2BE2">
  <img alt="Sandboxed engine" src="https://img.shields.io/badge/engine-sandboxed%20(macOS%2C%20Linux)-2ea44f">
  <img alt="Fuzz tested" src="https://img.shields.io/badge/parsers-fuzz%20tested-2ea44f">
</p>
<p align="center">
  <a href="https://github.com/rick-rami94/spinarr/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/rick-rami94/spinarr"></a>
  <a href="https://github.com/rick-rami94/spinarr/issues"><img alt="Issues" src="https://img.shields.io/github/issues/rick-rami94/spinarr"></a>
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen"></a>
  <a href="https://github.com/rick-rami94/spinarr/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/rick-rami94/spinarr?style=social"></a>
</p>

**An open-source DVD and Blu-ray → MKV ripper for macOS, Windows and Linux, with a modern UI.** It's a friendlier, auditable take on MakeMKV.

Spinarr copies titles **losslessly**. You get the original MPEG-2 video, every audio track (AC3, DTS, LPCM, MPEG), VobSub subtitles, chapters and language tags, remuxed into MKV with no re-encoding. The test suite proves it: decoded video is bit-identical to the source, and every audio packet survives byte for byte.

<p align="center">
  <img src="docs/screenshots/disc.png" alt="Spinarr showing a Blu-ray's main feature with its audio and subtitle tracks expanded" width="900">
</p>

## Install

Download the installer for your computer from the **[latest release](https://github.com/rick-rami94/spinarr/releases/latest)**. Everything Spinarr needs is inside: there's nothing to build.

| Your computer | Download |
|---|---|
| Mac with Apple silicon (M1 and later), macOS 12+ | `Spinarr-<version>-mac-arm64.dmg` |
| Mac with an Intel chip, macOS 12+ | `Spinarr-<version>-mac-x64.dmg` |
| Windows 10 or 11 (64-bit) | `Spinarr-<version>-win-x64.exe` |
| Linux: Ubuntu, Debian, Mint, Pop!_OS | `Spinarr-<version>-linux-<arch>.deb` |
| Linux: any other distribution | `Spinarr-<version>-linux-<arch>.AppImage` |

Releases aren't code-signed yet, so the first launch takes one extra step:

- **macOS:** open the `.dmg` and drag Spinarr to Applications. The first time, right-click it and choose **Open**. On macOS 15 or later, go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **Windows:** run the installer. If SmartScreen appears, click **More info → Run anyway**. Spinarr installs for your user only, with no admin prompt.
- **Linux (.deb):** `sudo apt install ./Spinarr-*.deb`. This also installs bubblewrap, which sandboxes the engine.
- **Linux (AppImage):** `chmod +x Spinarr-*.AppImage`, then run it. Install `bubblewrap` from your package manager so the engine runs sandboxed.

### Encrypted DVDs (libdvdcss)

> **Full guide:** [Encrypted DVDs and Blu-rays](docs/ENCRYPTED_DISCS.md) covers DVDs, Blu-ray key files, and what every message means.

Most store-bought DVDs are encrypted with CSS. Spinarr doesn't ship the library that reads them, so install it once:

| System | Command |
|---|---|
| macOS | `brew install libdvdcss` |
| Ubuntu, Debian, Mint | `sudo apt install libdvd-pkg && sudo dpkg-reconfigure libdvd-pkg` |
| Fedora | `sudo dnf install libdvdcss` (from RPM Fusion) |
| Arch | `sudo pacman -S libdvdcss` |
| Windows | Download the 64-bit [`libdvdcss-2.dll`](https://download.videolan.org/pub/libdvdcss/1.2.11/win64/) from VideoLAN, then choose it in **Settings → System** |

**Settings → System** shows whether it was found, with the right command for your system. Unencrypted discs, disc images and folders work without it.

## Features

- **Finds discs on its own.** Inserted discs are detected automatically. You can also open, or drag in, an ISO, a disc folder or a `VIDEO_TS` folder.
- **Picks out the movie.** The **main feature** is preselected. Logos, menus and **duplicate playlist titles** (a common copy-protection trick) are hidden.
- **Shows what's on each title.** Every title gets a chapter timeline plus language, codec and channel chips. Pick exactly which audio and subtitle tracks to keep.
- **Rip queue.** Shows progress, speed and time left, with cancel and *Show in Finder*. It checks free space first, never overwrites files, and never leaves partial files behind.
- **Honest failures.** A scratched or unreadable disc fails with a clear message instead of a silently truncated file.
- **Light and dark mode.**
- **Blu-ray (early).** Playlists, chapters and track languages; lossless rips (Blu-ray LPCM → FLAC, everything else copied). Unencrypted discs work today. For AACS discs, install `libaacs` and choose your own `KEYDB.cfg` in **Settings → System** ([guide](docs/ENCRYPTED_DISCS.md#blu-rays-libaacs-and-your-key-file)). Spinarr copies it to where libaacs looks. It never ships, downloads or links to keys. BD+ and 4K UHD aren't supported. Tested on generated discs; real-drive testing is pending.

## Screenshots

<table>
  <tr>
    <td colspan="2"><img src="docs/screenshots/ripping.png" alt="A rip in progress: one title done, the main feature at 48%, one waiting"><br><sub><b>Ripping.</b> Live progress on each title card and in the Rips list.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/empty.png" alt="The start screen with a large disc and an Open image or folder button"><br><sub><b>Start screen.</b> Insert a disc, or open or drop an image or folder.</sub></td>
    <td width="50%"><img src="docs/screenshots/disc-light.png" alt="The disc view in light mode"><br><sub><b>Light mode.</b> Follows your system appearance.</sub></td>
  </tr>
</table>

## Keyboard

On Windows and Linux, use Ctrl where this table says ⌘.

| Keys | Action |
| --- | --- |
| ⌘O | Open an image or folder |
| ⌘↩ | Rip the selected titles |
| ⌘A | Select or deselect every visible title |
| ↑ ↓ | Move between titles |
| Space | Select the focused title |
| ↩ / → / ← | Expand or collapse the focused title's tracks |
| ⌘, | Settings |

## Security

A DVD is untrusted input parsed by C code, so Spinarr treats it that way:

- **Sandboxed engine.** The scanner and ffmpeg run with no network, no access to your files except the disc, and write access only to your output folder.

  | System | Sandbox |
  |---|---|
  | macOS | Built-in sandbox profile, which also blocks starting other programs |
  | Linux | [bubblewrap](https://github.com/containers/bubblewrap): fresh namespaces and read-only system files. The `.deb` installs it; for the AppImage, install it yourself. |
  | Windows | None yet. **Settings → System** says so. The engine still uses the patched, fuzzed parsers below. |

- **Patched, fuzzed parsers.** libdvdread is built from verified source with memory-safety fixes found by fuzzing. Those fixes are being sent upstream.
- **Locked-down UI.** No Node.js in the UI, a strict CSP, and every request to the backend validated.

See [SECURITY.md](SECURITY.md) and the full [security testing report](docs/SECURITY_TESTING.md).

## How it works

| Piece | Role |
|---|---|
| `engine/dvdinfo.c`, `engine/bdinfo.c` | Small libdvdread / libbluray tools that dump a disc's titles or playlists (durations, chapters, sizes, tracks, encryption) as JSON in one pass |
| `engine/bin/ffmpeg`, `ffprobe` | Remux-only ffmpeg 8 build with the `dvdvideo` demuxer, statically linked against patched libdvdread/libdvdnav |
| `engine/patches/` | Spinarr's fixes to ffmpeg (lossless AC3, 5× faster real-drive reads, short Blu-ray playlists), libdvdread and libbluray (memory safety, found by fuzzing) |
| `libdvdcss` | Loaded at runtime from **your** install to read CSS-encrypted discs. Spinarr doesn't ship it. |
| `app/` | Electron shell: hardened main process, a preload bridge, and a plain HTML/CSS/JS UI |

## Build from source

You only need this to develop Spinarr. Everyone else should use the [installers](#install).

```sh
# 1. Build tools
#    macOS:   xcode-select --install && brew install meson ninja nasm pkg-config libdvdcss
#    Ubuntu:  sudo apt install build-essential meson ninja-build nasm pkg-config curl patch xz-utils bubblewrap
#    Windows: install MSYS2, then in its MINGW64 shell:
#             pacman -S make patch tar xz curl mingw-w64-x86_64-{gcc,meson,ninja,nasm,pkgconf}
# 2. Engine and app
npm install
npm run engine      # downloads verified sources, applies patches, builds engine/bin (~5 min)
npm start
npm run dist        # optional: build an installer for this system into dist/
```

On Windows, run `npm run engine` from the MSYS2 MINGW64 shell (`CC=gcc sh engine/build.sh`) and everything else from a normal terminal.

## Testing

```sh
brew install ffmpeg dvdauthor cmake   # test-media generators (tsMuxeR is built from source) and independent oracle
npm run fixtures                # builds a set of test DVDs (NTSC/PAL, 4:3/16:9, 5.1, subtitles, multi-titleset, broken, hostile)
npm test                        # unit → security corpus → engine → end-to-end
npm run test:linux              # the same suite on Linux, in Docker (engine sandboxed by bubblewrap)
```

CI runs the full suite on macOS and Linux. On Windows it builds the engine, runs the unit tests and drives the real app end to end, using test discs authored on Linux. Every PR that touches packaging also builds all five installers.

Every feature maps to a user story with acceptance criteria: [docs/USER_STORIES.md](docs/USER_STORIES.md). Real-drive results: [docs/HARDWARE_TESTING.md](docs/HARDWARE_TESTING.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Roadmap

- Code-signed releases (the release pipeline is ready and only needs certificates; see [docs/RELEASING.md](docs/RELEASING.md))
- An engine sandbox on Windows (AppContainer)
- More real-hardware coverage (multi-angle, seamless branching, damaged discs, Windows and Linux drives)
- Blu-ray: real-drive testing, multi-clip and multi-angle playlists, 3D/MVC (UHD stays out of scope)

## Legal

Spinarr is for making personal backups of discs you own. Getting around copy protection may be restricted where you live (for example, DMCA §1201 in the US). Spinarr doesn't include `libdvdcss` or any decryption keys.

## License

GPL-3.0-or-later. Spinarr links GPL components of ffmpeg and libdvdread. The UI bundles the [Inter](https://rsms.me/inter/) typeface (SIL Open Font License, `app/renderer/fonts/Inter-LICENSE.txt`).
