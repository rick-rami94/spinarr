# Phase 2: Trust & Distribution - Pattern Map

**Mapped:** 2026-10-12
**Files analyzed:** 44 new or modified files, plus 5 ops/account items (from 02-CONTEXT.md and the 02-RESEARCH.md "Recommended Project Structure" and "Wave 0 Gaps")
**Analogs found:** 36 / 44. The 8 without an analog are CFLite/fuzz config, PowerShell signing, and docs. For those, use the RESEARCH shapes.

All line numbers come from the `milestone/v1.0` working tree as of 2026-10-12. There is no `scripts/` directory or `fuzz/` directory yet. Both are new.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `build/entitlements.mac.plist` (rewrite: allow-jit only) | config | n/a | itself (1-11) | exact |
| `build/entitlements.mac.inherit.plist` (new) | config | n/a | `build/entitlements.mac.plist` | exact |
| `build/entitlements.engine.plist` (new: DLV only) | config | n/a | `build/entitlements.mac.plist` | exact |
| `build/sign-mac.js` (new, `mac.sign` hook) | build hook | transform | `build/make-icon.js` (file style) + RESEARCH Pattern 1 (body) | partial |
| `build/sign-win.js` (new, `signtoolOptions.sign` hook) | build hook | request-response (spawns pwsh) | `app/main.js` `execFile`/env-guard idioms + RESEARCH Pattern 3 | partial |
| `build/sign-win.ps1` (new) | build script | file-I/O | `ci.yml` "Independent ffmpeg oracle" pwsh step (199-218) | role-match |
| `build/verify-mac.sh` (new) | CI assertion | batch | `engine/build.sh` link-check loop (116-125) | role-match |
| `build/verify-win.ps1` (new) | CI assertion | batch | `ci.yml` pwsh oracle step (199-218) | role-match |
| `package.json` `build` (mac.sign, inherit plist, dmg.sign, win.signtoolOptions, extraResources for notices + licenses) | config | n/a | itself (38-118) | exact |
| `.github/workflows/release.yml` (environment, secrets swap, dmg notarize, verify, SBOM, source bundle, cosign, attest, signed/unsigned propagation) | config (CI) | batch | itself (1-136) | exact |
| `.github/workflows/ci.yml` (+ `asan` job; optional SBOM validate step on linux) | config (CI) | batch | `audit` job (234-260) + `linux` job (64-138) | exact |
| `.github/workflows/fuzz-pr.yml` (new) | config (CI) | batch | `ci.yml` header + `audit` job | role-match |
| `.github/workflows/fuzz-cron.yml` (new) | config (CI) | batch | same | role-match |
| `scripts/pins.js` (new, single SOURCES parser) | utility | transform | `engine/build.sh` `fetch()` awk parse (43-47) + SOURCES table (32-41) | exact (same data) |
| `scripts/gen-notices.js` (new) | utility (generator) | file-I/O | `build/make-icon.js` (CLI script shape), `pins.js` | partial |
| `scripts/gen-sbom.js` (new) | utility (generator) | transform | same | partial |
| `scripts/source-bundle.sh` (new) | utility (packager) | file-I/O | `engine/build.sh` (header, `set -eu`, `sha256()` helper, `fetch()`) | role-match |
| `scripts/fuzz-report.js` (new) | utility (API client) | request-response | `ci.yml` audit inline node (249) for CLI style; RESEARCH "Draft advisory creation" for body | partial |
| `engine/build.sh` (+ `fetch` mode, + `asan` mode, + 5th SPDX column) | build script | batch | itself (`scanners` mode switch 65-66, meson blocks 68-84, compile 106-113) | exact |
| `engine/dvdinfo.c` (extract `dvdinfo_print(dvd_reader_t*)`, `main` behind `#ifndef SPINARR_FUZZ`) | engine (C) | transform | itself (75-171) | exact |
| `engine/bdinfo.c` (extract `bdinfo_print(BLURAY*)`) | engine (C) | transform | itself (103-187) | exact |
| `fuzz/fuzz_dvd_ifo.c` (new) | test harness (C) | transform | `engine/dvdinfo.c` (includes 1-12, open path 79-86) | role-match |
| `fuzz/fuzz_bd_mpls_clpi.c` (new) | test harness (C) | transform | `engine/bdinfo.c` (includes 1-15, open path 105-120, titles 129-146) | role-match |
| `fuzz/memfs.h` (new) | test utility (C) | transform | `engine/argv_utf8.h` (header-only helper style) | partial |
| `fuzz/make_seeds.py` (new) | test utility | file-I/O | `test/security/fuzz_dvdinfo.py` (1-20) | role-match |
| `fuzz/*.options` (new) | config | n/a | none | no analog |
| `.clusterfuzzlite/Dockerfile`, `project.yaml` (new) | config | n/a | none | no analog |
| `.clusterfuzzlite/build.sh` (new) | build script | batch | `engine/build.sh` meson blocks (68-84) + compile (106-113) | role-match |
| `app/main.js` (+ `about`, `notices`, `open-source-release`, `open-chromium-licenses` IPCs) | controller (IPC) | request-response | `handle('system')` (518-519), `handle('reveal')` (507-510), `ENGINE` resolution (10-12) | exact |
| `app/preload.js` (+ 3-4 bridge keys) | bridge | request-response | itself (6-22) | exact |
| `app/renderer/index.html` (+ "About" group after System) | component (markup) | n/a | System group (105-106) | exact |
| `app/renderer/app.js` (`renderAbout()`, click cases, `openSettings` hook) | component (renderer) | event-driven | `renderSystem()` (381-415), `openSettings()` (567-575), click switch (600-625) | exact |
| `app/renderer/styles.css` (only if `<details>/<pre>` need styling) | style | n/a | `.group`/`.group-row`/`.group-title` (648-683) + skin overrides (759+) | exact |
| `test/unit/sign-mac.test.js` (new) | test (unit) | transform | `test/unit/lib.test.js` (1-6 imports, truth-table style) | role-match |
| `test/unit/entitlements.test.js` (new) | test (static file check) | file-I/O | `test/unit/lib.test.js` skin test (180-189) | role-match |
| `test/unit/sign-win.test.js` (new) | test (unit) | transform | `lib.test.js` + `gate-static.test.js` (source-text assertions) | role-match |
| `test/unit/sbom.test.js`, `notices.test.js` (new) | test (unit) | transform | `lib.test.js` | role-match |
| `test/unit/source-bundle.test.js` (new) | test (integration) | file-I/O | `test/unit/neutrality.test.js` (`execFileSync` + `git`) | role-match |
| `test/unit/workflows.test.js` (new) | test (static source check) | file-I/O | `test/unit/gate-static.test.js` (whole file) | exact |
| `test/e2e/scenarios.js` (+ `about_notices`) | test (e2e) | event-driven | `us_settings_persist` (649-665), `call()` helper (27) | exact |
| `test/security/corpus.test.js` (`SPINARR_ENGINE_BIN`, sanitizer exit codes, stderr scan) | test (corpus replay) | batch | itself (1-29) | exact |
| `.gitignore` (+ `engine/bin-asan/`, `build-out/`, `THIRD_PARTY_NOTICES.txt` if generated-only, `test/security/fuzz-*`) | config | n/a | "engine build outputs" block | exact |
| `docs/RELEASING.md` (account runbook + release + verify) | docs | n/a | itself (1-40) | exact |
| `BUILDING.md` (new) | docs | n/a | `engine/build.sh` header comment (1-14) | partial |
| `README.md` (install section 51-56: remove bypass advice; verify section) | docs | n/a | itself | exact |
| `SECURITY.md` (fuzz advisory flow consistent with "Reporting a vulnerability") | docs | n/a | itself (line 5 section) | exact |
| Ops: Immutable Releases, `release` environment, `spinarr-fuzz-corpus` private repo, GitHub App/PATs, v0.1.x `gh release edit` (D-08) | ops (API) | request-response | none in repo | no analog |

---

## Pattern Assignments

### `build/entitlements.*.plist` (config)

**Analog:** `build/entitlements.mac.plist` (whole file, 11 lines). Keep the header, DOCTYPE and the one-comment-per-key style:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Used only when the app is signed with a Developer ID (hardened runtime). -->
<plist version="1.0">
<dict>
  <!-- Electron's V8 needs JIT. -->
  <key>com.apple.security.cs.allow-jit</key><true/>
  <!-- The engine loads the user's own Homebrew libdvdcss/libaacs, which aren't signed by us. -->
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
```
- `entitlements.mac.plist` (app): keep line 6-7 only. Remove 8-9.
- `entitlements.mac.inherit.plist` (Electron helpers): allow-jit only (same as the app).
- `entitlements.engine.plist`: lines 8-9 only (DLV + its comment). Do **not** add `allow-dyld-environment-variables` (RESEARCH Pattern 1: `app/platform.js` gives the engine a minimal env with no `DYLD_*`).
- `docs/RELEASING.md:34` describes the old single plist and must be rewritten to match.

---

### `build/sign-mac.js` (build hook, transform)

**Analog for file style:** `build/make-icon.js` (lines 1-4): CommonJS, one-line purpose comment naming how it is invoked, `require('path')`, `__dirname`-relative paths.
```js
// Renders build/icon.html to build/icon.png (1024x1024) with Electron: `npm run icon`.
// electron-builder derives the .icns/.ico/Linux sizes from it, and the app window uses it on Linux.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
```
**Body:** copy RESEARCH Pattern 1 verbatim (wrap `opts.optionsForFile`, path test on `${path.sep}Contents${path.sep}Resources${path.sep}engine${path.sep}`, `require.resolve('@electron/osx-sign', { paths: [require.resolve('app-builder-lib')] })`, return `osxSign.signAsync(opts)`).

**Testability:** export the `optionsForFile` wrapper as a named helper (for example `module.exports.wrapOptions = ...`) so `test/unit/sign-mac.test.js` can test the path→plist mapping without calling osx-sign. Keep the osx-sign `require` lazy (inside the function) so the unit test can load the module on Linux/Windows CI.

**Wiring (`package.json` `build.mac`, current lines 76-85):**
```json
    "mac": {
      "category": "public.app-category.video",
      "target": ["dmg"],
      "hardenedRuntime": true,
      "minimumSystemVersion": "12.0",
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    },
    "dmg": { "title": "Spinarr ${version}" },
```
→ add `"sign": "build/sign-mac.js"`, point `entitlementsInherit` at `build/entitlements.mac.inherit.plist`, add `"sign": true` to `dmg`. Set `forceCodeSigning` from CI (`-c.mac.forceCodeSigning=true` on tag builds with secrets) rather than in package.json, so local and PR builds stay unsigned (D-04/D-07).

---

### `build/sign-win.js` + `build/sign-win.ps1` (build hook, request-response)

**Body:** RESEARCH Pattern 3 verbatim (env check → no-op or throw on `SPINARR_REQUIRE_SIGNING=1` → `execFileSync('pwsh', ['-NoProfile','-NonInteractive','-File', sign-win.ps1, '-ModuleVersion', MODULE_VERSION, '-File', config.path])`).

**Argv-not-string idiom analog:** `app/main.js` line 2 imports `spawn, execFile` and every engine call passes an args array. No shell string splicing anywhere in the repo. Keep that.

**Env-guard analog** (`release.yml` lines 101-104). This is the existing "secrets present?" idiom:
```sh
          [ -n "$CSC_LINK" ] || export CSC_IDENTITY_AUTO_DISCOVERY=false
          [ -n "$WIN_CSC_LINK" ] || unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD
          [ -n "$CSC_LINK" ] || unset CSC_LINK CSC_KEY_PASSWORD
```

**PowerShell style analog** for `sign-win.ps1` (`ci.yml` lines 201-213): `$ErrorActionPreference = 'Stop'`, explicit `throw "<human sentence>"` on failure:
```powershell
          $ErrorActionPreference = 'Stop'
          ...
          if ($got -ne $want) {
            Remove-Item -Force $zip
            throw "ffmpeg oracle checksum mismatch: got $got, want $want"
          }
```
`sign-win.ps1` uses a `param([string]$ModuleVersion, [string]$File)` block, then `Import-Module ArtifactSigning -RequiredVersion $ModuleVersion -ErrorAction Stop`, then `Invoke-ArtifactSigning` (parameters in RESEARCH Pattern 3).

**Wiring (`package.json` `build.win`, current lines 108-112):**
```json
    "win": {
      "target": ["nsis"]
    },
```
→ add `"signtoolOptions": { "sign": "build/sign-win.js", "signingHashAlgorithms": ["sha256"] }`. Do **not** add `azureSignOptions` (RESEARCH Pitfall 3).

**Coupling to watch:** `ci.yml` line 232 (`npx electron-builder --win --dir --publish never` in the required `windows` job) will now call the hook for every exe. With no Azure env and no `SPINARR_REQUIRE_SIGNING`, the hook must return quietly, or the required check breaks.

**No hard-coded exe list (CONTEXT domain note):** `extraResources` already uses a glob (`package.json` 52-63, filter `"*.exe"`), and electron-builder calls the hook once per file. `verify-win.ps1` must also glob (`dist/win-unpacked/**/*.exe` + `dist/*.exe`), never list names.

---

### `build/verify-mac.sh` / `build/verify-win.ps1` (CI assertion, batch)

**Analog for shell assertion loops:** `engine/build.sh` lines 116-125. Per-binary loop over a glob, collect, fail loudly:
```sh
for b in ffmpeg ffprobe dvdinfo bdinfo; do
  f="bin/$b$EXE"
  case $OS in
    mac) bad=$(otool -L "$f" | tail -n +2 | grep -v '/usr/lib/\|/System/' || true) ;;
    ...
  esac
  [ -z "$bad" ] || echo "WARNING: $f links a non-system library: $bad" >&2
done
```
`verify-mac.sh` uses RESEARCH "Assertion script for macOS" verbatim (`set -eu`, codesign/stapler/spctl with the **corrected** `-t exec` / `-t open --context context:primary-signature` types, Pitfall 2). Iterate `"$APP"/Contents/Resources/engine/*` by glob, as above.

`verify-win.ps1`: same `$ErrorActionPreference = 'Stop'` + `throw` style as `ci.yml` 201-213, per-file checks from RESEARCH Pitfall 5 (`Status -eq 'Valid'`, `SignerCertificate.Subject -match 'CN=Rick Ramirez'`, `TimeStamperCertificate`, `signtool verify /pa /all /v`).

---

### `.github/workflows/release.yml` (config, batch)

**Analog:** itself. Keep everything from Phase 1: header comment (3-9), `permissions: contents: read` at top (27-28), SHA pins with `# vX.Y.Z`, `persist-credentials: false` (45-47), **no caches** (49-54 comment), `name: ${{ matrix.name }}` on the build job (41: its checks are not required contexts).

**Package step to replace** (lines 89-107):
```yaml
      - name: Package
        shell: bash
        env:
          # Unsigned unless signing secrets are configured (see docs/RELEASING.md).
          CSC_LINK: ${{ secrets.MAC_CERT_P12_BASE64 }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          WIN_CSC_LINK: ${{ secrets.WIN_CERT_PFX_BASE64 }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
          TARGET: ${{ matrix.target }}
        run: |
          [ -n "$CSC_LINK" ] || export CSC_IDENTITY_AUTO_DISCOVERY=false
          ...
          npx electron-builder $TARGET --publish never
```
- Drop `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_*` (D-01).
- Add `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. Write the `.p8` to `$RUNNER_TEMP` and export `APPLE_API_KEY=<path>` (RESEARCH Pattern 2).
- Add Azure vars (`vars.AZURE_SIGNING_ENDPOINT` etc.) on the Windows leg, and `SPINARR_REQUIRE_SIGNING=1` only when they are set.
- Keep the `TARGET` env-var indirection and the `# shellcheck disable=SC2086` comment (105-107). That is the zizmor-safe template-injection pattern. Never put `${{ … }}` inside `run:`.

**New steps go between Package (89) and upload-artifact (109):** pinned `Install-Module ArtifactSigning -RequiredVersion 0.1.20` → `azure/login@<sha> # v3.1.0` immediately before Package (Pitfall 4) → dmg notarytool/stapler (RESEARCH Pattern 2) → `build/verify-mac.sh` / `build/verify-win.ps1` (only when secrets are present) → write `signing-${{ matrix.name }}.json` and upload it as a **separate** artifact (RESEARCH Pattern 4 "Signed/unsigned propagation").

**Upload-artifact to keep** (109-117). Keep `if-no-files-found: error`. Name the signing marker artifact so that `download-artifact`'s `merge-multiple` into `out/` (126-129) does **not** pull it into the release assets. Use a separate `download-artifact` with `pattern: signing-*` into a different dir.

**Release job to extend** (119-136):
```yaml
  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          path: out
          merge-multiple: true
      - name: Checksums
        run: cd out && sha256sum * > SHA256SUMS.txt && cat SHA256SUMS.txt
      - uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3
        with:
          draft: true
          generate_release_notes: true
          files: out/*
```
→ add `id-token: write`, `attestations: write` to this job only. Add a checkout (`persist-credentials: false`, copy lines 45-47), then follow the RESEARCH Pattern 4 step order exactly. Change `sha256sum *` to `sha256sum -- *`. Add `prerelease`, `make_latest` and `body_path` to the softprops step.

**Environment:** `environment: release` on the build matrix legs that sign (tag builds only, RESEARCH A8) and on the release job if its secrets live there. Signing secrets belong in the environment, not at repo level (anti-pattern list).

**`on.pull_request.paths`** (15-25): add `'scripts/**'` and `'THIRD_PARTY_NOTICES*'` so generator changes get a packaging build.

---

### `.github/workflows/ci.yml` (+ `asan` job) (config, batch)

**Analog:** the `audit` job (234-260) for a short ubuntu-24.04 job, and `linux` (64-98) for the engine build steps.

**Header rule to obey** (lines 3-5):
```yaml
# Required checks on main are the job ids below: macos, linux, windows, audit.
# Do not rename them, add a `name:` key to a job, or add a `paths:` filter: any of those
# would orphan a required check (a check that never reports blocks every PR).
```
Add `asan` to that comment once Rick adds it to branch protection (a checkpoint). The new job has **no `name:` key and no `paths:` filter**.

**Job skeleton to copy** (234-245):
```yaml
  audit:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          package-manager-cache: false
```
**Tool install to copy** (79-86): the apt comment "documented exception" + `pip3 install --user --require-hashes -r .github/requirements-build.txt`. Add `clang` to apt. Then `sudo sysctl vm.mmap_rnd_bits=28` (CLAUDE.md §7), `sh engine/build.sh asan`, `SPINARR_ENGINE_BIN=engine/bin-asan node --test test/security/corpus.test.js`.

**Cache:** `ci.yml` may cache engine tarballs (88-92, key `engine-src-${{ hashFiles('engine/build.sh') }}`). Reuse that exact block in `asan`. This is not a publishing workflow.

**Optional SBOM validate step in `linux`:** place after "Build engine" (95-96). Download cyclonedx-cli with a pinned SHA-256 check in the same shape as the Windows oracle step (199-218, `Get-FileHash` + `throw` → bash `sha256sum -c`).

---

### `.github/workflows/fuzz-pr.yml`, `fuzz-cron.yml` (config, batch)

**Analog:** `ci.yml` header (1-16) and `audit` job shape (above). Copy:
- the supply-chain header comment (ci.yml 7-9)
- `permissions: contents: read` top level (15-16), widened per job only where needed
- `persist-credentials: false`
- `timeout-minutes` on every job
- the "documented exception" comment style for floating inputs (ci.yml 34-35, 79, 152). Use it for the `docker://gcr.io/oss-fuzz-base/*:v1` reference inside the CFLite action (Pitfall 11).

`fuzz-pr.yml` uses `on: pull_request: paths: ['engine/**', 'fuzz/**', '.clusterfuzzlite/**']`. A paths filter is allowed here because this is **not** a required check. Never use `pull_request_target`.

**Crash privacy (D-09):** these workflows must contain no `actions/upload-artifact`, no `google/clusterfuzzlite/actions/run_fuzzers`, and no `upload-sarif`. Fuzzer stdout/stderr go to `$RUNNER_TEMP/fuzz.log` (RESEARCH Pattern 9, Pitfall 1). `test/unit/workflows.test.js` enforces this.

**Token minting:** `actions/create-github-app-token@<sha> # v3.2.0` per step, scoped to `repositories: spinarr-fuzz-corpus` or advisories. Pass it to steps through `env:`, never inline `${{ }}` in `run:` (same pattern as `ci.yml` 255-258):
```yaml
      - name: Workflow lint (zizmor)
        env:
          # Read-only token so the online audits (impostor-commit, known-vulnerable-actions) run.
          GH_TOKEN: ${{ github.token }}
        run: |
```

---

### `scripts/pins.js` (utility, transform)

**Analog (same data, so it must parse it the same way):** `engine/build.sh` lines 32-47:
```sh
# name  version  url  sha256
...
SOURCES="
ffmpeg 8.0.1 https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz 05ee0b03...
libdvdread 7.1.1 https://download.videolan.org/pub/videolan/libdvdread/7.1.1/libdvdread-7.1.1.tar.xz a0d47876...
libdvdnav 7.0.0 https://download.videolan.org/.../libdvdnav-7.0.0.tar.xz a2a18f5a...
libbluray 1.5.0 https://download.videolan.org/.../libbluray-1.5.0.tar.xz f676408e...
"

fetch() {
  line=$(echo "$SOURCES" | awk -v n="$1" '$1 == n')
  ver=$(echo "$line" | awk '{print $2}'); url=$(echo "$line" | awk '{print $3}'); sha=$(echo "$line" | awk '{print $4}')
```
- Read `engine/build.sh` as text, take the content between `SOURCES="` and the closing `"`, split lines, split on whitespace. Fields 1-4 match awk `$1`-`$4`. Field 5 is the new SPDX id.
- When adding the 5th column, update the comment on line 32 to `# name  version  url  sha256  spdx-license`. `fetch()` only reads `$1`-`$4`, so it is unaffected.
- Patches: list `engine/patches/<name>-*.patch` the same way `fetch()` does (line 54: `"$ROOT"/patches/"$1"-*.patch`), sorted. Current files: `ffmpeg-0001..0003`, `libbluray-0001..0002`, `libdvdread-0001`.
- Add libudfread 1.2.0 (embedded in libbluray via `-Dembed_udfread=true`, build.sh line 83) as a constant in `pins.js`, not in SOURCES (`fetch()` would try to download it).

**Module shape:** follow `app/lib.js` (pure functions, `module.exports = { ... }` object at the bottom) so the unit tests can `require` it. No Electron imports, no new npm deps.

---

### `scripts/gen-notices.js`, `scripts/gen-sbom.js` (utility, generator)

**Analog for a runnable Node script:** `build/make-icon.js` (header comment with the invoking command, `__dirname`-relative paths, `fs.writeFileSync`, a final `console.log` of what was written). Pair with a `require.main === module` CLI guard so tests can import the pure builder (`buildSbom(pins, opts)` / `buildNotices(pins, opts)`) and the CLI writes the file.

**Inline-node CLI style in CI** (`ci.yml` 249) shows that the project already uses plain Node with no deps for CI JSON work:
```sh
node -e "const a=require('./audit.json').vulnerabilities||{};if(a.electron){...process.exit(1)}console.log('No advisories affect electron.')"
```
- Electron version: read from `node_modules/electron/package.json` (`package.json` devDeps line 26 is a caret range, so don't parse that).
- License texts: read from `engine/deps/<name>-<ver>/COPYING*` after `npm run engine` (path layout from build.sh `dir="$DEPS/$1-$ver"`, line 47).
- Determinism: `SOURCE_DATE_EPOCH` (RESEARCH Pattern 5).
- Add npm scripts beside the existing ones (`package.json` 8-23), for example `"notices": "node scripts/gen-notices.js"`.

---

### `scripts/source-bundle.sh` (utility, file-I/O)

**Analog:** `engine/build.sh` lines 1-29. Header comment explaining purpose and requirements, `set -eu`, `cd "$(dirname "$0")"`-style root resolution, and the portable `sha256()` helper:
```sh
set -eu
cd "$(dirname "$0")"
ROOT=$(pwd)
...
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
```
Body: RESEARCH Pattern 6. Tarballs come from `engine/build.sh fetch` (new mode), which reuses `fetch()`'s verify step (line 51: `echo "$sha  $tarball" | sha256 -c -`). Don't re-implement verification.

---

### `engine/build.sh` (+ `fetch`, `asan` modes) (build script)

**Analog for mode switching:** lines 65-66 and 104:
```sh
# `build.sh scanners` rebuilds only dvdinfo/bdinfo against the already-built libraries.
if [ "${1:-}" != scanners ]; then
...
fi
```
Add `fetch` (loop `fetch` over every SOURCES name and exit before any meson) and `asan` the same way, each with a one-line comment above it.

**ASan lib build analog** (lines 68-84). Copy the meson invocations, but give them a separate build dir and prefix so `engine/bin` and `deps/prefix` are never polluted:
```sh
  meson setup "$src/build" "$src" --prefix="$PREFIX" --libdir=lib --default-library=static \
    --buildtype=release -Db_ndebug=false $( [ $lib = libdvdread ] && echo -Dlibdvdcss=disabled ) >/dev/null
```
→ `"$src/build-asan"`, `--prefix="$DEPS/prefix-asan"`, add `-Db_sanitize=address,undefined -Db_lundef=false`. Keep `-Db_ndebug=false` (the comment at 68 explains why asserts stay on).

**Scanner compile analog** (lines 109-113). For ASan, swap `-O2 ... -D_FORTIFY_SOURCE=2` for `-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer` and output to `bin-asan/`:
```sh
$CC -O2 -Wall -Wextra -Wno-unused-parameter -fstack-protector-strong -D_FORTIFY_SOURCE=2 $STATIC_LD \
  -o "bin/dvdinfo$EXE" dvdinfo.c $(pkg-config --static --cflags --libs dvdread) $WINLIBS
```
`PKG_CONFIG_PATH` (line 63) must point at the ASan prefix inside that mode. Keep `mkdir -p bin` (line 30) and add `bin-asan` only in asan mode.

---

### `engine/dvdinfo.c`, `engine/bdinfo.c` (refactor for harness reuse)

**Analog:** themselves. Extraction boundary for `dvdinfo` (lines 75-86): everything after a successful `DVDOpen` moves into `int dvdinfo_print(dvd_reader_t *dvd)`. `main` keeps argv handling + `DVDOpen` + `DVDClose`:
```c
int main(int argc, char **argv)
{
    if (argc < 2) { fprintf(stderr, "usage: dvdinfo <device|iso|dir>\n"); return 2; }

    dvd_reader_t *dvd = DVDOpen(arg_utf8(argc, argv, 1));
    if (!dvd) { printf("{\"error\":\"Could not open disc\"}\n"); return 1; }

    ifo_handle_t *vmg = ifoOpen(dvd, 0);
    ...
    DVDClose(dvd);
    return 0;
}
```
Note: lines 85 and 169 call `DVDClose(dvd)` inside the body. After the refactor, ownership must be single (the caller closes). The early `return 1` at line 97 (OOM) currently leaks `vmg` and `dvd`. The refactor is a chance to route all exits through one cleanup.

For `bdinfo` (103-187): extract from `bd_get_disc_info` (line 111) to before `bd_close` (185) into `int bdinfo_print(BLURAY *bd)`. Keep `bd_set_debug_mask(0)` (107) in both `main` and the harness init.

Guard `main` with `#ifndef SPINARR_FUZZ`. The shipped build (build.sh 109-113) never defines it, so shipped behavior is unchanged (CLAUDE.md constraint: harnesses must not change the shipped engine).

---

### `fuzz/fuzz_dvd_ifo.c`, `fuzz/fuzz_bd_mpls_clpi.c`, `fuzz/memfs.h` (test harness, C)

**Analog for includes and conventions:** `engine/dvdinfo.c` lines 1-12 (block comment header with purpose + usage, system includes, then `<dvdread/...>`), and `engine/bdinfo.c` lines 1-15 (`<libbluray/bluray.h>`, `<libbluray/log_control.h>`). Add `<dvdread/dvd_filesystem.h>` and `<libbluray/filesystem.h>` (both installed into `engine/deps/prefix/include`, RESEARCH Pattern 8).

**Static-helper style to copy** (dvdinfo.c 14-19). Small `static` functions with a one-line comment stating the invariant:
```c
/* Decode one BCD byte; -1 if either nibble isn't a decimal digit. */
static int bcd(uint8_t v)
{
    int hi = (v >> 4) & 0xf, lo = v & 0xf;
    return (hi > 9 || lo > 9) ? -1 : hi * 10 + lo;
}
```
`memfs.h` follows `engine/argv_utf8.h` (a header-only helper included by both tools). Bodies come from RESEARCH Pattern 8 (`DVDOpenFiles` + `dvd_reader_filesystem_h`, `bd_open_files` + `open_dir`/`open_file`). Mirror IFO→BUP the way `fuzz_dvdinfo.py` does (its docstring, lines 2-5).

### `fuzz/make_seeds.py` (test utility, file-I/O)

**Analog:** `test/security/fuzz_dvdinfo.py` lines 1-20. Shebang, module docstring, `HERE = os.path.dirname(os.path.abspath(__file__))`, env overrides with defaults:
```python
#!/usr/bin/env python3
"""Mutation fuzzer for Spinarr's dvdinfo (ASan+UBSan build).
..."""
import json, os, random, re, shutil, struct, subprocess, sys, time, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.environ.get('DVDINFO_BIN', os.path.join(HERE, 'dvdinfo_asan'))
```
Inputs: `test/fixtures/malicious/<case>/VIDEO_TS/*` (33 cases) and `test/fixtures/malicious-bd/<case>/BDMV/*` (37 cases). Each case dir also has an `info.json`. Skip it. Stdlib only (`zipfile`, `struct`), no pip installs.

---

### `.clusterfuzzlite/build.sh` (build script, batch)

**Analog:** `engine/build.sh` lines 68-84 (meson static builds of the three libs) and 109-113 (compile + `pkg-config --static`). Differences: use `$CC $CFLAGS` from the CFLite env instead of fixed flags, add `-Db_lundef=false`, link harnesses with `$LIB_FUZZING_ENGINE`, output to `$OUT`, copy `fuzz/*.options` and the seed zips to `$OUT`. Obtain sources via `sh engine/build.sh fetch` (reuse checksum verification and patch application, build.sh 43-61). Never re-download separately.

---

### `app/main.js` (+ About IPCs) (controller, request-response)

**Analog:** itself.

**Resource path resolution** (lines 10-12). Copy this shape for the notices and licenses files:
```js
const ENGINE = app.isPackaged
  ? path.join(process.resourcesPath, 'engine')
  : process.env.SPINARR_ENGINE_DIR || path.join(__dirname, '..', 'engine', 'bin');
```
→ `const RESOURCES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');` then `THIRD_PARTY_NOTICES.txt` and `licenses/…` beneath it. In dev, `licenses/` is under `node_modules/electron/dist/`. Resolve it explicitly, or let the e2e test skip the Chromium button.

**IPC wrapper** (lines 474-481). New handlers go through `handle()`, which already enforces the sender check:
```js
// Only our own page may call in; arguments are validated in each handler.
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (e.senderFrame?.url !== INDEX_URL || e.sender !== win?.webContents) throw new Error('Unauthorized');
    return fn(...args);
  });
}
```
**No-arg, main-built action analog** (`reveal`, lines 507-510). Main decides the target and the renderer only triggers it:
```js
handle('reveal', (id) => {
  const job = queue.find((j) => j.id === id && j.state === 'done');
  if (job) shell.showItemInFolder(job.output);
});
```
**Info payload analog** (lines 517-519):
```js
// What Settings shows. sandboxTrusted is the same signal the scan gate uses.
const systemInfo = () => ({ ...platform.info(), sandbox: sandboxTrusted() ? platform.sandboxKind : 'none', sandboxTrusted: sandboxTrusted() });
handle('system', () => systemInfo());
```
New handlers:
- `handle('about', () => ({ version: app.getVersion(), license: 'GPL-3.0-or-later' }))`
- `handle('notices', () => fs.readFileSync(NOTICES, 'utf8'))`
- `handle('open-source-release', () => shell.openExternal(\`https://github.com/rick-rami94/spinarr/releases/tag/v${app.getVersion()}\`))`, declared as `() =>` with **no params**, so any renderer args are ignored.
- `handle('open-chromium-licenses', () => shell.openPath(...))`

Put a comment above them in the same "what and why" voice as 517 and 520. `shell` is already imported (line 1). Navigation and window-open stay denied (102-104, 576). Don't touch them.

---

### `app/preload.js` (bridge)

**Analog:** itself, lines 4-22. One line per channel through `invoke`:
```js
const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
...
  system: invoke('system'),
  installDvdcss: invoke('install-dvdcss'),
```
Add `about: invoke('about')`, `notices: invoke('notices')`, `openSourceRelease: invoke('open-source-release')`, `openChromiumLicenses: invoke('open-chromium-licenses')`. **Coupled test:** the bridge-key list in `test/e2e/scenarios.js` `sec_renderer_isolation` (line 51 onward) must be updated to include the new keys.

---

### `app/renderer/index.html` (+ About group)

**Analog:** lines 105-108:
```html
      <div class="group-title">System</div>
      <div class="group" id="systemGroup"></div>

      <div class="dlg-actions"><button class="primary-btn" value="ok" autofocus>Done</button></div>
```
Insert `<div class="group-title">About</div><div class="group" id="aboutGroup"></div>` between the System group and `.dlg-actions`. Render the body from JS like `#systemGroup`. Buttons inside the `<form method="dialog">` must be `type="button"` (see `#setOutputBtn` line 75), or they will close the dialog. **CSP (line 5) stays unchanged.**

---

### `app/renderer/app.js` (+ `renderAbout`) (component, event-driven)

**Analog:** `renderSystem()` (lines 381-415) and `openSettings()` (567-575).

**Row markup to copy** (renderSystem 407-413):
```js
  $('#systemGroup').innerHTML = `
    <div class="group-row top">${ok(sys.sandbox !== 'none' || sys.platform === 'win32')}
      <div class="gr-text"><b>Engine sandbox <span class="pill-state">${sandboxText}</span></b><small>${sandboxNote}</small>
      ${sys.bwrapHelp ? cmd(sys.bwrapHelp) : ''}</div></div>
```
Button row pattern (line 397):
```js
<div class="row-btns"><button type="button" class="ghost-btn" data-action="dvdcss-pick">Choose DLL…</button></div>
```
**Notices text:** build the `<details><summary>Third-party licenses</summary><pre></pre></details>` shell with the template, then set the text with `$('#aboutGroup pre').textContent = await spinarr.notices()`. Never interpolate notices into `innerHTML`. Escaping precedent: `esc(...)` is used for every dynamic string in templates (e.g. line 391). The `textContent` precedent is lines 302-304.

**Hook point:** call `renderAbout()` from `openSettings()` next to `renderSystem()` (line 573). Fetch `spinarr.about()` once at boot next to `state.system = await spinarr.system()` (line 782).

**Click dispatch** (lines 600-625). Add cases in the same one-line style:
```js
    case 'open': openPicker(); break;
    case 'open-folder': openPicker('folder'); break;
```
→ `case 'open-source': spinarr.openSourceRelease(); break;` and `case 'open-chromium-licenses': spinarr.openChromiumLicenses(); break;`. No arguments.

### `app/renderer/styles.css` (only if needed)

**Analog:** `.group`/`.group-row`/`.group-title` (648-683). If `<pre>` needs styling, add one rule near 683 using existing tokens (`var(--surface)`, `var(--hairline)`, `var(--text-3)`) so all six skins inherit it. Skin overrides start at 759 (`:root[data-skin="pinstripe"] {`). Check each skin visually. `test/unit/lib.test.js` 180-189 already guards that every styled skin is selectable.

---

### `test/unit/workflows.test.js` (test, static source check)

**Analog:** `test/unit/gate-static.test.js` (whole file). Header comment stating what is pinned (1-2), read the source once (8-9), small helpers, one `test()` per invariant:
```js
// Pins the renderer's scan chokepoint: every scan goes through requestScan, and only the
// "Scan anyway" click can send { userConfirmed: true } to main.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'app.js'), 'utf8');
...
test('the dvdcss download-page action is gone', () => {
  assert.equal(SRC.includes('openDvdcssPage'), false);
  assert.equal(SRC.includes('dvdcss-page'), false);
});
```
Invariants (RESEARCH Validation map): no `actions/cache` or `cache: npm` in `release.yml`; `contents: write` only under the `release` job; `id-token`/`attestations` present there; `actions/attest` appears after the notarize step; no `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`; every `uses:` matches `@[0-9a-f]{40} # v`; `fuzz-*.yml` contain no `upload-artifact`, `run_fuzzers` or `upload-sarif`; no `pull_request_target`; `ci.yml` jobs `macos|linux|windows|audit|asan` have no `name:`. Text/regex checks only (no YAML dependency).

### `test/unit/entitlements.test.js` (test, file-I/O)

**Analog:** `test/unit/lib.test.js` 180-189 (read files, regex-assert content):
```js
test('every skin has styles and a picker option, and nothing else does', () => {
  const root = path.join(__dirname, '..', '..', 'app', 'renderer');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  ...
  for (const skin of lib.SKINS.filter((k) => k !== 'studio')) assert.match(css, new RegExp(`:root\\[data-skin="${skin}"\\] \\{`));
```
Also assert `package.json` `build.mac.entitlementsInherit` ≠ the engine plist, and that `build.win.azureSignOptions` is absent.

### `test/unit/sign-mac.test.js`, `sign-win.test.js`, `sbom.test.js`, `notices.test.js` (test, unit)

**Analog:** `test/unit/lib.test.js` imports (1-6) and the truth-table style (e.g. 150-158):
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../../app/lib');
...
  for (const closed of [{ trusted: false, userConfirmed: false }, { trusted: 'yes', userConfirmed: 1 }, {}, undefined]) {
```
- `sign-mac.test.js`: table of paths (`…/Spinarr.app`, `…/Contents/Frameworks/Spinarr Helper.app`, `…/Contents/Resources/engine/ffmpeg`, `…/Contents/Resources/engine-evil/x`) → expected plist.
- `sign-win.test.js`: call the hook with env cleared → resolves with no spawn. With `SPINARR_REQUIRE_SIGNING=1` → rejects. Source-text check that `MODULE_VERSION` equals the `-RequiredVersion` in `release.yml` (gate-static style). Use `os.tmpdir()` scratch dirs as lib.test.js does (`fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-'))`, line 161).
- `sbom.test.js` / `notices.test.js`: `require('../../scripts/pins')` and assert the names and versions equal what build.sh `fetch()` would read. Every pin, plus libudfread and Electron, appears. `specVersion === '1.6'`. Each patch file appears under the right component's `pedigree.patches`.

### `test/unit/source-bundle.test.js` (test, integration)

**Analog:** `test/unit/neutrality.test.js` lines 5-14 (`execFileSync('git', [...], { cwd: ROOT, encoding: 'utf8' })`). Run `sh scripts/source-bundle.sh` twice into tmp dirs, compare hashes, list the tar with `tar -tzf`. Skip on win32 and when `engine/deps/*.tar.xz` are absent, so the default `npm run test:unit` stays offline and fast.

### `test/security/corpus.test.js` (test, batch)

**Analog:** itself. Change points:
- Lines 9-14: `path.join(ROOT, 'engine', 'bin', ...)` → `const BIN = process.env.SPINARR_ENGINE_BIN ? path.resolve(process.env.SPINARR_ENGINE_BIN) : path.join(ROOT, 'engine', 'bin');`
- Line 18: add `env` with `ASAN_OPTIONS=detect_leaks=0:exitcode=86:abort_on_error=0:symbolize=1` and `UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1:exitcode=87` when the override is set (copy the option strings from `fuzz_dvdinfo.py` lines 14-15, plus exit codes).
- Line 21: `[0, 1].includes(r.status)` stays. Add `assert.ok(![86, 87].includes(r.status))` and `assert.doesNotMatch(r.stderr, /ERROR: AddressSanitizer|runtime error:/)` (Pitfall 8).
- Line 20's message says `dvdinfo` for both tools. Use `path.basename(tool)`.

### `test/e2e/scenarios.js` (+ `about_notices`)

**Analog:** `us_settings_persist` (649-665):
```js
  us_settings_persist: {
    stories: ['US-16'],
    title: 'Settings changed in the dialog survive a restart',
    launches: [
      async (h) => {
        await h.click('#settingsBtn');
        ...
        await h.click('#settingsDlg button[value="ok"]');
```
`about_notices` uses a single `run(h)`: open Settings, assert `#aboutGroup` shows the version + "GPL-3.0-or-later", expand `<details>`, assert `pre.textContent` includes `libdvdread` and `libudfread`. Use `call(h, 'spinarr.openSourceRelease("https://evil")')` (helper at line 27) after stubbing `shell.openExternal` in main via `h.js` to record its argument, and assert the recorded URL is the fixed `releases/tag/v<version>`. Loop over `lib.SKINS` to set `document.documentElement.dataset.skin` and `h.shot()` each skin.

---

## Shared Patterns

### SHA-pinned actions with version comments
**Source:** every `uses:` in `ci.yml` / `release.yml` (e.g. `release.yml` 45, 109, 126, 132)
**Apply to:** all new actions (attest, cosign-installer, azure/login, create-github-app-token, CFLite build_fuzzers, harden-runner)
```yaml
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
```
Resolve the SHAs with `pinact` at implementation time. Dependabot (`.github/dependabot.yml`, `github-actions` ecosystem) keeps them fresh.

### Documented exceptions for floating inputs
**Source:** `release.yml` 60, 64, 74; `ci.yml` 34-35, 79, 152
**Apply to:** CFLite's internal `docker://…:v1` image, Azure module's transitive NuGet downloads (A4), the apt `clang` in `asan`
```yaml
        # Documented exception to the pinning rule: Homebrew formulas float and cannot be pinned cheaply.
```

### Hash-pinned tool downloads
**Source:** `.github/requirements-build.txt` (`meson==1.12.1 --hash=sha256:…` with a "how to bump" comment); `ci.yml` 199-218 (download → `Get-FileHash` → compare → `throw`)
**Apply to:** cyclonedx-cli binary, `pip install --require-hashes meson` in the CFLite Dockerfile, the `ArtifactSigning` `-RequiredVersion`.

### Secrets via `env:`, never inline in `run:`
**Source:** `release.yml` 89-107 (`TARGET: ${{ matrix.target }}` then `$TARGET`), `ci.yml` 255-258
**Apply to:** every signing, token and version value in release and fuzz workflows (zizmor template-injection gate).

### Fail-loud, human-sentence errors
**Source:** `engine/build.sh` 51 (`echo "checksum mismatch: $tarball" >&2; … exit 1`), `ci.yml` 212 (`throw "ffmpeg oracle checksum mismatch: got $got, want $want"`), `app/main.js` IPC throws (`new Error('Not a mounted disc')`, line 514)
**Apply to:** sign hooks, verify scripts, generators, source-bundle.

### Main owns privileged actions; renderer passes nothing
**Source:** `app/main.js` `handle()` (474-481), `reveal` (507-510), `install-dvdcss` dialogs (521-527)
**Apply to:** `open-source-release`, `open-chromium-licenses`, `notices`, `about`. Fixed targets are built in main. Renderer text rendering uses `textContent`/`esc()`.

### Packaged vs dev paths
**Source:** `app/main.js` 10-12 (`app.isPackaged ? process.resourcesPath : repo path`), 30, 35-36 (test hooks guarded by `!app.isPackaged`)
**Apply to:** notices/licenses file resolution. Don't add any env override for these paths that works when packaged.

### Single source of truth: the pin table
**Source:** `engine/build.sh` SOURCES (36-41) + `fetch()` (44-61)
**Apply to:** `scripts/pins.js` → SBOM, notices, source bundle, `.clusterfuzzlite/build.sh`, ASan build. Nothing else downloads or re-lists versions.

### Static source-text tests as guards
**Source:** `test/unit/gate-static.test.js`, `test/unit/neutrality.test.js`, `test/unit/lib.test.js` 180-189
**Apply to:** workflows.test.js, entitlements.test.js, the module-version consistency check in sign-win.test.js. No new deps (no YAML parser): regex over text.

### Neutrality guard stays green
**Source:** `test/unit/neutrality.test.js` line 10 regex, scanning `README.md SECURITY.md CLAUDE.md docs app .github`
**Apply to:** `docs/RELEASING.md`, README install/verify text, `THIRD_PARTY_NOTICES.txt` (if it ever gets placed under a scanned path), release-notes template in `.github`. Notices and the source bundle must never name a libdvdcss download (CLAUDE.md Legal).

---

## No Analog Found

| File | Role | Data Flow | Reason / Source to use |
|---|---|---|---|
| `.clusterfuzzlite/Dockerfile` | config | n/a | No Docker in repo. `FROM gcr.io/oss-fuzz-base/base-builder@sha256:<digest>`, `pip install --require-hashes meson==1.12.1` (reuse the hash from `.github/requirements-build.txt`), `COPY . $SRC/spinarr`, `WORKDIR`, `COPY .clusterfuzzlite/build.sh $SRC/` (RESEARCH Pattern 9). |
| `.clusterfuzzlite/project.yaml` | config | n/a | Single line `language: c`. |
| `fuzz/*.options` | config | n/a | `[libfuzzer]\ndetect_leaks=0\nmax_len=<n>` (Pitfall 9). |
| `build/sign-win.ps1` | build script | file-I/O | No PowerShell scripts in repo (only the inline ci.yml step). Use RESEARCH Pattern 3 parameters with ci.yml 201-213 error style. |
| `BUILDING.md` | docs | n/a | New. Content from RESEARCH Pattern 6 (offline build: copy `engine/upstream/*.tar.xz` into `engine/deps/`, then `sh engine/build.sh`). Toolchain list from build.sh header 10-14. Include libudfread and the Electron/Chromium pointer (A6). |
| `docs/RELEASING.md` account runbook sections | docs | n/a | Existing file covers only the release cut (15-22). Runbook structure comes from RESEARCH "External / Account State Inventory" and Pitfalls 4/6. Replace the "Code signing (optional)" table (24-34) and fix the `windows-latest` row (11 → `windows-2025`). |
| Release notes template (`.github/release-notes/*.md` or generated in-step) | docs/template | n/a | None. Wording is at Claude's discretion (CONTEXT). It must not advise bypassing Gatekeeper/SmartScreen (README 51-53 currently does: Pitfall 12). |
| Ops: Immutable Releases, `release` environment, private corpus repo, GitHub App, v0.1.x edits | ops | API | `gh api -X PUT repos/rick-rami94/spinarr/immutable-releases`, etc. (RESEARCH). Every one is a checkpoint. D-08 `gh release edit` needs Rick's explicit go. |

## Metadata

**Analog search scope:** `.github/workflows/`, `.github/*.txt|yml`, `build/`, `engine/` (build.sh, dvdinfo.c, bdinfo.c, patches/), `app/main.js`, `app/preload.js`, `app/renderer/{app.js,index.html,styles.css}`, `test/unit/`, `test/security/`, `test/e2e/scenarios.js`, `docs/RELEASING.md`, `README.md`, `SECURITY.md`, `.gitignore`, `package.json`
**Files scanned:** 24
**Pattern extraction date:** 2026-10-12
