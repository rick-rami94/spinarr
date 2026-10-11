# Phase 1: Safety Gate & CI Baseline - Research

**Researched:** 2026-10-10
**Domain:** Electron main/renderer scan gating, GitHub Actions supply-chain hardening, GitHub repo security settings, c8 coverage, cross-platform test harness
**Confidence:** HIGH overall. The codebase is read in full, the GitHub API state is queried live, and action SHAs are resolved live. Two e2e techniques (CDP drag-drop, patching `dialog`) are MEDIUM and come with fallbacks.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Unsandboxed scan gate (SAFE-01)
- **D-01:** Every scan entry point is gated while the sandbox is off: inserted disc, drag-drop, and the file/folder picker. Opening a file is **not** consent. The user must click "Scan anyway" on a prompt that says why (the engine sandbox is off on this system).
- **D-02:** "Sandbox active" means the existing static check, `platform.sandboxKind !== 'none'` (`app/platform.js:160`). No functional probe in this phase. Design the gate so a later functional probe (Linux seccomp/probe phase, Windows sandbox phase) can feed the same "sandbox trusted" signal without reworking the gate.
- **D-03:** Never remember "Scan anyway". Ask on every unsandboxed scan, with no session memory and no Settings toggle.
- **D-04:** Enforce in the main process. `scan()` (`app/main.js` ~line 178) refuses an unsandboxed scan unless the IPC call carries an explicit user-confirmed flag, validated like the other IPC args. The renderer shows the prompt and never auto-calls scan with the flag set. Today's auto-scan on insert (`app/renderer/app.js:724-731`) must stop scanning when the sandbox is off and show the prompt instead.
- **D-05:** The `SPINARR_NO_SANDBOX=1` dev escape hatch (unpackaged only) counts as "sandbox off" for the gate, so e2e can exercise the prompt path on macOS and Linux too.
- **D-06:** An e2e test covers each entry point (insert, drag-drop, picker for folder and ISO), checking both that it doesn't scan without the click and that it scans after the click.

#### Branch protection (REL-06)
- **D-07:** `main` takes changes through PRs only. Self-merge is allowed and no approving review is required (solo maintainer).
- **D-08:** No admin bypass. Protection is enforced for admins too.
- **D-09:** Required status checks: all CI jobs: macOS, Linux, Windows and audit.
- **D-10:** Block force-pushes and deletion of `main`. Linear history is **not** required.
- **D-11:** Sequencing: turn branch protection on as the **last** step of the phase, after CI is green with the new required job names. Otherwise this phase's own direct pushes and GSD doc commits to `main` get blocked. Required check names must exactly match the final job names.

#### Coverage and CI gates (QUAL-01, PLAT-01, REL-06)
- **D-12:** c8 measures unit and engine tests. Thresholds = the recorded baseline per metric, rounded **down** to the whole percent. Raising the floor is a manual, visible change.
- **D-13:** Coverage is measured and enforced on **Linux only**. macOS and Windows run the tests without c8.
- **D-14:** The baseline lives as thresholds in a committed `.c8rc.json`.
- **D-15:** The Windows job runs the full suite (unit, security corpus, engine lossless oracle, e2e) within the existing **60-minute** timeout. Use caching or reuse of the Linux fixtures as needed to fit.
- **D-16:** Pin every GitHub Action by full commit SHA (with a version comment), in both `ci.yml` and `release.yml`. Pin toolchains, for example `pip install 'meson>=1.3'` → an exact version and the Node version. The dependency audit must actually cover Electron, which is a devDependency, so today's `--omit=dev` audit is vacuous.

#### Disclosure (REL-05)
- **D-17:** SECURITY.md fallback contact: `rickramirez94@gmail.com`.
- **D-18:** Turn on GitHub private vulnerability reporting, Dependabot alerts and Dependabot security updates. Add a `.github/dependabot.yml` for npm and github-actions version updates.

#### Decryption neutrality (REL-08)
- **D-19:** Remove the VideoLAN URL from the app entirely: `VIDEOLAN_WIN64` in `app/platform.js:9`, its use at line 290 and its export, and the Settings text at `app/renderer/app.js:392`. The Windows Settings wording becomes neutral, e.g. "Spinarr can use libdvdcss-2.dll (64-bit) if you have it. Choose it here." No link and no named download site anywhere in the repo, the docs included.
- **D-20:** README: drop the direct DLL link and the VideoLAN mention for Windows. **Keep** the package-manager names and commands for macOS and Linux (`brew install libdvdcss`, dnf, pacman). They're neutral.
- **D-21:** **Keep** `brew install libdvdcss` in macOS CI. It's a test-only dependency that covers the CSS paths and is never shipped or fetched by the app. Add a comment in `ci.yml` saying so.

#### e2e hermeticity (QUAL-02)
- **D-22:** e2e must never read the real user's AACS or dvdcss folders. Point every key and cache directory (the `platform.keyDirs`, `cssCache` and aacs config dirs) at the test tmp dir. A scenario covers the default `accurateChapters=false` path; the harness currently defaults to `true` in `test/e2e/run.js:70`.

### Claude's Discretion
- How the prompt looks within the existing skins (reuse the existing `.error-box.banner` / button patterns; no UI-SPEC for this phase).
- Exact c8 config shape, reporters, and how CI publishes the coverage report.
- Dependabot schedule and grouping.
- How to make the Windows job fit in 60 minutes.

### Deferred Ideas (OUT OF SCOPE)
- A functional sandbox probe at startup → the Linux sandbox phase (SF-7) and the Windows sandbox phase (SF-1). They plug into the gate's "sandbox trusted" signal.
- A per-session or Settings "allow unsandboxed scans" option: rejected for now, could be revisited after the Windows sandbox ships.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-01 | A disc is never scanned automatically while the engine sandbox is inactive, on any OS. The user sees why and must click to scan. [SF-1] | §Pattern 1 (one renderer chokepoint `requestScan`, main-process `userConfirmed` gate, probe/rip piggyback on an existing scan); §Pitfalls 1-4; §e2e techniques for insert, drop and picker |
| REL-05 | Private vulnerability reporting on, SECURITY.md fallback contact, Dependabot alerts and updates on. [SF-3] | §Pattern 5 (exact `gh api` calls, live state is all disabled); §dependabot.yml example |
| REL-06 | Actions SHA-pinned, toolchains pinned, `main` branch-protected with required checks, audit covers Electron. [SF-5] | §SHA pin table (resolved live); §zizmor findings (26 high today); §Pattern 6 (branch protection payload); §Pitfall 6 (a full moderate audit fails today) |
| REL-08 | README has no direct libdvdcss DLL link. Setup guidance is neutral and nothing ships or fetches decryption components. | §Runtime/Repo inventory of every VideoLAN/DLL reference, including the `open-dvdcss-page` IPC and the preload bridge entry that must go too |
| QUAL-01 | c8 coverage in CI for unit and engine tests, recorded baseline, no regression. | §Pattern 4 (`.c8rc.json`, measured local baseline, `lines` defaults to 90); §Pitfall 7 |
| QUAL-02 | Hermetic e2e (no real AACS/dvdcss folders); a scenario covers `accurateChapters=false`. | §Pattern 3 (`SPINARR_TEST_HOME` hook through `createPlatform({home})`, env scrubbing, CI sentinel test) |
| PLAT-01 | Windows CI runs unit, security corpus, engine (lossless oracle) and e2e. | §Pattern 7 (independent ffmpeg oracle pinned by SHA-256, `src/` fixtures shipped in the artifact, `.exe` checks in engine tests); timings measured from the last CI run |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Security:** the engine never gets network access, and disc data is always untrusted. The gate must not weaken this.
- **Legal:** never bundle or fetch decryption libraries or keys (DMCA §1201). This drives REL-08 and the D-21 comment.
- **Tech stack:** Electron, plain HTML/CSS/JS, no UI framework. The prompt is hand-written markup in `app/renderer/app.js`. No new runtime npm dependencies (c8 is dev-only).
- **Git:** repo-local identity `Rick Ramirez <30266247+rick-rami94@users.noreply.github.com>` (verified as configured). **No Claude co-author trailers.** **Milestone work happens on branches, not directly on `main`.** The current branch is `milestone/v1.0`.
- **GSD workflow:** edits go through GSD commands. Execution happens via `/gsd-execute-phase`.
- **Stack prescriptions relevant here:** c8 12.0.0 over `node --test`; zizmor 1.30.1 and pinact 5.0.0 for workflows; Dependabot `github-actions` keeps SHAs fresh. `pip install meson==<x.y.z> --require-hashes` replaces `meson>=1.3`. Avoid mutable tags.

## Summary

The gate is a small, well-bounded change, but it touches more entry points than CONTEXT.md lists. `spinarr.scan` is reached from **six** renderer paths:
- boot auto-scan (`app.js:754-756`)
- `drives-changed` insert (`app.js:724-731`)
- drag-drop (`app.js:688-693`)
- the picker via `openPicker` (`app.js:536`)
- a sidebar source click (`data-src`, `app.js:556`)
- the KEYDB-installed re-scan (`app.js:584`)

The main process also exposes **`probe`** (ffprobe on any validated source) and **`rip`** (ffmpeg on any validated DVD source, no prior scan required). Either one parses an unscanned disc unsandboxed, which bypasses a scan-only gate. The prescriptive design:
1. **Renderer:** every path funnels through one `requestScan(src)`, which shows a "Scan anyway" banner instead of scanning when the sandbox is untrusted. `spinarr.scan` is called in exactly one place.
2. **Main:** `scan` refuses without `{ userConfirmed: true }` when untrusted. `probe` and `rip` refuse when untrusted unless the source already has a scan result in this session.
3. **One `sandboxTrusted()` function** in main is the single signal later probe phases replace.

CI is green today but needs four kinds of work:
- **Pinning.** 26 high zizmor findings: 24 `unpinned-uses` plus 2 `cache-poisoning` in `release.yml`. All are verified by running zizmor 1.30.1 locally.
- **Toolchain pins.** Node 22 floating, `meson>=1.3`, `windows-latest` and `ubuntu-latest`.
- **A meaningful audit.** `--omit=dev` audits zero packages. A naive "audit everything at moderate" fails **today** on 8 moderate build-tooling advisories (sprintf-js via electron-builder), so the Electron check must be targeted.
- **The Windows full suite.** Windows has no independent ffmpeg oracle (none on the runner image, and the engine's remux-only ffmpeg can't decode). The Linux fixture artifact also excludes `src/`, which holds the lossless oracle's reference `.mpg` files.

Every GitHub-side control is currently **off**, verified via API: private vulnerability reporting `{"enabled":false}`, vulnerability alerts 404, automated security fixes `{"enabled":false}`, `main` not protected, no rulesets.

Branch protection must land last (D-11). The CLAUDE.md branch rule adds a sequencing wrinkle: work is on `milestone/v1.0`, and `ci.yml` only runs on `push: main` and `pull_request`. Nothing runs CI for this phase's commits until a PR `milestone/v1.0 → main` is opened.

**Primary recommendation:** Build the gate first, as one renderer chokepoint plus a main-process invariant, with e2e per entry point. Then make CI honest: SHA pins, toolchain pins, a targeted Electron audit, zizmor, c8 on Linux and the Windows full suite. Open a draft PR from `milestone/v1.0` so CI runs. Flip the GitHub settings. Enable branch protection last, with contexts `macos`, `linux`, `windows`, `audit`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scan-consent enforcement (refuse unsandboxed scan/probe/rip without consent) | Electron main process (`app/main.js` IPC handlers) | — | Main owns engine spawning. The renderer is not trusted to enforce (PITFALLS #24). |
| "Sandbox trusted" signal | Main (`sandboxTrusted()` = `!NO_SANDBOX && platform.sandboxKind !== 'none'`) | `app/platform.js` (static kind today, probe later) | One function that later phases replace. Exposed to the renderer via `system`. |
| Consent prompt UI + funnelling all entry points | Renderer (`app/renderer/app.js`) | — | UX only, never trusted. It must still never auto-send `userConfirmed`. |
| Pure gate decision logic | `app/lib.js` (new `scanGate()` / `validateScanOptions()`) | — | Unit-testable and counted by c8. Matches the existing `validate*` pattern. |
| Hermetic key/cache dirs | Main (`createPlatform({ home })` hook) | e2e runner env | Paths derive from `home`/env in `createPlatform`. The test hook is honoured only when unpackaged. |
| CI hardening, coverage, Windows suite | GitHub Actions (`.github/workflows/*.yml`) | `package.json` scripts, `.c8rc.json` | Config-only tier |
| Disclosure, Dependabot, branch protection | GitHub repo settings (REST API via `gh`) | `SECURITY.md`, `.github/dependabot.yml` | Not in git. Applied via API and verified via API. |

## Standard Stack

### Core
| Library / Tool | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| c8 | 12.0.0 (npm, modified 2026-07-16; engines `^20.19.0 \|\| ^22.12.0 \|\| >=23`) [VERIFIED: npm registry + slopcheck OK] | V8 coverage over `node --test`, thresholds, lcov | CLAUDE.md prescription. Node's built-in coverage is still experimental. Measured working against this repo locally. |
| zizmor | 1.30.1 (PyPI, 2026-09-09) [VERIFIED: PyPI + slopcheck OK; ran locally] | Workflow static analysis (unpinned-uses, cache-poisoning, artipacked, template injection) | CLAUDE.md prescription. Finds exactly SF-5. |
| GitHub Dependabot (`.github/dependabot.yml` v2) | service | npm + github-actions version updates. It updates SHA pins and keeps version comments. | [CITED: docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference] |
| `gh` CLI | installed, authenticated as `rick-rami94`, scopes `repo, workflow` [VERIFIED] | Apply/verify private reporting, alerts, security fixes, branch protection | Admin on own repo is required by these endpoints [CITED: docs.github.com/en/rest/repos/repos] |

### Supporting
| Tool | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pinact | 5.0.0 (2026-09-12) [VERIFIED: GitHub releases] | Rewrite `uses: x@vN` → `x@<sha> # vX.Y.Z` | Optional. The SHA table below was resolved by hand with `git ls-remote`. Use pinact or zizmor to double-check. |
| FFmpeg Windows build (GyanD/codexffmpeg) | 8.1.2 essentials zip, `sha256:db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec` (asset digest from GitHub API) [VERIFIED: GitHub API] | **Independent** oracle ffmpeg/ffprobe for Windows engine tests and e2e | Windows job only, test-only. Verify the SHA-256 in the workflow before use. 9.0.2 is also available (`sha256:60f46726...2047ba`). |
| meson | 1.12.1 (PyPI latest) wheel `sha256:930bc7542cbd9f57009e182fd014eba48cf1a0180a7b9006d2d32d8f168d8b02` [VERIFIED: PyPI JSON] | Linux engine build in ci.yml + release.yml | Replace `pip3 install --user 'meson>=1.3'` with `pip3 install --user --require-hashes -r .github/requirements-build.txt` |
| Node.js | 22.23.3 (LTS "Jod", 2026-09-23) [VERIFIED: nodejs.org/dist/index.json] | Exact Node for tests | `.nvmrc` with `22.23.3`, and `node-version-file: .nvmrc` in every setup-node step |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Classic branch protection (`PUT /branches/main/protection`) | Repository rulesets (`POST /repos/{o}/{r}/rulesets`) | Rulesets are newer and show bypass actors explicitly. Classic maps 1:1 onto D-07..D-10 (`enforce_admins`, `required_pull_request_reviews.required_approving_review_count: 0`, `allow_force_pushes: false`, `allow_deletions: false`) and is simpler to verify with one GET. **Use classic.** |
| GyanD pinned zip | msys2 `mingw-w64-x86_64-ffmpeg` (msys2 is already set up in the job) | msys2 is rolling and unpinnable, which contradicts D-16. It is a big dependency pull. Use only as fallback. |
| Codecov / third-party coverage upload | `$GITHUB_STEP_SUMMARY` + `actions/upload-artifact` of `coverage/` | No new token or third party. Matches the supply-chain goal of this phase. |
| zizmor as its own CI job | zizmor as a step inside the `audit` job | A new job would add a required-check name (D-09 says "all CI jobs"). Putting it in `audit` keeps exactly 4 required contexts. **Use a step.** |

**Installation:**
```bash
npm install --save-dev --save-exact c8@12.0.0
# CI-only (in the audit job): pipx run zizmor==1.30.1 --format plain .github/workflows
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| c8 | npm | ~8 yrs (v12.0.0 2026-07) | widely used (not measured) | github.com/bcoe/c8 | [OK] (`-e npm`) | Approved |
| zizmor | PyPI | ~2 yrs (v1.30.1 2026-09-09) | not measured | github.com/zizmorcore/zizmor | [OK] (`-e pypi`) | Approved (CI-only, run via `pipx run`) |
| meson | PyPI | ~12 yrs | not measured | github.com/mesonbuild/meson | not run (already in use) | Approved (pinned + hash) |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none. Without `-e npm`, slopcheck checked the PyPI namesake `c8` and called it SUS. The npm package is OK. Always pass `--ecosystem`.
`c8` postinstall: none (`npm view c8 scripts.postinstall` is empty).

## Architecture Patterns

### System Architecture Diagram

```
 Entry points (renderer)                      Renderer chokepoint                Main process (trusted)
 ───────────────────────                      ───────────────────                ──────────────────────
 boot: optical disc present ─┐
 drives-changed: new optical ┤
 drag-drop ISO/folder ───────┤                ┌──────────────────────┐
 picker (file / folder) ─────┼──► requestScan(src) ─► sandboxTrusted? ─yes─► spinarr.scan(src) ──► handle('scan')
 sidebar source click ───────┤                │       (state.system)  │                           │
 KEYDB installed → rescan ───┘                │          │ no / unknown│                           ▼
                                              │          ▼            │                 validateSource + validateScanOptions
                                              │  render "Scan anyway" │                           │
                                              │  banner (esc(name))   │                 sandboxTrusted()? ──yes──► scan()
                                              │          │ user click │                           │ no
                                              │          ▼            │                 userConfirmed===true? ─no─► throw SANDBOX_OFF
                                              └ spinarr.scan(src,{userConfirmed:true}) ─────────► │ yes
                                                                                                   ▼
                                                                                         scan() → runEngine(dvdinfo/bdinfo)
                                                                                                   │ (sandboxed if kind≠none)
                                                                                                   ▼
                                                                                         scans.set(source, result)
 probe(src,title) ─────────────────────────────────────────────────────► handle('probe'): untrusted && !scans.has(src) → refuse
 rip(jobs) ────────────────────────────────────────────────────────────► enqueue(): untrusted && !scans.has(job.source) → refuse
```

### Recommended file touch map
```
app/lib.js              # + validateScanOptions(o), + scanGate({ trusted, userConfirmed, scanned }) (pure)
app/main.js             # sandboxTrusted(); scan/probe/rip gating; system → { ...info, sandbox, sandboxTrusted };
                        #   SPINARR_TEST_HOME hook; remove handle('open-dvdcss-page')
app/platform.js         # remove VIDEOLAN_WIN64 (const, url field, export)
app/preload.js          # remove openDvdcssPage; scan stays invoke('scan') (now takes (source, opts))
app/renderer/app.js     # requestScan()/confirmScan(); state.pendingScan; prompt banner; neutral DLL copy;
                        #   remove 'dvdcss-page' case; boot/insert/drop/picker/sidebar/keydb all call requestScan
test/unit/lib.test.js   # scanGate + validateScanOptions cases
test/unit/neutrality.test.js  # repo grep: no libdvdcss download URL / VideoLAN name near libdvdcss
test/e2e/harness.js     # h.load clicks "Scan anyway" when prompted; helpers: fakeInsert, dropFile, stubDialog
test/e2e/run.js         # SPINARR_TEST_HOME=tmp/home, scrub XDG_*/APPDATA/LOCALAPPDATA; keep accurateChapters default true
test/e2e/scenarios.js   # gate_* scenarios per entry point; us_default_chapters (accurateChapters=false);
                        #   sec_hermetic_keydirs; update sec_renderer_isolation bridge list
test/engine/*.test.js   # exe-suffix existence checks; accurateChapters:false oracle variant
.c8rc.json              # thresholds (floor of Linux baseline)
.nvmrc                  # 22.23.3
.github/requirements-build.txt  # meson==1.12.1 --hash=sha256:...
.github/dependabot.yml
.github/workflows/ci.yml, release.yml
.gitattributes          # test/fixtures/** -text (Windows checkout safety)
SECURITY.md, README.md, docs/ENCRYPTED_DISCS.md, docs/SECURITY_TESTING.md, .github/ISSUE_TEMPLATE/config.yml
```

### Pattern 1: One renderer chokepoint + main-process invariant (SAFE-01)
**What:** All six renderer paths call `requestScan(src)`. Only `requestScan` (trusted path) and `confirmScan` (button click) call `spinarr.scan`. Main refuses without consent.
**When:** Always. A unit test asserts `spinarr.scan(` appears exactly twice in `app/renderer/app.js`, inside those two functions. This catches PITFALLS #24 regressions (a new path that calls scan directly).

```js
// app/lib.js (pure, unit-tested)
function validateScanOptions(o) {
  if (o == null) return { userConfirmed: false };
  if (typeof o !== 'object' || Array.isArray(o)) throw new Error('Invalid scan options');
  return { userConfirmed: o.userConfirmed === true }; // strict boolean, like accurateChapters
}
const SANDBOX_OFF = 'SANDBOX_OFF'; // stable error code the renderer maps to the prompt
function scanGate({ trusted, userConfirmed }) {
  if (trusted || userConfirmed) return null;
  return `${SANDBOX_OFF}: The engine sandbox is off on this system, so Spinarr won't read a disc until you choose Scan anyway.`;
}

// app/main.js
const sandboxTrusted = () => !NO_SANDBOX && platform.sandboxKind !== 'none'; // later: && probe passed
handle('scan', (source, opts) => {
  const src = lib.validateSource(source);
  const { userConfirmed } = lib.validateScanOptions(opts);
  const refusal = lib.scanGate({ trusted: sandboxTrusted(), userConfirmed });
  if (refusal) throw new Error(refusal);
  return scan(src);
});
handle('probe', (source, title) => {
  const src = lib.validateSource(source);
  if (!sandboxTrusted() && !scans.has(src)) throw new Error('Scan the disc first');
  return probeTitle(src, lib.validateTitle(title));
});
// enqueue(): inside the per-job map, after validateJob:
//   if (!sandboxTrusted() && !scans.has(job.source)) throw new Error('Scan the disc again before ripping');
handle('system', () => ({ ...platform.info(), sandbox: sandboxTrusted() ? platform.sandboxKind : 'none', sandboxTrusted: sandboxTrusted() }));
```

```js
// app/renderer/app.js (shape only)
const sandboxTrusted = () => state.system?.sandboxTrusted === true; // null/unknown → untrusted (fail closed)
function requestScan(src) {
  if (sandboxTrusted()) return loadSource(src);              // loadSource calls spinarr.scan(src)
  Object.assign(state, { source: src, disc: null, error: null, scanning: false, pendingScan: src });
  renderSources(); renderMain();                              // renders the banner synchronously
}
function confirmScan() {                                      // only from the button click handler
  const src = state.pendingScan; if (!src) return;
  state.pendingScan = null;                                   // D-03: consent is single-use
  loadSource(src, { userConfirmed: true });
}
// loadSource(src, opts) → spinarr.scan(src, opts); on an error starting 'SANDBOX_OFF' → requestScan(src) (show prompt again)
```

Prompt markup reuses `.error-box.banner` + `.row-btns` + `.primary-btn` / `.ghost-btn` (styles.css:349-357, 691-693). It goes in the `!state.disc` empty state when `state.pendingScan` is set:
- Title: "Scan this disc?"
- Body: "The engine sandbox is off on this system, so reading **{esc(baseName(src))}** runs the disc parsers with your full user permissions."
- Buttons: `data-action="scan-anyway"` "Scan anyway", and `data-action="scan-cancel"` "Not now".
- Give it `role="alertdialog"` or `role="alert"`.

### Pattern 2: e2e drivers for each entry point (D-06)
All four gate scenarios set `env: { SPINARR_NO_SANDBOX: '1' }` (D-05), so they run on macOS, Linux and Windows. Each asserts:
1. After the trigger, wait ~1.5 s. `state.disc === null`, `state.pendingScan` is set, the banner exists, and no `scanning`.
2. A direct `spinarr.scan(src)` from the page is **rejected** with `SANDBOX_OFF`. `spinarr.probe(src, 1)` is rejected.
3. After `click('[data-action="scan-anyway"]')`, `state.disc.titles.length > 0`.
4. Loading the same source again prompts again (D-03).

| Entry point | How to drive it from `harness.js` (runs in main) | Confidence |
|---|---|---|
| Insert | `win.webContents.send('drives-changed', { discs: [{ name: 'NTSC_BASIC', path: h.fx('ntsc_basic'), kind: 'optical', media: 'dvd' }], hasDrive: true })`. This exercises the real renderer listener on all OSes, with no hdiutil. | HIGH (uses the existing `send` channel) |
| Boot with disc present | Refactor boot to call the same `onDrives(drives, { boot: true })` used by `drives-changed`, so the insert scenario covers it. Plus the static unit check that `spinarr.scan(` only appears in the chokepoint. | HIGH |
| Picker (ISO + folder) | In harness: `const { dialog } = require('electron'); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [h.fx('ntsc_basic.iso')] });` then `click('#openBtn')`. For a folder, return `h.fx('ntsc_basic')` and call `openPicker('folder')`. `#openFolderBtn` is hidden on macOS. | MEDIUM [ASSUMED: the Electron `dialog` export object is writable, and main.js's destructured `dialog` is the same object]. Fallback: a `SPINARR_TEST_PICK` env hook in `pick-source`, unpackaged only. |
| Drag-drop | `win.webContents.debugger.attach('1.3')`, then `Input.dispatchDragEvent` `dragEnter` → `dragOver` → `drop` at the window centre with `data: { items: [], files: [h.fx('ntsc_basic.iso')], dragOperationsMask: 1 }`. This produces OS-like `File` objects, so `webUtils.getPathForFile` returns the path. | MEDIUM [CITED: CDP browser_protocol.json, Input.dispatchDragEvent / DragData.files, marked experimental]. Fallback: extract the drop body into `onDropPath(p)` and call it via `h.js`, and say so in the scenario note. |

`h.load(src)` must keep working for the ~25 existing scenarios on Windows, where every scan now prompts. Rewrite it as: `js('requestScan(src)')`, then `waitFor('state.pendingScan || state.scanning || state.disc || state.error')`. If `pendingScan`, click `[data-action="scan-anyway"]`, then `waitFor('!state.scanning && !state.pendingScan')`. This uses the real button, with no test bypass of the gate.

### Pattern 3: Hermetic home for e2e (QUAL-02)
`createPlatform` already derives every key and cache dir from `home` and `env`:
- macOS: `~/Library/...`
- Windows: `APPDATA`, `LOCALAPPDATA`
- Linux: `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`

`engineEnv` hands the same values to the engine (`HOME`, `DVDCSS_CACHE`, and the XDG vars on Linux). So one hook covers both app-side and engine-side reads:
```js
// app/main.js — test hook, ignored when packaged (same rule as SPINARR_USER_DATA)
const TEST_HOME = !app.isPackaged && process.env.SPINARR_TEST_HOME;
const baseEnv = app.isPackaged ? { ...process.env, SPINARR_VOLUMES: '' } : process.env;
const platformEnv = TEST_HOME
  ? { ...baseEnv, XDG_CONFIG_HOME: '', XDG_CACHE_HOME: '', APPDATA: path.join(TEST_HOME, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(TEST_HOME, 'AppData', 'Local') }
  : baseEnv;
const platform = createPlatform({ run, dataDir: app.getPath('userData'), env: platformEnv, home: TEST_HOME || os.homedir() });
```
Notes:
- An empty `XDG_*` falls through `||` to `home` (`platform.js:136-137`).
- `test/e2e/run.js` sets `SPINARR_TEST_HOME: path.join(env.tmp, 'home')`.
- Keep the run.js default `accurateChapters: true` for speed, and add a dedicated scenario that sets `env.settings = { accurateChapters: false }` in `setup()`.

Verification:
1. `sec_hermetic_keydirs` asserts `state.system.aacs.keydbPath` starts with the tmp home. Add `platform` to the harness `ctx` and assert `cssCache` and every `keyDirs` value start with it.
2. **CI-only sentinel** (guard `process.env.CI === 'true'`; never touch a developer's real home). Before e2e, write a valid-looking `KEYDB.cfg` into the real `~/.config/aacs/` (Linux) or `~/Library/Preferences/aacs/` (macOS). Assert the app reports "No key file" and `bd_aacs` shows the no-KEYDB reason. This proves the real folder isn't read.

### Pattern 4: c8 on Linux only (QUAL-01)
```json
// .c8rc.json — thresholds = floor(Linux CI baseline); placeholders until the first Linux run
{
  "all": true,
  "src": ["app"],
  "include": ["app/**/*.js"],
  "exclude": ["app/main.js", "app/preload.js", "app/renderer/app.js"],
  "reporter": ["text", "text-summary", "lcov"],
  "report-dir": "coverage",
  "check-coverage": true,
  "lines": 0, "statements": 0, "functions": 0, "branches": 0
}
```
```json
// package.json
"test:coverage": "c8 node --test \"test/unit/*.test.js\" \"test/security/*.test.js\" \"test/engine/*.test.js\""
```
- **Why the excludes:** `main.js`, `preload.js` and `renderer/app.js` need Electron or a DOM and are exercised only by e2e. With `--all` they count as 0% and drag the total to 29% lines (measured). Excluding them by name means any **new** `app/**` module is automatically counted at 0% until tested. That's why the gate logic belongs in `lib.js`.
- **Measured locally (macOS, Node 24.12, this config):** unit + security + engine gives **lines/statements 84.49%, branches 91.8%, functions 87.71%** (lib.js 99.67%, platform.js 69.54%, format.js 100%). 156 tests in 31 s. Linux numbers will differ, because `platform.js` takes different branches and `sandbox.test.js` runs under bwrap. **Record the baseline from the Linux CI log**, floor each metric, and commit.
- **Linux job:** replace the three `test:unit` / `test:security` / `test:engine` steps with `npm run test:coverage`. Then append `npx c8 report --reporter=text-summary >> $GITHUB_STEP_SUMMARY`, or `cat` the text-summary, and upload `coverage/` as an artifact. macOS and Windows keep the plain scripts (D-13).

### Pattern 5: GitHub settings (REL-05), applied and verified via API
```bash
R=repos/rick-rami94/spinarr
gh api -X PUT $R/private-vulnerability-reporting          # verify: gh api $R/private-vulnerability-reporting → {"enabled":true}
gh api -X PUT $R/vulnerability-alerts                     # verify: gh api -i $R/vulnerability-alerts → 204
gh api -X PUT $R/automated-security-fixes                 # needs alerts on first; verify → {"enabled":true,...}
```
[CITED: docs.github.com/en/rest/repos/repos]. Current state is all disabled [VERIFIED: live API 2026-10-10].

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    groups:
      dev-tooling: { patterns: ["*"], update-types: [minor, patch] }
    cooldown: { default-days: 7 }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
    groups:
      actions: { patterns: ["*"] }
    cooldown: { default-days: 7 }
```
`cooldown` and `groups` are documented options [CITED: dependabot-options-reference]. Security updates bypass the open-PR limit. Electron majors arrive ungrouped as separate PRs. That's good, because each needs CI and e2e.

### Pattern 6: Branch protection, last step (REL-06, D-07..D-11)
```bash
gh api -X PUT repos/rick-rami94/spinarr/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["macos", "linux", "windows", "audit"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0, "dismiss_stale_reviews": false, "require_code_owner_reviews": false },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false
}
JSON
```
All four top-level keys are required (nullable). `required_approving_review_count: 0` is allowed ("0 to not require reviewers") [CITED: docs.github.com/en/rest/branches/branch-protection]. Contexts are the job ids `macos`, `linux`, `windows`, `audit`, since `ci.yml` jobs have no `name:`. If a job gains a `name:`, the context changes. Verify with `gh api repos/rick-rami94/spinarr/commits/<sha>/check-runs --jq '.check_runs[].name'` on the green PR head before applying. `strict: false` (no "branch must be up to date") is a judgment call for a solo maintainer [ASSUMED].

### Pattern 7: Windows full suite (PLAT-01)
Measured from the last green run (37990414506): the whole Windows job took **7m43s**. Engine build 4m22s, msys2 setup 55s, e2e 1m20s. Linux fixtures and tests finish in ~5 min. **Time isn't the constraint. Correctness of the oracle is.**

Changes needed:
1. **Ship `src/` in the fixture artifact.** The lossless oracle compares rips against `test/fixtures/out/src/{nb1,nb2,ps1,feat,logo}.mpg` (`engine.test.js:108-112`), but `ci.yml` tars with `--exclude=src`. Drop that exclude (src is ~26 MB). Keep `--exclude=bdsrc` (unused by tests) and the forbidden-character exclude.
2. **Independent oracle.** The runner image has no ffmpeg [VERIFIED: runner-images Windows2025/2022 readmes]. The engine's ffmpeg is remux-only and can't serve `decodedHash` (`-f md5` decodes). Download the GyanD 8.1.2 essentials zip by URL and verify its SHA-256 in PowerShell (`(Get-FileHash ...).Hash`). Extract it, cache with `actions/cache` keyed on the SHA, and set `ORACLE_FFMPEG_DIR` to its `bin`, for both `test:engine` and `test:e2e`. e2e currently uses `engine\bin` as its "oracle".
3. **Engine tests portable.** `fs.existsSync(path.join(BIN, 'dvdinfo'))` fails on Windows (`.exe`). Use `const exe = (n) => process.platform === 'win32' ? n + '.exe' : n` for existence checks. `spawnSync`/`execFileSync` of extension-less paths already work on Windows, because libuv tries `.com` then `.exe` [ASSUMED: libuv search_path behaviour; the existing corpus tests rely on it implicitly and have not yet run on Windows].
4. **Add steps:** `npm run test:security` (corpus; `sandbox.test.js` self-skips when `sandboxKind === 'none'`) and `npm run test:engine`. Drop the "Engine smoke test" step or keep it as a fast pre-check.
5. **Pin `runs-on: windows-2025`** (was `windows-latest`) and `ubuntu-24.04` for `audit`.

### Anti-Patterns to Avoid
- **Gate only in the renderer**, or only on `scan`: `probe` and `rip` still parse unscanned discs unsandboxed.
- **Test-only "auto-confirm" env var in main:** it would be a gate bypass shipped in the source, even if `!app.isPackaged`. Drive the real button instead.
- **Treating `state.system === null` as trusted:** the boot order is `settings → system → drives`, but `drives-changed` can fire before `system` resolves. Fail closed.
- **Remembering consent on `scans.has(src)` for future *scans*:** probe and rip may piggyback on an existing scan result, but every new scan call needs a fresh click (D-03).
- **Path filters on `ci.yml`:** a required check that never reports blocks the PR forever.
- **Hand-rolled coverage gating or a third-party coverage service:** c8's `check-coverage` plus the step summary covers it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding unpinned actions / workflow injection | grep scripts | zizmor 1.30.1 (`pipx run zizmor==1.30.1 --format plain .github/workflows`) | It already finds 26 high issues here, including cache-poisoning that grep would miss |
| Keeping SHA pins fresh | manual bumps | Dependabot `github-actions` | It updates the SHA and the `# vX.Y.Z` comment |
| Coverage thresholds | a custom lcov parser | c8 `check-coverage` + `.c8rc.json` | Native per-metric thresholds |
| Synthetic drag-drop with real file paths | `new File()` in page JS (no path; `getPathForFile` returns empty) | CDP `Input.dispatchDragEvent` with `data.files` | Produces File objects backed by real paths |
| Applying repo security settings | clicking through the UI | `gh api -X PUT ...` | Repeatable, and verifiable in the plan's verification step |

## Runtime State Inventory (repo + GitHub-side state; REL-08 is a removal sweep)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None. No database. User `settings.json` has no dvdcss URL field. | None (verified by reading `loadSettings`/`SETTINGS_SCHEMA`) |
| Live service config (not in git) | GitHub: private vuln reporting off; vulnerability alerts off (404); automated security fixes off; `main` unprotected; no rulesets; secret scanning + push protection **on** [VERIFIED: API]. | API PUTs (Pattern 5/6). Not code edits. |
| OS-registered state | None for this phase | None |
| Secrets/env vars | `release.yml` uses `MAC_CERT_*`, `APPLE_*`, `WIN_CERT_*` secrets. They are unaffected, but make sure the pinned `release` job keeps `contents: write` scoped to that job only. | None |
| Build artifacts / code references to remove (REL-08) | `app/platform.js:9` `VIDEOLAN_WIN64`; `:290` `url: VIDEOLAN_WIN64`; `:348` export. **`app/main.js:457` `handle('open-dvdcss-page')`** and **`app/preload.js:23` `openDvdcssPage`**: these become dead and must be removed, or they remain an `shell.openExternal` sink. `app/renderer/app.js:392-393` text + "Open VideoLAN download" button; `:576` `case 'dvdcss-page'`. `test/e2e/scenarios.js:43` bridge-key list includes `openDvdcssPage` (update it). `README.md:69`. `docs/ENCRYPTED_DISCS.md:37`. | Code + doc edits. Keep the `engine/build.sh:38-40` download.videolan.org source URLs: they are libdvdread/libdvdnav/libbluray sources, not decryption components. Keep `docs/SECURITY_TESTING.md:128` (upstreaming patches) and `CLAUDE.md:229` (source citation). Scope the neutrality test to "libdvdcss/DLL download guidance". |

## Common Pitfalls

### Pitfall 1: A scan-only gate leaves probe and rip open
**What goes wrong:** `handle('probe')` runs ffprobe on any validated source. `enqueue` accepts DVD jobs with no prior scan (`sec_ipc_validation` does exactly this at `scenarios.js:98`). Both parse disc structures unsandboxed on Windows.
**How to avoid:** When untrusted, require `scans.has(source)` for probe and rip. Update `sec_ipc_validation` to scan first (via `h.load`) before the traversal rip, and add asserts that probe/rip of an unscanned source are refused under `SPINARR_NO_SANDBOX=1`.
**Warning signs:** any `runEngine`/`engine()` call path reachable from IPC without `scans.has` or the gate.

### Pitfall 2: Every existing Windows e2e scenario breaks
**What goes wrong:** Windows is always untrusted, so ~25 scenarios that call `h.load` hit the prompt and time out at `waitFor('!state.scanning')`, which resolves instantly with `state.disc === null`.
**How to avoid:** Use the Pattern 2 `h.load` rewrite. Mounted-image scenarios that click `[data-src]` (macOS only) also need the scan-anyway click when `NO_SANDBOX` is set. They run sandboxed on macOS by default, so they're unaffected unless the env is set.

### Pitfall 3: XSS through the prompt
**What goes wrong:** The prompt shows the disc or folder name, which is attacker-controlled (`sec_xss_volume_label`, `sec_xss_folder_name`, `bd_xss_label`).
**How to avoid:** Use `esc()` for every interpolation, as the rest of `app.js` does. Run the XSS scenarios with `SPINARR_NO_SANDBOX=1` once, so the prompt path itself is XSS-tested.

### Pitfall 4: Race between `requestScan` and `waitFor`
**What goes wrong:** If `requestScan` sets state after an `await`, the harness may observe the old state.
**How to avoid:** Make the untrusted branch fully synchronous (set `pendingScan` + render before returning).

### Pitfall 5: CI never runs for this phase's commits
**What goes wrong:** `ci.yml` triggers are `push: [main]` and `pull_request`. Work is on `milestone/v1.0` (CLAUDE.md branch rule), so nothing runs, and D-11's "CI green with new job names" can't be observed.
**How to avoid:** Open a **draft PR `milestone/v1.0 → main`** at the start of execution. Every push then runs CI, and the required-check names appear on it. Do not add `push: milestone/**` too (it would double-run). After protection is on, the merge goes through that PR.

### Pitfall 6: "Audit covers Electron" done naively turns CI red
**What goes wrong:** `npm audit --audit-level=moderate` (all deps) fails **today** with 8 moderate advisories, all through `electron-builder → app-builder-lib → @electron/get → global-agent → roarr → sprintf-js` (DoS, build-time only, fix needs semver-major) [VERIFIED: local `npm audit --json`]. Note that today's second step, `npm audit --audit-level=high`, *does* include devDependencies, so Electron is audited at high or above. The vacuous part is the `--omit=dev` "Shipped code" step: there are zero runtime deps.
**How to avoid:** Replace "Shipped code" with a targeted Electron check: Electron *is* the shipped runtime, so fail on **any** advisory affecting `electron`. Keep the whole-tree audit at `high`. Add `npm audit signatures`.
```bash
npm audit --json > audit.json || true
node -e "const a=require('./audit.json').vulnerabilities||{}; if(a.electron){console.error('Electron advisory:',JSON.stringify(a.electron.via,null,1));process.exit(1)}"
npm audit --audit-level=high
npm audit signatures
```
Electron advisories are published to the GitHub advisory DB under npm `electron`. Five high/medium ones landed 2026-09-29 [VERIFIED: `gh api advisories?ecosystem=npm&affects=electron`]. The current 44.7.0 is clean.

### Pitfall 7: c8 `lines` defaults to 90
**What goes wrong:** If `.c8rc.json` sets `check-coverage` but omits `lines`, c8 enforces 90% lines. `statements`, `branches` and `functions` default to 0 [VERIFIED: c8 `lib/parse-args.js`].
**How to avoid:** Set all four explicitly. The first commit can use 0s with `check-coverage: true`. The baseline commit floors the Linux numbers.

### Pitfall 8: zizmor cache-poisoning in release.yml
**What goes wrong:** `release.yml` restores caches (`setup-node cache: npm`, and the `actions/cache` engine-deps cache) in a tag-triggered, artifact-publishing workflow [VERIFIED: zizmor `cache-poisoning` at release.yml:35, :41]. Engine tarballs are SHA-256-verified by `build.sh`, which reduces real impact, but npm cache entries are not.
**How to avoid:** Remove both caches from `release.yml`. The extra minutes on a release build are acceptable. Keep caches in `ci.yml` (no publishing). zizmor also reports `superfluous-actions` on `softprops/action-gh-release` (informational). Pin it to v3.0.3 or switch to `gh release create --draft`. Both are allowed by CLAUDE.md.

### Pitfall 9: Required checks vs. job dependencies
**What goes wrong:** `windows` `needs: linux`. If Linux fails, Windows is skipped, and a skipped required check counts as not passing. That's correct here, but a rename of any job silently orphans its required context.
**How to avoid:** Freeze the job ids `macos`, `linux`, `windows`, `audit`. Apply protection only after a green run shows exactly these four check-run names.

### Pitfall 10: Node 20 actions
**What goes wrong:** All currently used `@v4` actions declare `node20`. GitHub removed Node 20 from runners on 2026-09-23 and runs them on Node 24 [CITED: github.blog changelog 2025-09-19 + updates]. CI still passes, but the pins should target node24 majors.
**How to avoid:** Pin to the latest majors (table below). Each one declares `node24` [VERIFIED: action.yml at each SHA]. The breaking changes that matter here are minimal: download-artifact v5 changes only by-ID path layout (we use `name:`), and v8 makes digest mismatches errors (desirable).

## Code Examples

### SHA pin table (resolved 2026-10-10 via `git ls-remote`, commit SHAs with annotated tags peeled)
| Action | Pin |
|---|---|
| actions/checkout | `3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` |
| actions/setup-node | `949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` |
| actions/cache | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0` |
| actions/upload-artifact | `cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2` |
| actions/download-artifact | `9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2` |
| msys2/setup-msys2 | `ec48f7c5447b3140e2b088413ae3a55687bccb6e # v2.33.0` |
| softprops/action-gh-release | `efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3` (annotated tag, peeled) |

If the executor prefers to stay on the current majors (v4), the v4 pins are: checkout `11d5960a326750d5838078e36cf38b85af677262 # v4.4.0`, setup-node `49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`, cache `0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0`, upload-artifact `ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2`, download-artifact `d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0`. All of these are node20. **Re-verify any SHA with `git ls-remote https://github.com/<repo> refs/tags/<tag> refs/tags/<tag>^{}` at execution time.**

### Toolchain pins
```yaml
- uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
  with: { node-version-file: .nvmrc, cache: npm }      # .nvmrc: 22.23.3
- run: pip3 install --user --require-hashes -r .github/requirements-build.txt
# .github/requirements-build.txt:
# meson==1.12.1 --hash=sha256:930bc7542cbd9f57009e182fd014eba48cf1a0180a7b9006d2d32d8f168d8b02
```
Floating inputs that can't be pinned cheaply should get an inline comment as documented exceptions: Homebrew formulas (macOS), msys2 `update: true` pacman packages, and Ubuntu apt packages (signed distro archive). Brew `libdvdcss` gets the D-21 comment: "test-only: exercises CSS paths; never shipped or fetched by Spinarr."

### Windows oracle step (shape)
```yaml
- name: Independent ffmpeg oracle (test-only, pinned)
  shell: pwsh
  run: |
    $url = 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip'
    $want = 'DB580001CAA24AC104C8CB856CD113A87B0A443F7BDF47D8C12B1D740584A2EC'
    Invoke-WebRequest $url -OutFile oracle.zip
    if ((Get-FileHash oracle.zip -Algorithm SHA256).Hash -ne $want) { throw 'oracle checksum mismatch' }
    Expand-Archive oracle.zip -DestinationPath $env:RUNNER_TEMP\oracle
    "ORACLE_FFMPEG_DIR=$((Get-ChildItem $env:RUNNER_TEMP\oracle -Directory)[0].FullName)\bin" >> $env:GITHUB_ENV
```

### Neutrality guard (unit test, sketch)
```js
// test/unit/neutrality.test.js — fail if any tracked doc/app file points users at a libdvdcss download
const files = execFileSync('git', ['ls-files', 'README.md', 'docs', 'app', 'SECURITY.md'], { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  assert.doesNotMatch(t, /libdvdcss[^\n]*https?:\/\/|https?:\/\/[^\s)]*libdvdcss|VideoLAN[^\n]*(dll|download)|(dll|download)[^\n]*VideoLAN/i, f);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `uses: x@v4` tags | SHA pins + Dependabot github-actions | ongoing (tj-actions 2025 incident class) | REL-06 |
| node20 actions | node24 majors | Node 20 removed from runners 2026-09-23 | Pin to the node24 majors above |
| `actions/attest-build-provenance` | `actions/attest` | v4 | Not this phase (Phase 2) |
| `--experimental-test-coverage` | c8 | still experimental in Node 26 | c8 |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Overwriting `require('electron').dialog.showOpenDialog` in the harness affects main.js's destructured `dialog` | Pattern 2 | Picker e2e can't stub. Use the `SPINARR_TEST_PICK` unpackaged hook fallback. |
| A2 | CDP `Input.dispatchDragEvent` with `data.files` works through `webContents.debugger` in Electron 44 and yields paths via `webUtils.getPathForFile` | Pattern 2 | Drop e2e falls back to calling an extracted `onDropPath(p)`, which is weaker coverage of the listener itself |
| A3 | libuv appends `.exe` to extension-less spawn paths on Windows | Pattern 7 | Corpus and engine tests fail to spawn. Add `platform.exe()`-style suffixes everywhere (cheap). |
| A4 | On macOS, brew libaacs resolves its config dir from `$HOME` (engineEnv `HOME` = test home) | Pattern 3 | The engine could read the real `~/Library/Preferences/aacs`. The CI sentinel test detects this. |
| A5 | On Windows, libaacs/libdvdcss are only loadable from the tmp `userLib` (DLL search path = userLib + System32), so the engine can't read the real `%APPDATA%\aacs` in e2e. (libaacs may use `SHGetFolderPath`, which ignores env.) | Pattern 3 | Windows hermeticity of engine-level reads relies on the DLL not loading. Acceptable in CI, but document it. |
| A6 | `strict: false` on required status checks is acceptable for a solo maintainer | Pattern 6 | Less protection against semantic merge conflicts. Flip to `true` if preferred. |
| A7 | GyanD essentials build includes the mpeg2video/ac3/dvdsub/mpegps decoders the oracle needs | Pattern 7 | Use `full_build` instead (larger) |

## Open Questions (RESOLVED)

1. **Does Phase 1 end with a merge to `main` and a patch release, so users actually get the gate?**
   - What we know: the goal says "closed immediately". The releasing work (signing etc.) is Phase 2.
   - Unclear: whether a v0.1.4 unsigned release with the gate should ship now.
   - Recommendation: the planner adds a final, optional, human-checkpoint task: "merge PR, tag v0.1.4". Otherwise the fix only exists on a branch.
   - RESOLVED: optional checkpoint in 01-10 Tasks 3–4 (user decides at execution).
2. **Should probe/rip gating stay limited to the untrusted case?**
   - Recommendation: yes, for this phase. SAFE-11 (later) makes "rips of unscanned sources rejected" universal.
   - RESOLVED: 01-02 gates probe/rip only when the sandbox is untrusted.
3. **Exact c8 thresholds.** These are only knowable from the first Linux CI run on the PR. Plan a two-commit sequence: c8 wired with zeros, then a baseline commit.
   - RESOLVED: zero thresholds in 01-04, floored Linux baseline in 01-09.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| gh CLI (authenticated, admin) | REL-05/06 API calls | ✓ | logged in as rick-rami94, scopes repo, workflow | — |
| Node.js (local) | tests | ✓ | v24.12.0 (CI pins 22.23.3) | — |
| npm | c8 install, audit | ✓ | 11.6.2 | — |
| Engine binaries + fixtures (local) | engine tests, baseline dry-run | ✓ | engine/bin + test/fixtures/out present | — |
| ffprobe oracle (local) | engine tests | ✓ | /usr/local/bin | — |
| Docker | optional Linux baseline via `test/linux/run.sh` | ✓ | 29.1.2 | Use CI |
| zizmor | workflow lint | ✗ globally (ran from a scratch venv) | 1.30.1 | `pipx run zizmor==1.30.1` in CI |
| pinact | optional | ✗ | — | Hand table above + zizmor |
| Windows/Linux machines | PLAT-01 | ✗ locally | — | CI runners only. Windows e2e can only be validated in CI. |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 22 in CI) + custom Electron e2e harness (`test/e2e/run.js`) |
| Config file | none for node:test; `.c8rc.json` (new, Wave 0) |
| Quick run command | `npm run test:unit` (~0.2 s) |
| Full suite command | `npm test`; Linux CI: `npm run test:coverage && xvfb-run -a npm run test:e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAFE-01 | `scanGate` / `validateScanOptions` truth table (trusted, confirmed, non-boolean flag rejected) | unit | `node --test test/unit/lib.test.js` | ✅ file, ❌ cases |
| SAFE-01 | `spinarr.scan(` only appears in `requestScan`/`confirmScan` | unit (static) | `node --test test/unit/gate-static.test.js` | ❌ Wave 0 |
| SAFE-01 | insert / drop / picker-ISO / picker-folder: no scan before the click, scan after it, re-prompt on reload | e2e | `node test/e2e/run.js gate_insert gate_drop gate_pick_iso gate_pick_folder` | ❌ Wave 0 |
| SAFE-01 | main refuses scan without flag; probe/rip of unscanned source refused when untrusted | e2e | `node test/e2e/run.js sec_gate_ipc` | ❌ Wave 0 |
| REL-05 | private reporting, alerts, security fixes enabled; SECURITY.md has fallback email | API check + unit grep | `gh api repos/rick-rami94/spinarr/private-vulnerability-reporting --jq .enabled` (expect `true`), etc. | manual-run script, ❌ |
| REL-06 | no unpinned uses, no cache-poisoning | CI lint | `pipx run zizmor==1.30.1 --format plain .github/workflows` (exit 0) | ❌ (audit job step) |
| REL-06 | Electron advisory check + high audit | CI | audit job script (Pitfall 6) | ❌ |
| REL-06 | branch protection matches D-07..D-10 | API check | `gh api repos/rick-rami94/spinarr/branches/main/protection --jq '{e:.enforce_admins.enabled,c:.required_status_checks.contexts,f:.allow_force_pushes.enabled,d:.allow_deletions.enabled}'` | final task |
| REL-08 | no libdvdcss download link or VideoLAN download mention; bridge has no `openDvdcssPage` | unit + e2e | `node --test test/unit/neutrality.test.js`; `node test/e2e/run.js sec_renderer_isolation` | ❌ / ✅ (update list) |
| QUAL-01 | coverage ≥ floor | CI (Linux) | `npm run test:coverage` | ❌ Wave 0 |
| QUAL-02 | key/cache dirs under tmp home; real-home sentinel not read (CI) | e2e | `node test/e2e/run.js sec_hermetic_keydirs` | ❌ Wave 0 |
| QUAL-02 | default `accurateChapters=false` rip: chapters present, lossless | e2e + engine | `node test/e2e/run.js us_default_chapters`; engine.test variant | ❌ Wave 0 |
| PLAT-01 | Windows runs unit, security, engine, e2e | CI | windows job steps | ❌ (workflow edit) |

### Sampling Rate
- **Per task commit:** `npm run test:unit`, plus the specific e2e scenarios touched (`node test/e2e/run.js <names>`, ~5-20 s each on macOS).
- **Per wave merge:** `npm test` locally (macOS), plus a push to the draft PR so CI runs on all three OSes.
- **Phase gate:** CI green on the PR for `macos`, `linux`, `windows`, `audit`, with the coverage floor enforced. Then apply branch protection and verify it via API.

### Wave 0 Gaps
- [ ] `.c8rc.json` + `test:coverage` script + `c8@12.0.0` devDependency
- [ ] `test/unit/gate-static.test.js`, `test/unit/neutrality.test.js`
- [ ] Harness helpers: `fakeInsert`, `dropFile` (CDP), `stubDialog`, prompt-aware `h.load`; `platform` in harness `ctx`
- [ ] `SPINARR_TEST_HOME` hook in `main.js` + run.js env
- [ ] Draft PR `milestone/v1.0 → main` so CI runs

## Security Domain

### Applicable ASVS Categories (L1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture (trust boundaries) | yes | Consent enforced in main, not the renderer. One `sandboxTrusted()` signal. |
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | IPC sender check (`handle()` already checks `senderFrame.url` and `sender`). New gate on scan/probe/rip. Branch protection with `enforce_admins`. |
| V5 Input Validation | yes | `validateScanOptions` (strict `=== true`), existing `validateSource`/`validateTitle`/`validateJob`, `esc()` on prompt output |
| V6 Cryptography | no (only SHA-256 verification of downloaded CI tools, using platform `Get-FileHash`/pip `--require-hashes`) | Never hand-roll |
| V10 Malicious code / V14 Configuration (supply chain) | yes | SHA-pinned actions, hash-pinned meson, pinned oracle zip, zizmor, Dependabot, `npm audit signatures`, `persist-credentials: false` (already), least-privilege `permissions` (already `contents: read`) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Zero-click hostile disc parsed at user privilege (SF-1) | Elevation of Privilege | Main-process consent gate on scan/probe/rip; e2e per entry point |
| Renderer bug auto-calls scan with the flag | Tampering | The flag is only set inside the click handler. Static test on `spinarr.scan(` call sites. Consent is single-use. |
| A compromised renderer sets `userConfirmed: true` itself | EoP | **Residual, accepted**: the renderer is our own sandboxed, CSP-locked page. The gate defends against logic bugs, not renderer compromise. Document this in SECURITY.md without overclaiming. |
| Label/folder-name XSS in the prompt | Tampering | `esc()`, CSP (already strict); XSS scenarios run on the prompt path |
| Mutable action tag hijack / cache poisoning in release | Tampering | SHA pins, no caches in release.yml, zizmor gate |
| Lost vulnerability reports (SF-3) | Repudiation/Info | Private reporting on, plus a fallback email in SECURITY.md. Point `ISSUE_TEMPLATE/config.yml` `contact_links` at `/security/advisories/new`. |
| `shell.openExternal` sink left behind (`open-dvdcss-page`) | Tampering | Remove the handler and the bridge entry entirely |

SECURITY.md truthfulness: replace "No auto-scan of downloaded images. Only physical optical discs scan automatically." with an accurate statement:
- Discs scan automatically only when the engine sandbox is on.
- On systems where it's off (Windows today, Linux without bubblewrap), Spinarr asks before every scan.
- Disk images and folders are never scanned without a click.

Also update `docs/SECURITY_TESTING.md:38` (F-8 row) and `:66`.

## Sources

### Primary (HIGH confidence)
- Repository source read in full: `app/main.js`, `app/platform.js`, `app/preload.js`, `app/renderer/app.js`, `test/e2e/{run,harness,scenarios}.js`, `test/engine/*.test.js`, `test/security/*.test.js`, `.github/workflows/{ci,release}.yml`, `SECURITY.md`, `README.md`, `docs/ENCRYPTED_DISCS.md`
- Live GitHub API (2026-10-10): repo security_and_analysis, private-vulnerability-reporting, vulnerability-alerts, automated-security-fixes, branch protection, rulesets, CI run 37990414506 step timings, advisories for npm `electron`, GyanD/codexffmpeg asset digests
- `git ls-remote` tag resolution + `action.yml` `runs.using` at each pinned SHA
- zizmor 1.30.1 run on the current workflows (45 findings, 26 high)
- c8 12.0.0 README + `lib/parse-args.js` (installed in scratch); local coverage measurement
- npm registry (`npm view c8`), PyPI JSON (meson 1.12.1, zizmor 1.30.1), nodejs.org dist index (22.23.3)
- slopcheck: c8 (npm) OK, zizmor (PyPI) OK
- [GitHub REST: repos](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28), [branch protection](https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2022-11-28), [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- CDP `browser_protocol.json` (ChromeDevTools/devtools-protocol master): `Input.dispatchDragEvent`, `DragData.files`

### Secondary (MEDIUM confidence)
- [GitHub Changelog: Deprecation of Node 20 on Actions runners](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) and the [aiogram#1906 note on 2026-09-23 removal](https://github.com/aiogram/aiogram/issues/1906)
- actions/runner-images Windows2025/2022 readmes (no ffmpeg)
- `.planning/research/PITFALLS.md` #24 (gate as an engine-level invariant)

### Tertiary (LOW confidence)
- None relied on without a fallback (see Assumptions A1-A7)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Versions, SHAs and digests are resolved live, and c8 and zizmor were run against this repo.
- Architecture (gate): HIGH. Derived from a complete read of every scan path. The e2e drivers for picker and drop are MEDIUM, with fallbacks.
- Pitfalls: HIGH. Most are reproduced: the audit failure, zizmor findings, coverage numbers and the excluded `src/` fixtures.

**Research date:** 2026-10-10
**Valid until:** ~2026-11-10. Action SHAs and Electron advisories move fast, so re-resolve pins at execution.
