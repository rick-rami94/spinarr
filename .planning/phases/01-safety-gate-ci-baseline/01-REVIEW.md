---
phase: 01-safety-gate-ci-baseline
reviewed: 2026-10-11T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - .c8rc.json
  - .gitattributes
  - .github/ISSUE_TEMPLATE/config.yml
  - .github/dependabot.yml
  - .github/requirements-audit.txt
  - .github/requirements-build.txt
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - .gitignore
  - .nvmrc
  - README.md
  - SECURITY.md
  - app/lib.js
  - app/main.js
  - app/platform.js
  - app/preload.js
  - app/renderer/app.js
  - app/renderer/styles.css
  - docs/ENCRYPTED_DISCS.md
  - docs/SECURITY_TESTING.md
  - package.json
  - test/e2e/harness.js
  - test/e2e/run.js
  - test/e2e/scenarios.js
  - test/engine/bluray.test.js
  - test/engine/engine.test.js
  - test/security/corpus.test.js
  - test/unit/gate-static.test.js
  - test/unit/lib.test.js
  - test/unit/neutrality.test.js
  - test/unit/platform.test.js
findings:
  critical: 1
  warning: 8
  info: 4
  total: 13
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-10-11
**Depth:** standard (diff 830e90a..HEAD)
**Files Reviewed:** 31
**Status:** issues_found

## Summary

The SAFE-01 `scan` handler is solid. It accepts consent only as a literal `true`, it fails closed, and it asks again on every call. The renderer chokepoint (`requestScan` → `confirmScan` → `loadSource`) covers all six entry points I traced: insert, boot, drop, picker, sidebar click, and the KEYDB retry.

The problem is the other two IPC handlers. `probe` and `rip` decide whether a disc may be parsed by checking `scans.has(path)`. That check is keyed by **path, not by disc identity**, and the cache is never cleared on eject. Once you consent for `D:\`, any later disc in that drive can be probed or ripped without the sandbox and without another prompt. The same goes for any later contents of the same `.iso` path. This contradicts SECURITY.md ("asks before every scan and never remembers the answer"). I rate it a BLOCKER.

`SPINARR_TEST_HOME` is correctly gated on `!app.isPackaged`, as are every other test hook in `main.js`. I found no leak into packaged builds.

The CI-only KEYDB sentinel cannot overwrite an existing user file. It writes with `flag: 'wx'` and only unlinks the path it created. But it can be left behind in the real home folder, and on today's runners its assertion proves nothing. No CI runner installs libaacs, so the key file is never actually read.

The workflows are pinned and least-privilege. Two things are off: signing secrets reach PR-triggered builds, and the "restores NO caches" claim in `release.yml` probably isn't true for `setup-msys2`.

## Critical Issues

### CR-01: Probe/rip consent is tied to a path, not a disc, so swapping the disc skips the SAFE-01 gate

**File:** `app/main.js:183-211, 274, 447-451` (also `test/e2e/scenarios.js` `sec_gate_ipc`, `SECURITY.md`)
**Issue:** With the sandbox off, `probe` and `enqueue` only check `scans.has(src)`. `scans` is a `Map` keyed by the normalized source path. It is filled on a consented scan and only trimmed when it passes 50 entries. Nothing removes an entry when the volume is ejected or the image file changes.

For DVDs, `probeStreams` and `ripArgs` don't use the cached scan at all. They run `ffprobe -f dvdvideo` and `ffmpeg` straight on whatever is at the path now. Those are the same untrusted parsers the gate exists to protect.

Concrete paths with no second prompt:

1. **Windows (always sandbox-off), drive letter reused.** The user consents to disc A at `D:\` and rips. They swap in disc B while a rip from another drive or image is running. `onDrives` skips `requestScan` because something is ripping, and the `sourceGone` cleanup only matches `/Volumes/`. So `state.disc` still shows A's titles with `state.source === 'D:\\'`. Clicking Rip calls `enqueue`, `scans.has('D:\\')` is true, and ffmpeg parses disc B unsandboxed.
2. **Queued jobs outlive a disc swap.** Jobs queued against `D:\` run later, against whatever disc is in the drive by then. The gate is checked only at enqueue time.
3. **Image files.** After consent for `~/Downloads/x.iso`, overwriting that file (re-download, sync client, network share) lets `probe` and `rip` parse the new bytes without a prompt.
4. **Any renderer-side caller.** Any renderer code can call `spinarr.probe` or `spinarr.rip` on an already-consented path without going through `requestScan`. The main-process check that SECURITY.md describes is the only barrier, and it is satisfied.

`sec_gate_ipc` asserts `probe works once the source was scanned with consent`, which bakes path-keyed consent into the tests. No scenario checks that `probe` or `rip` are refused after an eject and re-insert.

**Fix:** Tie consent to the scanned medium and clear it when the medium changes:
```js
// on scan: record identity
const st = fs.statSync(source);
scans.set(source, { ...result, id: `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}` });

// shared check for probe/enqueue (and re-check in pump() before spawning)
function assertScannedSame(src) {
  const disc = scans.get(src);
  if (!disc) throw new Error('Scan the disc first');
  if (!sandboxTrusted()) {
    const st = fs.statSync(src);
    if (disc.id !== `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`) { scans.delete(src); throw new Error('Scan the disc again'); }
  }
  return disc;
}

// in watchVolumes' onChange: drop scans whose path vanished or changed
for (const k of scans.keys()) { try { /* compare id */ } catch { scans.delete(k); } }
```
A volume serial number, or a hash of `VIDEO_TS.IFO` / `index.bdmv`, identifies a disc more reliably than `dev:ino` on Windows. Also re-check identity in `pump()` before `start()` so queued jobs can't run against a swapped disc. Add an e2e scenario: consent → `fakeEject` → swap the fixture at the same path → `spinarr.probe` and `spinarr.rip` must be refused.

## Warnings

### WR-01: Consent comes from the renderer, so a compromised renderer turns into unsandboxed native parsing

**File:** `app/main.js:440-446`, `app/lib.js:528-532`
**Issue:** `userConfirmed: true` is a plain IPC argument. Main cannot tell a real "Scan anyway" click from injected script calling `spinarr.scan(p, { userConfirmed: true })`. SECURITY.md admits this limit. Still, the core value is "opening a disc can never compromise the user's computer", and disc labels and names are rendered into the DOM. One XSS regression would turn into running the C parsers outside the sandbox on any path that passes `validateSource`.
**Fix:** Ask for consent in the main process with a native `dialog.showMessageBox(win, { type: 'warning', buttons: ['Scan anyway', 'Not now'], cancelId: 1, defaultId: 1, message: ... })` when `!sandboxTrusted()`. Keep the renderer banner as a pre-prompt only, and drop `userConfirmed` from the IPC contract.

### WR-02: The prompt isn't cleared when a non-`/Volumes/` source disappears, and on Windows it names the drive, not the disc

**File:** `app/renderer/app.js:757-764, 135`
**Issue:** `sourceGone` only matches `state.source?.startsWith('/Volumes/')`. So on Windows and Linux, `pendingScan` (and a stale `state.disc`) survive an eject. If the replacement disc arrives during a rip, `requestScan` is skipped and the old "Scan this disc?" banner stays up. "Scan anyway" then scans the new disc, which the user never saw named. On Windows, `baseName('D:\\')` renders as `D:`, which says nothing about which disc is being trusted.
**Fix:** Compute `sourceGone` for every OS as "the current source was a listed drive and no longer is":
```js
const wasDrive = state.drives.discs.some((d) => d.path === state.source);
const sourceGone = wasDrive && !drives.discs.some((d) => d.path === state.source);
```
(Check this before `state.drives = drives` runs.) Show the volume label (`d.name`) in the prompt for drive sources.

### WR-03: A stale scan error overwrites the current source's state

**File:** `app/renderer/app.js:460-470`
**Issue:** The success branch checks `state.source !== src`, but the `catch` branch doesn't, except for the `SANDBOX_OFF` case. Say scan A is in flight, then the user picks B (a prompt or a new scan). When A fails, `state.error` is set to A's error and `state.scanning = false` while B is pending or scanning. The UI then shows "Couldn't read this source" under B's consent prompt, or drops B's busy state too early.
**Fix:**
```js
} catch (e) {
  if (state.source !== src) return;
  if (cleanErr(e).startsWith('SANDBOX_OFF')) { ... return requestScan(src); }
  state.error = cleanErr(e);
}
```

### WR-04: The CI sentinel test never exercises libaacs, so it proves nothing

**File:** `test/e2e/scenarios.js` (`sec_hermetic_keydirs`), `.github/workflows/ci.yml:38, 182`
**Issue:** No CI job installs libaacs. The brew line has no `libaacs`, and apt and MSYS2 don't either. On every runner the `bd_aacs` reason is therefore "Install libaacs", which the allow-list `/Install libaacs|found no KEYDB\.cfg|AACS files couldn't be read/` accepts. The engine never looks for a key file, so it never gets the chance to read the sentinel. The test plants a file in the runner's real home and then passes vacuously. The report says "sentinel active", which overstates what was checked.
**Fix:** Either install libaacs on at least one runner (`brew install libaacs` / `apt-get install libaacs0`) and require the `found no KEYDB.cfg` branch whenever `SPINARR_SENTINEL` is set, or remove the sentinel and keep the path-only assertions. If you keep it, fail when the reason is `Install libaacs` while the sentinel is active.

### WR-05: The sentinel can be left in a real user's aacs folder

**File:** `test/e2e/run.js:57-93`
**Issue:** The only gate is `CI === 'true'`. Developers often export that locally, and many tools set it. Cleanup runs on normal completion and in `process.on('exit')`, but Node does **not** emit `'exit'` when it is killed by a signal. Ctrl-C (SIGINT), SIGTERM from a CI cancel, or a SIGKILL leaves a fake `KEYDB.cfg` in `~/Library/Preferences/aacs`, `%APPDATA%\aacs`, or `~/.config/aacs`. Then Spinarr's Settings, VLC, and any other libaacs consumer see a "key file present" that holds no keys. `mkdirSync(dir, { recursive: true })` can also leave a new empty folder behind. The `wx` flag does prevent overwriting an existing file.
**Fix:** Require an explicit opt-in such as `GITHUB_ACTIONS === 'true' && process.env.SPINARR_E2E_SENTINEL === '1'`, set only in `ci.yml`. Add `process.on('SIGINT'|'SIGTERM', () => { removeSentinel(sentinel); process.exit(130); })`. Before unlinking, check the content still starts with the sentinel marker, and remove the folder only if `run.js` created it.

### WR-06: Release signing secrets are exposed to PR-triggered builds

**File:** `.github/workflows/release.yml:15-25, 89-107`
**Issue:** `release.yml` runs on `pull_request` for packaging paths, and its Package step always passes `MAC_CERT_P12_BASE64`, `WIN_CERT_PFX_BASE64`, the passwords, and the Apple ID credentials. A same-repo PR branch therefore runs electron-builder and every npm dependency's code with the real signing material, and signs unreviewed code. There is no `environment:` protection gate. Fork PRs don't get secrets, but any collaborator branch, or a compromised dependency in a PR's lockfile bump, does.
**Fix:** Only expose secrets on tag pushes, and put them behind a protected environment:
```yaml
    environment: ${{ startsWith(github.ref, 'refs/tags/v') && 'release' || '' }}
    env:
      CSC_LINK: ${{ startsWith(github.ref, 'refs/tags/v') && secrets.MAC_CERT_P12_BASE64 || '' }}
```
Or split the PR build into an unsigned job with no `secrets.*` references.

### WR-07: "This workflow restores NO caches" is probably false: setup-msys2 caches by default

**File:** `.github/workflows/release.yml:6-9, 70-79`
**Issue:** As far as I know, `msys2/setup-msys2` has a `cache` input that defaults to `true` and restores the MSYS2 package cache. I didn't confirm this against v2.33.0's `action.yml`, so treat it as likely rather than certain. If so, the Windows release build restores a cache that `ci.yml` (same action, default caching) can write on `main`. pacman signature checks reduce the risk, but the header's guarantee doesn't hold and zizmor may not flag it.
**Fix:** Add `cache: false` to the `setup-msys2` step in `release.yml`. Better, confirm the default in the pinned commit's `action.yml` and record it in the comment.

### WR-08: Probe/rip guards key only on scan presence and skip the identity re-check before spawning

**File:** `app/main.js:307-333`
**Issue:** Separately from CR-01's identity problem, `pump()` never re-checks `sandboxTrusted() || scans.has(job.source)` before `start()`. A job enqueued before the 50-entry `scans` eviction, or before a future invalidation (the CR-01 fix), still runs. Any fix that only touches the IPC handlers will miss queued work.
**Fix:** Run the same identity and gate check from CR-01 at the top of `pump()`, and fail the job with "Scan the disc again" if it doesn't pass.

## Info

### IN-01: The Electron advisory step fails open on an `npm audit` error

**File:** `.github/workflows/ci.yml` (audit job, "Electron advisories")
**Issue:** `npm audit --json > audit.json || true` followed by `.vulnerabilities||{}` prints "No advisories affect electron." when npm returns `{"error":...}`. The next step (`--audit-level=high`) would probably fail anyway, but this step reports success it didn't earn.
**Fix:** `if (j.error || !j.vulnerabilities) { console.error('audit failed', j.error); process.exit(1) }`.

### IN-02: The static chokepoint test is easy to sidestep

**File:** `test/unit/gate-static.test.js:533-557`
**Issue:** It matches the exact text `spinarr.scan(` and `userConfirmed: true`. `userConfirmed:true`, `window.spinarr.scan(`, `spinarr['scan'](`, and `{ userConfirmed: !0 }` all get past it. That's acceptable for a tripwire, but it isn't a guarantee.
**Fix:** Use regexes that tolerate whitespace and bracket access (`/spinarr\s*(\.|\[\s*['"])scan/`, `/userConfirmed\s*:/`).

### IN-03: The `sec_gate_ipc` rip-refusal assertion doesn't check why it was refused

**File:** `test/e2e/scenarios.js` (`sec_gate_ipc`)
**Issue:** `spinarr.rip([{ source, title: 1 }])` asserts `ok === false` without checking the message. Any validation error would satisfy it.
**Fix:** `h.assert.match(r.e, /Scan the disc/)`. Do the same for the probe refusal.

### IN-04: `SPINARR_TEST_HOME` accepts relative paths

**File:** `app/main.js:35-44`
**Issue:** A relative value resolves against the cwd, which can scatter key and cache folders. This is dev-only and has no packaged-build impact.
**Fix:** `const TEST_HOME = !app.isPackaged && process.env.SPINARR_TEST_HOME && path.resolve(process.env.SPINARR_TEST_HOME);`

---

_Reviewed: 2026-10-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
