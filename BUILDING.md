# Building Spinarr from source

This file ships inside every release's source bundle, `spinarr-<version>-source.tar.gz`. With the bundle alone you can rebuild the Spinarr app and its rip engine, without network access for the engine.

## What the bundle contains

- **The app source** at the release tag: `app/`, `build/`, `scripts/`, `test/`, `package.json` and `package-lock.json`.
- **The engine build script** `engine/build.sh`. It pins every upstream source by version, URL and SHA-256.
- **Spinarr's patches** to the upstream sources, in `engine/patches/`. `build.sh` applies them in name order.
- **The scanners** `engine/dvdinfo.c` and `engine/bdinfo.c`.
- **Every upstream engine tarball exactly as pinned**, in `engine/upstream/`:
  - ffmpeg (GPL-3.0-or-later, built with `--enable-gpl --enable-version3`)
  - libdvdread (GPL-2.0-or-later)
  - libdvdnav (GPL-2.0-or-later)
  - libbluray (LGPL-2.1-or-later)
- **`THIRD_PARTY_NOTICES.txt`**, the licenses of everything above.

Each tarball in `engine/upstream/` has the SHA-256 listed in the `SOURCES` table of `engine/build.sh`. Check them with:

```sh
node scripts/pins.js
sha256sum engine/upstream/*.tar.xz      # macOS: shasum -a 256 engine/upstream/*.tar.xz
```

The bundle stays complete even if the upstream download URLs disappear.

### libudfread

libbluray 1.5.0 embeds libudfread 1.2.0 (LGPL-2.1-or-later) in its `contrib/libudfread/` directory. `build.sh` links it in with `-Dembed_udfread=true`. Its source is inside the libbluray tarball, so there is no separate tarball for it.

## Prerequisites

You need a C toolchain plus meson, ninja, nasm, pkg-config, curl, patch and xz:

| OS | Install |
|----|---------|
| macOS | `xcode-select --install && brew install meson ninja nasm pkg-config` |
| Linux | `sudo apt install build-essential meson ninja-build nasm pkg-config curl patch xz-utils` |
| Windows | MSYS2 MINGW64 (or CLANGARM64) shell: `pacman -S --needed make patch tar xz curl mingw-w64-x86_64-{gcc,meson,ninja,nasm,pkgconf}` |

For the app you also need Node.js (the version in `.nvmrc`) and npm.

## Build the engine offline

```sh
tar -xzf spinarr-<version>-source.tar.gz
cd spinarr-<version>
mkdir -p engine/deps && cp engine/upstream/*.tar.xz engine/deps/
sh engine/build.sh
```

`build.sh` skips the download when a tarball is already in `engine/deps/`. It still checks the SHA-256 of each one before extracting it and applying the patches. On Windows, run it from the MSYS2 shell as `CC=gcc sh engine/build.sh`.

The result is in `engine/bin/`: `ffmpeg`, `ffprobe`, `dvdinfo` and `bdinfo`. The libraries are linked statically.

## Build the app

```sh
npm ci
npx electron-builder --publish never
```

Installers land in `dist/`. `npm start` runs the app unpackaged.

## Electron and Chromium

Spinarr uses Electron as published by the Electron project, at the exact version in `package-lock.json` (`packages["node_modules/electron"].version`). Spinarr does not modify it.

The source for that version is at https://github.com/electron/electron, at the matching tag `v<version>`. That covers Chromium and the LGPL-licensed `libffmpeg` that Electron bundles. Electron's own license and the Chromium license list ship with the app.

## Decryption libraries

Decryption libraries are not part of Spinarr and are not included in this bundle or in any Spinarr binary. `build.sh` builds libdvdread with `-Dlibdvdcss=disabled`.

## Rebuilding the bundle

From a checkout of the release tag:

```sh
sh scripts/source-bundle.sh <version> <outdir>
```

It needs git, node, curl, xz and GNU tar (macOS: `brew install gnu-tar`). The output is deterministic, so anyone can rebuild it from the tag and compare its SHA-256 against the released file.
