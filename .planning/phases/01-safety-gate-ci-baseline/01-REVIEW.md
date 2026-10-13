---
phase: 01-safety-gate-ci-baseline
reviewed: 2026-10-12T21:47:19Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - .github/dependabot.yml
  - .github/ISSUE_TEMPLATE/config.yml
  - .github/requirements-audit.txt
  - .github/requirements-build.txt
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - app/lib.js
  - app/main.js
  - app/platform.js
  - app/preload.js
  - app/renderer/app.js
  - app/renderer/styles.css
  - docs/ENCRYPTED_DISCS.md
  - docs/SECURITY_TESTING.md
  - test/e2e/harness.js
  - test/e2e/run.js
  - test/e2e/scenarios.js
  - test/unit/gate-static.test.js
  - test/unit/lib.test.js
  - test/unit/neutrality.test.js
  - test/unit/platform.test.js
  - SECURITY.md
findings:
  critical: 0
  warning: 10
  info: 9
  total: 19
status: issues_found
---

# Phase 01: Code Review Report (re-review after round-3 gap closure 01-15)

**Reviewed:** 2026-10-12T21:47:19Z
**Depth:** standard. The round-3 diff is b767aa1..HEAD (code commits 7e5101c..cc5c35d). Findings from the prior review are carried forward.
**Files Reviewed:** 22
**Status:** issues_found (no Critical issues)

## Summary

Round 3 closes the prior CR-01. I traced every error path in `mediumIdentity` (`app/lib.js:262-307`):

| Error path | Behaviour now | Verdict |
|---|---|---|
| Root `stat` (`big(source)`) | Any error throws. `scan()` maps it to "Source not found". `assertScanGate` maps it to `RESCAN_CHANGED`. | Fail-closed |
| `sourceKind` probe (swallows all errors) | A `BDMV` that can't be stat'ed falls back to `dvd`, or to "Source changed" (a throw). The engine path in `scan()` uses the same `sourceKind`, so the DVD engine never reads `BDMV`. The DVD root walk also stats the `BDMV` entry, and that stat throws for any non-absent error. | Fail-closed |
| Blu-ray top-folder `stat` (`:276-278`) | ENOENT/ENOTDIR record `|missing`. Anything else throws `IDENTITY_UNREADABLE`. | Fail-closed |
| `readdir` (`:286-290`) | Same rule. Covers EACCES, EPERM, EIO, ELOOP and errors with no code. | Fail-closed |
| Per-entry `stat` (`:296-300`) | Same rule. ENOENT/ENOTDIR record `|gone`. | Fail-closed |
| Symlink loops | `stat` follows links. The path grows until ELOOP or ENAMETOOLONG (both throw), or the cap is hit (throws). | Fail-closed |
| Codeless errors | `absentCode` returns false, so they throw. | Fail-closed |

ENOENT and ENOTDIR are the only "absent" codes. In every place they occur, the engine cannot open that path either: a dangling link, a file where a folder should be, or a race with deletion.

I also looked for a different kind of way around the gate and found none:

- **IPC paths.** Only `probe` (`main.js:500-504`) and `rip`→`enqueue` (`:316-319`) reach the engine with a source. Both call `assertScanGate`. `pump` (`:357`), `prepareBluray` (`:381`) and `start` (`:395`) re-check. The post-rip `ffprobe` reads only the output file. `scan` is gated by `scanGate`.
- **Path aliases.** Different spellings of a source (symlink, letter case) get separate keys in `scans`, so they fail closed.
- **The before/after window in `scan()`.** Someone could swap a file and then rename the original back during a scan. The original inode, size and mtime return, so `after === before`. But the engine parsed that content during a scan the user consented to, so this is the "changed after it starts" residual (a). It is not a new kind of bypass.

`sec_gate_unlistable` really does exercise the case where `BDMV` is traverse-only *before* the scan. With the old walk, `bdinfo` reads `BDMV/PLAYLIST` by path, so the scan would succeed and the `state.disc === null` assertion would fail. The SUMMARY's RED run confirms this. The unit tests run real `chmod 0o311` on `BDMV` and on `BDMV/PLAYLIST`, plus injected errors on every catch site. `node --test test/unit/lib.test.js` gives 56/56 (re-run during this review).

The SECURITY.md "Known limit" block describes the three accepted residuals accurately. One sentence assigns the remaining protection to Windows / SF-1 only. That leaves out Linux without bubblewrap, and it leaves out the fact that the new unreadable-folder refusal also applies when the sandbox is on (WR-11 residual).

The renderer, the workflows, `run.js` and `platform.js` did not change. Every finding on them is carried forward unchanged.

### Accepted residuals (locked user decision; assigned to SF-1 / SAFE-05, Phase 4)

| Residual | Documented at | Documentation accurate? |
|---|---|---|
| (a) Lazy re-reads by the unsandboxed engine after the spawn-time check (prior WR-10) | SECURITY.md "Known limit" bullet 1; `lib.js:212-215` | **Yes.** "The check runs before each probe or rip starts … a file changed after it starts is read as changed" matches `start()` (`main.js:395`), which is the last check. FIFOs and swap-then-restore by rename also fall into this class (IN-10). |
| (b) A crafted playlist `clip_id` naming files the fingerprint skips (prior WR-08) | SECURITY.md bullet 2; `lib.js:251-253` | **Yes.** `mpls_parse.c:464/517/571/611` → `navigation.c:656/661`. A 5-byte id can reach only dot-names inside `BDMV/` (for example `../..` → `BDMV/...clpi`), and "hidden dot-names" covers those. The other attacker-named opens (`navigation.c:1122` font ids, `bdjo_get`) are reached only with an overlay or BD-J, which ffmpeg/bdinfo don't register. |
| (c) A same-size rewrite with timestamps restored | SECURITY.md bullet 3 | **Yes.** |

### Status of prior findings (01-REVIEW.md, commit f30d9ab)

| Prior ID | Title | Status |
|---|---|---|
| CR-01 | A directory that can't be listed was recorded as a constant `|missing` | **RESOLVED.** Only ENOENT/ENOTDIR are treated as absent, at all three catch sites. Unit tests cover real chmod and injected errors, and the e2e covers the traverse-only-before-scan case. |
| WR-01 | Consent comes from the renderer | **STILL OPEN** (carried) |
| WR-02 | The prompt survives an eject on Windows/Linux | **STILL OPEN** (carried) |
| WR-03 | A stale scan error overwrites the current state | **STILL OPEN** (carried) |
| WR-04 | The CI sentinel never exercises libaacs | **STILL OPEN** (carried) |
| WR-05 | The sentinel can be left in a real aacs folder | **STILL OPEN** (carried) |
| WR-06 | Signing secrets exposed to PR builds | **STILL OPEN** (carried) |
| WR-07 | setup-msys2 caches by default | **STILL OPEN** (carried) |
| WR-08 | The dot-name exclusion is unsound for Blu-ray clip ids | **ACCEPTED** as residual (b). Documented accurately in SECURITY.md and in the `lib.js` comment. |
| WR-09 | With the sandbox trusted, stale scans are reused | **STILL OPEN** (carried; `main.js:240` still returns first) |
| WR-10 | The check runs only at spawn while the engine keeps reading | **ACCEPTED** as residual (a). The disclosure is now in SECURITY.md. The optional close-handler re-check was not adopted, which is acceptable under the decision. |
| WR-11 | SECURITY.md coverage claims were inaccurate | **MOSTLY RESOLVED.** "everything under BDMV", "No disc reader opens them" and "more than 20,000 files" are gone. The cap, case-folding and sandbox-on wording are now correct, and the WR-10 disclosure was added. A small residual remains (see WR-11 below). |
| WR-12 | Refusals dead-end in the UI; Thumbs.db in Blu-ray network folders | **STILL OPEN** (carried) |
| IN-01 | The Electron advisory step fails open | STILL OPEN |
| IN-02 | The static chokepoint test is easy to sidestep | STILL OPEN |
| IN-03 | `SPINARR_TEST_HOME` accepts relative paths | STILL OPEN |
| IN-04 | The `scans` eviction ignores recency; the rescan wording is reused | STILL OPEN (extended, see below) |
| IN-05 | The identity walk is synchronous and follows symlinks; the cap applies when trusted | STILL OPEN (extended: the unreadable refusal also applies when trusted) |
| IN-06 | Gaps in gate test coverage | **PARTIALLY RESOLVED.** CR-01 tests were added. The `start()`-after-`prepareBluray` refusal, `revalidateScans` and a same-size e2e edit are still untested. |
| IN-07 | Rough edges in the cap and the error messages | **RESOLVED.** `assertScanGate` passes `IDENTITY_TOO_MANY` / `IDENTITY_UNREADABLE` through via `identityRefusal`, and `scan()` passes both through. The doubled walk on case-insensitive volumes is now disclosed in SECURITY.md (accepted). New wording issues are tracked as IN-08. |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Consent comes from the renderer, so a compromised renderer turns into unsandboxed native parsing (carried, STILL OPEN)

**File:** `app/main.js:492-498`, `app/lib.js` (`validateScanOptions` / `scanGate`)
**Issue:** Unchanged. `userConfirmed: true` is still a plain IPC argument. The identity binding limits what a consent covers, but it does nothing about who gives it.
**Fix:** When `!sandboxTrusted()`, ask in main with `dialog.showMessageBox(win, { type: 'warning', buttons: ['Scan anyway', 'Not now'], cancelId: 1, defaultId: 1 })`, and drop `userConfirmed` from the IPC contract.

### WR-02: The prompt survives an eject on Windows/Linux, so "Scan anyway" binds consent to a disc the user never saw (carried, STILL OPEN)

**File:** `app/renderer/app.js:759-764`, `app/renderer/app.js:430`
**Issue:** Unchanged. `sourceGone` still checks only `state.source?.startsWith('/Volumes/')`. A pending prompt for `D:\` outlives an eject. "Scan anyway" then scans whatever disc is in the drive at click time, and `scan()` records that disc's identity as consented.
**Fix:**
```js
const wasDrive = state.drives.discs.some((d) => d.path === state.source); // before state.drives = drives
const sourceGone = wasDrive && !drives.discs.some((d) => d.path === state.source);
```
Also show the volume label in the prompt.

### WR-03: A stale scan error overwrites the current source's state (carried, STILL OPEN)

**File:** `app/renderer/app.js:460-468`
**Issue:** Unchanged. Apart from `SANDBOX_OFF`, the `catch` sets `state.error` and clears `state.scanning` without checking `state.source !== src`. This matters more now: a slow `IDENTITY_UNREADABLE` or `IDENTITY_TOO_MANY` refusal for a disc the user has already left overwrites the error state of the disc they moved to.
**Fix:** Make `if (state.source !== src) return;` the first line of the `catch`.

### WR-04: The CI sentinel never exercises libaacs, so it proves nothing (carried, STILL OPEN)

**File:** `.github/workflows/ci.yml:37`, `test/e2e/scenarios.js` (`sec_hermetic_keydirs`)
**Issue:** Unchanged. No runner installs libaacs, so the KEYDB lookup never happens and the sentinel assertion passes vacuously.
**Fix:** Install libaacs on at least one runner and require the `found no KEYDB.cfg` branch whenever the sentinel is active. Otherwise, remove the sentinel.

### WR-05: The sentinel can be left in a real user's aacs folder (carried, STILL OPEN)

**File:** `test/e2e/run.js:55-93`
**Issue:** Unchanged. The only gate is `CI === 'true'` (`:58`), and cleanup runs only on `process.on('exit')` (`:93`), which SIGINT, SIGTERM and SIGKILL skip.
**Fix:** Require `GITHUB_ACTIONS === 'true' && SPINARR_E2E_SENTINEL === '1'`. Add signal handlers, and remove only a folder that `run.js` created.

### WR-06: Release signing secrets are exposed to PR-triggered builds (carried, STILL OPEN)

**File:** `.github/workflows/release.yml:15, 93-99`
**Issue:** Unchanged. `pull_request` runs the Package step with `MAC_CERT_P12_BASE64`, `WIN_CERT_PFX_BASE64`, the passwords and `APPLE_ID`, and there is no protected `environment:`.
**Fix:** Pass the secrets only on `refs/tags/v*`, behind a protected `release` environment. Or split the PR build into an unsigned job that has no `secrets.*` references.

### WR-07: "This workflow restores NO caches" is probably false: setup-msys2 caches by default (carried, STILL OPEN)

**File:** `.github/workflows/release.yml:8, 70-76`
**Issue:** Unchanged. The `msys2/setup-msys2` step (`:70`) has no `cache: false`.
**Fix:** Add `cache: false`, and record the pinned commit's default in the header comment.

### WR-09: With the sandbox trusted, a stale scan of a swapped disc or overwritten image is still used to build Blu-ray rips (carried, STILL OPEN)

**File:** `app/main.js:239-249, 316-327`
**Issue:** Unchanged. `assertScanGate` still returns before any identity check when `sandboxTrusted()` (`:240`). Without a volume event, an edited folder or overwritten ISO keeps its old `playlist`, `chapterDurations` and `duration`. The rip then uses the wrong playlist and chapters, and `ripVerdict` checks against the wrong duration.
**Fix:**
```js
function assertScanGate(src) {
  const entry = scans.get(src);
  let now = null, failure = null;
  if (entry) { try { now = lib.mediumIdentity(src); } catch (e) { failure = e; } }
  if (entry && now !== entry.identity) scans.delete(src); // drop stale entries in every mode
  if (sandboxTrusted()) return;
  if (!entry) throw new Error(lib.RESCAN_NOT_SCANNED);
  if (now !== entry.identity) throw new Error(lib.identityRefusal(failure));
}
```
Also make `probeStreams`/`enqueue` refuse when a Blu-ray entry was dropped, instead of falling through to the DVD path.

### WR-11: SECURITY.md assigns the residual to Windows/SF-1 only, and doesn't say the unreadable-folder refusal applies with the sandbox on (residual of prior WR-11)

**File:** `SECURITY.md:48` (the "Full protection … Windows has none today. That work is tracked as SF-1." line) and `SECURITY.md:44`
**Issue:**
- The Known-limit block ends with "Full protection comes from the engine sandbox on every OS. Windows has none today. That work is tracked as SF-1." But the same doc says, a few paragraphs up, that Linux without bubblewrap also runs the engine unsandboxed and goes through this same best-effort gate. ROADMAP.md:129 also says "The Windows sandbox (SAFE-05, SF-1) **and the Linux no-bwrap path** must remove it". SAFE-03/SF-7 is the Linux work item. A Linux user who reads only this block would conclude they are fully protected.
- `SECURITY.md:44` says the cap "also runs when the sandbox is on". That is true, and the new `IDENTITY_UNREADABLE` refusal behaves the same way: `scan()` always computes `before` (`main.js:197-201`), even when trusted. So on macOS with the sandbox on, a disc folder containing any folder that can't be listed, or an entry that can't be stat'ed, is now refused at scan. Before 01-15 it scanned. That is the safe direction, but it is an undisclosed behaviour change for the default macOS install, where the identity isn't needed.
**Fix:** Change the last line to: "Full protection comes from the engine sandbox. Windows has none today (SF-1), and Linux without bubblewrap has none either (SF-7)." In the limit paragraph, extend "This check also runs when the sandbox is on" to cover unreadable folders. Alternatively, and preferably, skip or soften `mediumIdentity` in `scan()` when `sandboxTrusted()` (see IN-05) and say so.

### WR-12: Refusals still dead-end in the UI, and Explorer's Thumbs.db in Blu-ray network folders still causes them (carried, STILL OPEN)

**File:** `app/renderer/app.js:474-487, 557-559`, `app/lib.js:256-261`
**Issue:** Unchanged. The renderer still doesn't handle "Scan the disc again". Probe errors go into the track detail, rip refusals become a toast, and `state.disc` keeps showing the stale scan. `Thumbs.db`/`desktop.ini` stay fingerprinted throughout the Blu-ray tree, so Explorer writing `Thumbs.db` into `BDMV/STREAM` on a NAS refuses a queued rip, and the user has no way out. The new `identityRefusal` reasons make this more visible: the user now sees "can't read every folder", but has no action to take from the UI.
**Fix:** Ignore `Thumbs.db`/`ehthumbs.db`/`desktop.ini` in every Blu-ray directory except `BDMV/PLAYLIST`. In the renderer, when a probe or rip error starts with `Scan the disc again` and `src === state.source`, clear `state.disc` and call `requestScan(src)`. Don't auto-rescan for the `IDENTITY_UNREADABLE`/`IDENTITY_TOO_MANY` reasons (see IN-08), because those repeat deterministically.

## Info

### IN-01: The Electron advisory step fails open on an `npm audit` error (carried, STILL OPEN)

**File:** `.github/workflows/ci.yml:249`
**Fix:** `if (j.error || !j.vulnerabilities) process.exit(1)`.

### IN-02: The static chokepoint test is easy to sidestep (carried, STILL OPEN)

**File:** `test/unit/gate-static.test.js`
**Fix:** Use whitespace- and bracket-tolerant regexes (`/spinarr\s*(\.|\[\s*['"])scan/`, `/userConfirmed\s*:/`).

### IN-03: `SPINARR_TEST_HOME` accepts relative paths (carried, STILL OPEN)

**File:** `app/main.js:35`
**Fix:** `path.resolve(process.env.SPINARR_TEST_HOME)`. This is dev-only.

### IN-04: The `scans` eviction ignores recency, the rescan wording is reused, and volume-event drops lose the reason (carried, extended)

**File:** `app/main.js:222-223, 232-237, 253-255, 260`
**Issue:**
- Unchanged: eviction is FIFO, and `scannedTitle` throws `RESCAN_NOT_SCANNED` ("…before ripping") for an unknown title and for probes too.
- New: `revalidateScans` → `scannedSame` → `identityOf` still swallows the walk error. If a volume event fires while a folder is unreadable, the entry is dropped silently, and the next probe or rip says "Scan the disc again before ripping" instead of the `identityRefusal` reason that `assertScanGate` now gives.
**Fix:** `scans.delete(source)` before `scans.set(...)`. Use a distinct `'Unknown title'` error. In `scannedSame`, store the failure reason on a small `droppedReason` map that `assertScanGate` consults when `!scans.has(src)`.

### IN-05: The identity walk is synchronous in the main process, follows symlinks out of the disc, and refuses scans even when the sandbox is trusted (carried, extended)

**File:** `app/lib.js:262-307`, `app/main.js:196-201`
**Issue:** Unchanged: up to 20,000 synchronous `stat`/`readdir` calls run on the Electron main thread at every check point, and `stat` follows links into slow or stalled mounts. Extended: `scan()` now also refuses on `IDENTITY_UNREADABLE` when `sandboxTrusted()`, where the identity is never used (`assertScanGate` returns first). For DVD folders this is broader than it looks. The root is walked flat and *every* root entry is stat'ed, including ones libdvdread never opens, such as a symlink loop or a link into a stalled or unreadable mount next to `VIDEO_TS`.
**Fix:** In `scan()`, when `sandboxTrusted()`, catch `IDENTITY_TOO_MANY`/`IDENTITY_UNREADABLE` and store `identity: null`. A later move to untrusted still refuses, because `null` never matches a fresh identity. Long term, use `lstat` inside the walk and record links as `l|<target>`.

### IN-06: Gaps in gate test coverage (residual of prior IN-06)

**File:** `test/e2e/scenarios.js:371-494`, `test/unit/lib.test.js:612-723`
**Issue:** The CR-01 tests are good. Still untested: the `start()` refusal after the async `prepareBluray` gap, `revalidateScans`, and a same-size edit with a new mtime end to end (every e2e edit appends a byte). There is also no unit test that `scan()`/`assertScanGate` (main.js) map the reasons. That is covered only by the e2e.
**Fix:** Stub `lib.mediumIdentity` to change between `pump()` and `start()`. Add one same-size `fs.writeSync` at offset 0 in `sec_gate_inplace`.

### IN-08: The refusal wording is misleading for deterministic failures, and the reason loses all detail

**File:** `app/lib.js:229-231, 321-326`, `app/lib.js:218-221`
**Issue:**
- `identityRefusal` prefixes `IDENTITY_UNREADABLE`/`IDENTITY_TOO_MANY` with "Scan the disc again". A rescan fails again with the same error unless the user fixes permissions or trims the folder, so the advice is wrong. It also invites an auto-rescan loop if WR-12's renderer fix is implemented naively. The prefix exists only because the renderer and e2e match on it.
- `IDENTITY_UNREADABLE` says "can't read every **folder**", but it is also thrown for a per-entry `stat` failure on a file (EIO, ELOOP on a file link). Neither the code nor the path is kept, so neither a user nor a bug report can find which entry failed.
- Stale comment: `lib.js:220` says "main.js identityOf turns a throw into null". `assertScanGate` no longer uses `identityOf`; it calls `mediumIdentity` directly (`main.js:244`).
**Fix:** Keep the rescan prefix for `RESCAN_CHANGED` only, and use a distinct prefix such as "Spinarr can't check this disc:" for the two walk refusals, matched separately. Throw `Object.assign(new Error(IDENTITY_UNREADABLE), { code: err && err.code, rel: relName })`, and log `code`/`rel` in main without sending the path to the renderer. Change "folder" to "folder or file". Update the comment.

### IN-09: `sec_gate_unlistable` can flake on a volume event, and its last probe assertion is vacuous

**File:** `test/e2e/scenarios.js:458-474, 486-489`
**Issue:**
- The rip-first ordering relies on nothing dropping the scan entry between `chmod` and `rip`. On macOS, any `/Volumes` change (debounced 800 ms, `platform.js:251`) triggers `revalidateScans`, and on Linux any mountinfo change does too. Either one drops the entry silently (IN-04), and the rip then fails with "Scan the disc again before ripping". The `/can't read every folder/` assertion then fails. A leftover image unmount from an earlier scenario is enough.
- `probe2` on `BD2` is refused simply because `BD2` was never scanned (`RESCAN_NOT_SCANNED`). If the fix regressed, the earlier `state.disc === null` assertion would fail first, so `probe2` adds no coverage.
**Fix:** Call the rip immediately after the `chmod`, or assert the reason via a direct identity check in main through the test hook. Either drop `probe2` or assert specifically that `state.error` mentions the reason and that no `scans` entry exists.

### IN-10: Non-regular entries (FIFOs, device nodes, sockets) are fingerprinted as ordinary files

**File:** `app/lib.js:301-306`
**Issue:** Any non-directory gets `f|ino|size|mtime`. A named pipe at `BDMV/STREAM/00000.m2ts`, or a link to `/dev/urandom` or a stalled device, passes the walk. A FIFO hands the engine live bytes that never exist on disk. I verified that a FIFO's mtime moves after a write on macOS, so the identity changes, but only *after* the engine has read the data. Because the data arrives after the engine opens the file, this is residual (a) in practice, not a new kind of bypass. Still, no real disc folder contains a FIFO or device node, and refusing them costs one line. The same check is a natural place to refuse the "swap then rename the original back" pattern during a scan, by also storing the root directory's ctime, though that can wait for SF-1.
**Fix:**
```js
if (e.isDirectory()) { … } else if (e.isFile()) { lines.push(`${relName}|f|…`); }
else throw new Error(IDENTITY_UNREADABLE); // FIFO/socket/device: never part of a disc
```

---

_Reviewed: 2026-10-12T21:47:19Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
