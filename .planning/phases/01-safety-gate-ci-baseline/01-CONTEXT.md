# Phase 1: Safety Gate & CI Baseline - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the worst exposure (SF-1, the auto-scan part): no disc is ever scanned by an unsandboxed engine without an explicit user click, on any OS. Bring the repo and CI to a state that later phases can build on safely: a working disclosure channel (SF-3), a supply-chain-hardened and branch-protected CI (SF-5), neutral decryption guidance (REL-08), Windows running the full suite (PLAT-01), hermetic e2e (QUAL-02) and a c8 coverage baseline (QUAL-01).

Requirements: SAFE-01, REL-05, REL-06, REL-08, QUAL-01, QUAL-02, PLAT-01.

Out of scope here (later phases): the actual Windows sandbox, the Linux seccomp filter and functional probe, the macOS deny-by-default profile, signing and notarization, and fuzzing in CI.

</domain>

<decisions>
## Implementation Decisions

### Unsandboxed scan gate (SAFE-01)
- **D-01:** Every scan entry point is gated while the sandbox is off: inserted disc, drag-drop, and the file/folder picker. Opening a file is **not** consent. The user must click "Scan anyway" on a prompt that says why (the engine sandbox is off on this system).
- **D-02:** "Sandbox active" means the existing static check, `platform.sandboxKind !== 'none'` (`app/platform.js:160`). No functional probe in this phase. Design the gate so a later functional probe (Linux seccomp/probe phase, Windows sandbox phase) can feed the same "sandbox trusted" signal without reworking the gate.
- **D-03:** Never remember "Scan anyway". Ask on every unsandboxed scan, with no session memory and no Settings toggle.
- **D-04:** Enforce in the main process. `scan()` (`app/main.js` ~line 178) refuses an unsandboxed scan unless the IPC call carries an explicit user-confirmed flag, validated like the other IPC args. The renderer shows the prompt and never auto-calls scan with the flag set. Today's auto-scan on insert (`app/renderer/app.js:724-731`) must stop scanning when the sandbox is off and show the prompt instead.
- **D-05:** The `SPINARR_NO_SANDBOX=1` dev escape hatch (unpackaged only) counts as "sandbox off" for the gate, so e2e can exercise the prompt path on macOS and Linux too.
- **D-06:** An e2e test covers each entry point (insert, drag-drop, picker for folder and ISO), checking both that it doesn't scan without the click and that it scans after the click.

### Branch protection (REL-06)
- **D-07:** `main` takes changes through PRs only. Self-merge is allowed and no approving review is required (solo maintainer).
- **D-08:** No admin bypass. Protection is enforced for admins too.
- **D-09:** Required status checks: all CI jobs: macOS, Linux, Windows and audit.
- **D-10:** Block force-pushes and deletion of `main`. Linear history is **not** required.
- **D-11:** Sequencing: turn branch protection on as the **last** step of the phase, after CI is green with the new required job names. Otherwise this phase's own direct pushes and GSD doc commits to `main` get blocked. Required check names must exactly match the final job names.

### Coverage and CI gates (QUAL-01, PLAT-01, REL-06)
- **D-12:** c8 measures unit and engine tests. Thresholds = the recorded baseline per metric, rounded **down** to the whole percent. Raising the floor is a manual, visible change.
- **D-13:** Coverage is measured and enforced on **Linux only**. macOS and Windows run the tests without c8.
- **D-14:** The baseline lives as thresholds in a committed `.c8rc.json`.
- **D-15:** The Windows job runs the full suite (unit, security corpus, engine lossless oracle, e2e) within the existing **60-minute** timeout. Use caching or reuse of the Linux fixtures as needed to fit.
- **D-16:** Pin every GitHub Action by full commit SHA (with a version comment), in both `ci.yml` and `release.yml`. Pin toolchains, for example `pip install 'meson>=1.3'` → an exact version and the Node version. The dependency audit must actually cover Electron, which is a devDependency, so today's `--omit=dev` audit is vacuous.

### Disclosure (REL-05)
- **D-17:** SECURITY.md fallback contact: `rickramirez94@gmail.com`.
- **D-18:** Turn on GitHub private vulnerability reporting, Dependabot alerts and Dependabot security updates. Add a `.github/dependabot.yml` for npm and github-actions version updates.

### Decryption neutrality (REL-08)
- **D-19:** Remove the VideoLAN URL from the app entirely: `VIDEOLAN_WIN64` in `app/platform.js:9`, its use at line 290 and its export, and the Settings text at `app/renderer/app.js:392`. The Windows Settings wording becomes neutral, e.g. "Spinarr can use libdvdcss-2.dll (64-bit) if you have it. Choose it here." No link and no named download site anywhere in the repo, the docs included.
- **D-20:** README: drop the direct DLL link and the VideoLAN mention for Windows. **Keep** the package-manager names and commands for macOS and Linux (`brew install libdvdcss`, dnf, pacman). They're neutral.
- **D-21:** **Keep** `brew install libdvdcss` in macOS CI. It's a test-only dependency that covers the CSS paths and is never shipped or fetched by the app. Add a comment in `ci.yml` saying so.

### e2e hermeticity (QUAL-02)
- **D-22:** e2e must never read the real user's AACS or dvdcss folders. Point every key and cache directory (the `platform.keyDirs`, `cssCache` and aacs config dirs) at the test tmp dir. A scenario covers the default `accurateChapters=false` path; the harness currently defaults to `true` in `test/e2e/run.js:70`.

### Claude's Discretion
- How the prompt looks within the existing skins (reuse the existing `.error-box.banner` / button patterns; no UI-SPEC for this phase).
- Exact c8 config shape, reporters, and how CI publishes the coverage report.
- Dependabot schedule and grouping.
- How to make the Windows job fit in 60 minutes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/REQUIREMENTS.md`: SAFE-01, REL-05, REL-06, REL-08, QUAL-01, QUAL-02, PLAT-01
- `.planning/ROADMAP.md` § Phase 1: goal and the 5 success criteria
- `.planning/PROJECT.md`: core value (correctness and safety first), the Active list

### Audit findings (outside the repo)
- `~/projects/spinarr-audit/SPINARR_REVIEW_HANDOFF.md`: findings table: SF-1 (auto-scan unsandboxed), SF-3 (disclosure channel broken), SF-5 (CI supply chain, unprotected main, vacuous audit), SF-11 (DLL loading)
- `~/projects/spinarr-audit/SPINARR_ENGINEERING_AUDIT.md`: full audit and evidence

### Project research
- `.planning/research/PITFALLS.md`, `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`

### Existing security docs (to update)
- `SECURITY.md`: currently has no fallback contact and claims "No auto-scan of downloaded images"
- `docs/SECURITY_TESTING.md`: threat model
- `docs/ENCRYPTED_DISCS.md`: decryption setup guidance (check for links)
- `README.md` lines ~57-70 and 133, 177: libdvdcss setup and legal text
- `CLAUDE.md`: project instructions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `platform.sandboxKind` / `platform.info()` (`app/platform.js:160, 344`): the existing sandbox signal; already shown in Settings → System (`app/renderer/app.js:376-406`)
- IPC `handle()` wrapper with argument validation (`app/main.js:411`), plus `lib.validateSource` for adding the confirm flag
- `.error-box.banner` with action buttons (used for the AACS KEYDB prompt, `test/e2e/scenarios.js:450-453`): pattern for the "Scan anyway" prompt
- The e2e harness drives the real app with `SPINARR_USER_DATA` and a tmp `settings.json` (`test/e2e/run.js:27, 63-70`)

### Established Patterns
- Scan results stay in the main process (`scans` Map); the renderer never supplies trusted data
- Test hooks are ignored when packaged (`app/main.js:32`, `NO_SANDBOX` needs `!app.isPackaged`)
- CI: Linux generates fixtures and shares them with Windows via an artifact; Windows can't author DVDs

### Integration Points
- Scan entry points in the renderer: `drives-changed` auto-scan (`app.js:724-731`), drag-drop (`app.js:688-693`), the picker (`app.js:536` `openPicker` → `loadSource`), and the scan call at `app.js:433`
- `scan()` in `app/main.js:178`, which the gate wraps
- `.github/workflows/ci.yml` (Windows job currently runs only unit tests, an engine smoke test and e2e), `.github/workflows/release.yml` (`softprops/action-gh-release@v2` with `contents: write`)
- `package.json` scripts: `test:unit`, `test:engine`, `test:security`, `test:e2e`

</code_context>

<specifics>
## Specific Ideas

- The prompt text should explain *why* in plain words: the engine sandbox is off on this system, so opening a disc runs the parsers with the user's full privileges.
- SECURITY.md's "How Spinarr is hardened" section must be updated to describe the new gate truthfully, without overclaiming.

</specifics>

<deferred>
## Deferred Ideas

- A functional sandbox probe at startup → the Linux sandbox phase (SF-7) and the Windows sandbox phase (SF-1). They plug into the gate's "sandbox trusted" signal.
- A per-session or Settings "allow unsandboxed scans" option: rejected for now, could be revisited after the Windows sandbox ships.

</deferred>

---

*Phase: 01-safety-gate-ci-baseline*
*Context gathered: 2026-10-10*
