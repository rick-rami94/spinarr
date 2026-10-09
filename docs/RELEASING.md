# Releasing

Installers are built by GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)), never on a laptop. Each OS builds its own engine from the pinned, checksum-verified sources, then packages the app with electron-builder.

| Runner | Output |
|---|---|
| `macos-15` | `Spinarr-<v>-mac-arm64.dmg` |
| `macos-15-intel` | `Spinarr-<v>-mac-x64.dmg` |
| `ubuntu-22.04` | `Spinarr-<v>-linux-x86_64.AppImage`, `Spinarr-<v>-linux-amd64.deb` |
| `ubuntu-22.04-arm` | `Spinarr-<v>-linux-arm64.AppImage`, `Spinarr-<v>-linux-arm64.deb` |
| `windows-latest` | `Spinarr-<v>-win-x64.exe` (per-user NSIS installer) |

The Linux builds run on Ubuntu 22.04 so they work on any distribution with glibc 2.35 or newer.

## Cut a release

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow builds all five targets, then creates a **draft** release with the files, a `SHA256SUMS.txt` and generated notes.
4. Check the draft, try an installer, and publish it.

To get the installers without making a release, run the workflow manually (**Actions → Release → Run workflow**) and download the artifacts.

## Code signing (optional)

Without signing, builds still work: on Apple silicon the app is ad-hoc signed after the Electron fuses are set, and users click through Gatekeeper or SmartScreen once (see the README). To sign, add these repository secrets. The workflow picks them up automatically.

| Secret | What it is |
|---|---|
| `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` | A "Developer ID Application" certificate exported as .p12, base64-encoded |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | For notarization |
| `WIN_CERT_PFX_BASE64`, `WIN_CERT_PASSWORD` | A Windows code-signing certificate (.pfx), base64-encoded |

Signed macOS builds use the hardened runtime with [`build/entitlements.mac.plist`](../build/entitlements.mac.plist). That entitlement set allows JIT for V8, and lets the engine load the user's own Homebrew libdvdcss, which we don't sign.

## What's in every build

- Electron fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, the app only loads from its integrity-checked `app.asar`, and cookies are encrypted.
- The engine (`ffmpeg`, `ffprobe`, `dvdinfo`, `bdinfo`) in `resources/engine`, statically linked apart from OS libraries. The build script fails loudly if anything else is linked.
- **No** libdvdcss, libaacs, libbdplus or keys.
