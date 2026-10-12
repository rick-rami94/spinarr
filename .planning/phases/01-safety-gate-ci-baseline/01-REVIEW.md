---
phase: 01-safety-gate-ci-baseline
reviewed: 2026-10-12T21:03:31Z
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
  critical: 1
  warning: 12
  info: 7
  total: 20
status: issues_found
---

# Phase 01: Code Review Report (re-review after round-2 gap closure 01-13 / 01-14)

**Reviewed:** 2026-10-12T21:03:31Z
**Depth:** standard (round-2 diff 4c8b077..HEAD, i.e. 6b7a285..13e4754, plus carry-forward of the prior review)
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Round 2 closes the specific holes the prior CR-01 listed. I checked the new walk against the vendored sources:

- **DVD.** `findDVDFile` looks in the root, then `<root>/VIDEO_TS/` (`AUDIO_TS` for DVD-A, `DVD_RTAV` for DVD-VR), then the lowercase spelling (`engine/deps/libdvdread-7.1.1/src/dvd_reader.c:959-1000`). It matches names with `strcasecmp` over `readdir`, which can never match a dot-name, `Thumbs.db` or `desktop.ini`. The flat walk of `['', VIDEO_TS, video_ts, AUDIO_TS, audio_ts, DVD_RTAV, dvd_rtav]` matches that. DVD coverage looks complete.
- **Blu-ray.** Every libbluray open goes through a path under `BDMV/`, `CERTIFICATE/`, `AACS/` (`disc/aacs.c:78`) or `BDSVM/` (`disc/bdplus.c:82`). That includes the AVCHD 8.3 names (`disc.c:428`). The only other root lookup is `disc.c:737`, which checks that `MAKEMKV/` exists and never reads it. Walking those four subtrees recursively is the right set.
- **The cap** now throws. `identityOf` turns the throw into `null`, so `scannedSame` drops the entry and `assertScanGate`, `pump` and `start` refuse. `scan()` passes `IDENTITY_TOO_MANY` through. That path is fail-closed.
- **sec_gate_inplace** really keeps the root inode fixed. It shows that a root-level IFO and a rewritten BACKUP playlist are refused, and that `.DS_Store` / AppleDouble files are not.

The new walk still has a fail-open branch, and I confirmed it end to end. When `readdir` fails on a directory, the walk writes a constant `<dir>|missing` line and moves on. libbluray doesn't need to list most directories. It opens `index.bdmv`, `*.clpi`, `*.m2ts`, `BACKUP/*`, `AACS/*` and `CERTIFICATE/*` by exact name, and that needs only search (x) permission. So if `BDMV` is traverse-only (mode `0311`), the whole Blu-ray fingerprint shrinks to `root|… BDMV|d|<ino> BDMV|missing`. Every file under BDMV can then be rewritten without changing the identity. The engine's `bdinfo` and `ffprobe bluray:` both still read that tree normally (CR-01).

Two smaller gaps:

- The dot-name exclusion is not sound for Blu-ray. libbluray builds `.clpi` / `.m2ts` names from 5 unvalidated bytes in the MPLS, so a playlist can point it at a dot-file (WR-08).
- The gate checks only at spawn time. The engine keeps opening files during the rip (WR-10).

SECURITY.md now claims "every file" and "no disc reader opens them" ([dot-files]). Both statements are false given the issues above (WR-11).

The renderer, the workflows and `run.js` did not change in this round. Every finding on them is carried forward unchanged.

### Status of prior findings (01-REVIEW.md, commit 0de0f3f)

| Prior ID | Title | Status |
|---|---|---|
| CR-01 | The identity misses the DVD root, BD BACKUP/AACS/CERTIFICATE, and the 5000-entry cap only counted entries | **RESOLVED** for what was reported: root IFOs, `video_ts`/`AUDIO_TS`/`DVD_RTAV`, `BDMV/**`, `AACS/**`, `CERTIFICATE/**` and `BDSVM/**` are all fingerprinted, and the cap throws. A **new bypass in the same walk** (directories that can't be listed) is the new **CR-01** |
| WR-01 | Consent comes from the renderer | **STILL OPEN**, carried as WR-01 |
| WR-02 | The prompt survives an eject on Windows/Linux | **STILL OPEN**, carried as WR-02 |
| WR-03 | A stale scan error overwrites the current state | **STILL OPEN**, carried as WR-03 |
| WR-04 | The CI sentinel never exercises libaacs | **STILL OPEN**, carried as WR-04 |
| WR-05 | The sentinel can be left in a real aacs folder | **STILL OPEN**, carried as WR-05 |
| WR-06 | Signing secrets exposed to PR builds | **STILL OPEN**, carried as WR-06 |
| WR-07 | setup-msys2 caches by default | **STILL OPEN**, carried as WR-07 |
| WR-08 | OS metadata causes spurious refusals; the renderer offers no rescan | **PARTIALLY RESOLVED**: dot-files and DVD `Thumbs.db`/`desktop.ini` are ignored. The renderer dead-end and Explorer's `Thumbs.db` in Blu-ray network folders remain, carried as WR-12 |
| WR-09 | With the sandbox trusted, stale scans are reused | **STILL OPEN** (`main.js:236-240` unchanged), carried as WR-09 |
| WR-10 | The swap e2e masks the per-file gap | **RESOLVED** for the masking: `sec_gate_inplace` keeps the root inode fixed. Still untested: the `start()` re-check after `prepareBluray`, and `revalidateScans`. Moved to IN-06 |
| IN-01 | The Electron advisory step fails open | STILL OPEN (IN-01) |
| IN-02 | The static chokepoint test is easy to sidestep | STILL OPEN (IN-02) |
| IN-03 | `SPINARR_TEST_HOME` accepts relative paths | STILL OPEN (IN-03) |
| IN-04 | The `scans` eviction ignores recency; the rescan wording is reused | STILL OPEN (IN-04) |
| IN-05 | SECURITY.md "An eject always clears the answer" | **RESOLVED**: now "normally clears", and it explains the Windows polling gap. The new SECURITY.md claims are inaccurate in other places; see WR-11 |

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: A directory that can't be listed is recorded as a constant, so every file under a traverse-only `BDMV/` (or `CLIPINF/`, `STREAM/`, `AACS/`, …) can change without changing the identity

**File:** `app/lib.js:274` (also `:266-267`)
**Issue:** `try { names = readdir(abs(rel)); } catch { lines.push(\`${rel}|missing\`); continue; }` treats "exists but can't be listed" the same as "doesn't exist", and records a line that never changes. On POSIX, listing a directory needs read (r) permission, but opening a file inside it by name needs only search (x). libbluray lists just three directories: `BDMV/PLAYLIST` (`navigation.c:405`), `BDMV/META/DL` and `BDMV/META/TN`. It opens everything else by exact name: `index.bdmv`, `MovieObject.bdmv`, `CLIPINF/<id>.clpi`, `STREAM/<id>.m2ts`, all of `BACKUP/`, `AACS/*` and `CERTIFICATE/*`. libaacs opens fixed names as well.

I verified this on a copy of `test/fixtures/out/bd_movie`:
```
chmod 0311 BDMV                       # traverse-only
identity A = mediumIdentity(bd)
append to BDMV/index.bdmv and BDMV/PLAYLIST/00000.mpls
identity B = mediumIdentity(bd)
A === B                               -> true
engine/bin/bdinfo <bd>                -> full title list (parses normally)
chmod 0311 BDMV BDMV/CLIPINF BDMV/STREAM
engine/bin/ffprobe -playlist 0 -i bluray:<bd>  -> video + 3 audio streams
```
With `BDMV` at `0311`, the identity of a Blu-ray folder contains only the root's dev/ino, `BDMV|d|<ino>`, `BDMV|missing` and the AACS/CERTIFICATE/BDSVM lines. `scan()`, `probe`, `enqueue`, `pump`, `prepareBluray` and `start` all accept arbitrary rewrites of every playlist, clip info, stream and index file. `revalidateScans` doesn't catch it either. This is the same "in-place change to a consented folder" scenario the last two rounds treated as a BLOCKER, and it needs the same precondition: write access to the folder plus control of its mode. Examples are a share owned by another account, or an extracted tarball or zip, since archives keep directory modes. It needs no race, it lasts indefinitely, and it contradicts SECURITY.md:40 ("it is everything under BDMV … A file added, removed or rewritten in any of them counts as a change"). On Windows, where the gate is always on, an ACL that grants Traverse without List Folder does the same thing.

The DVD side is not affected, because libdvdread's `findDirFile` itself uses `dir_open`/`dir_read`. `dvdinfo` therefore fails on a directory it can't list.

**Fix:** Fail closed when a directory that exists can't be listed. Keep `|missing` only for ENOENT/ENOTDIR on the optional top-level names:
```js
let names;
try { names = readdir(abs(rel)); }
catch (err) {
  if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) { lines.push(`${rel}|missing`); continue; }
  throw new Error('Source unreadable'); // EACCES/EPERM/EIO/ELOOP: can't fingerprint, so refuse
}
```
Apply the same rule to the recurse-mode top-level `stat` at line 266: an error other than ENOENT should throw. For symlink loops, give ELOOP/ENAMETOOLONG an explicit cap or depth limit so they don't depend on the throw. Add a unit test that sets `BDMV` (and separately `BDMV/CLIPINF`) to `0o311`, expects `mediumIdentity` to throw, and restores the mode in `finally`. Skip that test on win32 and when running as root.

## Warnings

### WR-01: Consent comes from the renderer, so a compromised renderer turns into unsandboxed native parsing (carried, STILL OPEN)

**File:** `app/main.js:483-489`, `app/lib.js` (`validateScanOptions` / `scanGate`)
**Issue:** Unchanged. `userConfirmed: true` is still a plain IPC argument. The identity binding limits what a consent covers, but it does nothing about who gives it.
**Fix:** When `!sandboxTrusted()`, ask in main with `dialog.showMessageBox(win, { type: 'warning', buttons: ['Scan anyway', 'Not now'], cancelId: 1, defaultId: 1 })`, and drop `userConfirmed` from the IPC contract.

### WR-02: The prompt survives an eject on Windows/Linux, so "Scan anyway" binds consent to a disc the user never saw (carried, STILL OPEN)

**File:** `app/renderer/app.js:759-764`, `app/renderer/app.js:430`
**Issue:** Unchanged. `sourceGone` still checks only `state.source?.startsWith('/Volumes/')`. A pending prompt for `D:\` outlives an eject. "Scan anyway" then scans whatever disc is in the drive at click time, and `scan()` records **that** disc's identity as consented.
**Fix:**
```js
const wasDrive = state.drives.discs.some((d) => d.path === state.source); // before state.drives = drives
const sourceGone = wasDrive && !drives.discs.some((d) => d.path === state.source);
```
Also show the volume label in the prompt.

### WR-03: A stale scan error overwrites the current source's state (carried, STILL OPEN)

**File:** `app/renderer/app.js:460-468`
**Issue:** Unchanged. Apart from `SANDBOX_OFF`, the `catch` sets `state.error` and clears `state.scanning` without checking `state.source !== src`.
**Fix:** Make `if (state.source !== src) return;` the first line of the `catch`.

### WR-04: The CI sentinel never exercises libaacs, so it proves nothing (carried, STILL OPEN)

**File:** `.github/workflows/ci.yml:37`, `test/e2e/scenarios.js` (`sec_hermetic_keydirs`)
**Issue:** Unchanged. No runner installs libaacs, so the KEYDB lookup never happens and the sentinel assertion passes vacuously.
**Fix:** Install libaacs on at least one runner and require the `found no KEYDB.cfg` branch whenever the sentinel is active. Otherwise, remove the sentinel.

### WR-05: The sentinel can be left in a real user's aacs folder (carried, STILL OPEN)

**File:** `test/e2e/run.js:55-93`
**Issue:** Unchanged. The only gate is `CI === 'true'`, and cleanup runs only on `process.on('exit')`, which SIGINT, SIGTERM and SIGKILL skip.
**Fix:** Require `GITHUB_ACTIONS === 'true' && SPINARR_E2E_SENTINEL === '1'`. Add signal handlers, and remove only a folder that `run.js` created.

### WR-06: Release signing secrets are exposed to PR-triggered builds (carried, STILL OPEN)

**File:** `.github/workflows/release.yml:15, 93-99`
**Issue:** Unchanged. `pull_request` runs the Package step with `MAC_CERT_P12_BASE64`, `WIN_CERT_PFX_BASE64`, the passwords and `APPLE_ID`, and there is no protected `environment:`.
**Fix:** Pass the secrets only on `refs/tags/v*`, behind a protected `release` environment. Or split the PR build into an unsigned job that has no `secrets.*` references.

### WR-07: "This workflow restores NO caches" is probably false: setup-msys2 caches by default (carried, STILL OPEN)

**File:** `.github/workflows/release.yml:8, 70-76`
**Issue:** Unchanged. The `msys2/setup-msys2` step has no `cache: false`.
**Fix:** Add `cache: false`, and record the pinned commit's default in the header comment.

### WR-08: The dot-name exclusion is not sound for Blu-ray, because libbluray builds clip file names from unvalidated MPLS bytes

**File:** `app/lib.js:239-250`, `SECURITY.md:41`
**Issue:** The comment says libbluray "opens fixed names elsewhere". That isn't true. `mpls_parse.c:464/517/571/611` reads `clip_id` with `bs_read_string(bits, clip_id, 5)` and never checks that it is digits. `navigation.c:652-661` then opens `"%s.clpi"` in `BDMV/CLIPINF` and `<id>.m2ts` in `BDMV/STREAM` (plus the BACKUP fallback). So a playlist can set `clip_id` to `._000` or `.x000`, which opens `BDMV/CLIPINF/._000.clpi`, a name `identityIgnored` skips. It can also set `../..`, which opens `BDMV/CLIPINF/../...clpi` = `BDMV/...clpi`, another dot-name. Adding or rewriting such a file leaves the identity unchanged (verified: `._000.clpi` and `BDMV/...clpi` added, identity same). Exploiting this needs the consented MPLS to already reference the dot-name, so the original content has to be crafted. That makes it narrower than CR-01, but it falsifies the documented guarantee.
**Fix:** For Blu-ray, ignore only names that no 5-character clip id can produce, for example `.DS_Store`, `.Spotlight-V100`, `.fseventsd`, `.Trashes`, and `._*` names longer than 10 characters. Better still, also add an engine patch that rejects a non-`[0-9]{5}` `clip_id` in `mpls_parse.c` (and the AVCHD equivalent). That also closes the `../` path construction. Update the comment and the SECURITY.md line to match.

### WR-09: With the sandbox trusted, a stale scan of a swapped disc or overwritten image is still used to build Blu-ray rips (carried, STILL OPEN)

**File:** `app/main.js:236-240, 258-261, 310-316`
**Issue:** Unchanged. `assertScanGate` returns before `scannedSame` when `sandboxTrusted()`. Without a volume event, an edited folder or overwritten ISO keeps its old `playlist`, `chapterDurations` and `duration`. The rip then uses the wrong playlist and chapters, and `ripVerdict` checks against the wrong duration.
**Fix:**
```js
function assertScanGate(src) {
  const had = scans.has(src);
  const fresh = had ? scannedSame(src) : null; // drop stale entries in every mode
  if (sandboxTrusted()) return;
  if (!had) throw new Error(lib.RESCAN_NOT_SCANNED);
  if (!fresh) throw new Error(lib.RESCAN_CHANGED);
}
```
Also make `probeStreams`/`enqueue` refuse when a Blu-ray entry was dropped, instead of falling through to the DVD path.

### WR-10: The same-disc check runs only at spawn, but the unsandboxed engine keeps opening files for the whole rip

**File:** `app/main.js:391-400`, `SECURITY.md:40, 44`
**Issue:** `start()` checks the identity "immediately before spawn". After that, ffmpeg reads for minutes, often tens of minutes for a Blu-ray. libbluray opens each clip's `.clpi`/`.m2ts` lazily as playback crosses clip boundaries, and the DVD demuxer reads each `VTS_xx_N.VOB` as it reaches it. Anyone with the write access CR-01 assumes can therefore rewrite a later clip or VOB after the check, and the unsandboxed parser reads the new bytes. Nothing re-checks during or after the rip. SECURITY.md:40 ("A file added, removed or rewritten in any of them counts as a change") and :44 ("before every probe or rip, Spinarr also checks …") suggest protection the code can't give.
**Fix:** The gate can't close this, because only the sandbox (SAFE-11) can. Disclose it: "The check runs before the engine starts; a file changed while a rip is running is not detected." As cheap defense in depth, compute `identityOf(job.source)` again in the `close` handler and fail the job with `RESCAN_CHANGED` if it differs. That stops a tampered output from being reported as a verified rip.

### WR-11: SECURITY.md's new coverage claims are inaccurate

**File:** `SECURITY.md:40-41, 44`
**Issue:**
- Line 40: "Spinarr checks every file the disc readers can open … everything under BDMV". It does not when a directory can't be listed (CR-01).
- Line 41: "Hidden system files such as .DS_Store and ._ files are ignored … No disc reader opens them." libbluray can open a dot-named `.clpi`/`.m2ts` that an MPLS names (WR-08).
- Line 44: "A disc folder with more than 20,000 files cannot be checked". The cap counts only entries in the walked directories, not every file in the folder. On case-insensitive volumes (macOS default, Windows), each DVD directory is walked twice (`VIDEO_TS` and `video_ts` resolve to the same directory), so a DVD hits the cap at about 10,000 entries. The cap also applies when the sandbox is trusted (`scan()` always computes `before`), although this paragraph describes the sandbox-off mode only.
- The doc says nothing about the spawn-time-only window (WR-10).

**Fix:** After CR-01 and WR-08 are fixed, reword. For example: "…checks the size, file ID and modification time of every file in the folders the disc readers use; a folder it can't fully read is refused." Drop "No disc reader opens them", or limit it to DVD. Say "more than 20,000 entries in the disc's folders". Add the WR-10 disclosure.

### WR-12: Refusals still dead-end in the UI, and Explorer's Thumbs.db in Blu-ray network folders still causes them (residual of prior WR-08)

**File:** `app/renderer/app.js:474-487, 557-559`, `app/lib.js:244-249`
**Issue:** The renderer still doesn't handle "Scan the disc again": probe errors go into the track detail, rip refusals become a toast, and `state.disc` keeps showing the stale scan. Separately, `Thumbs.db`/`desktop.ini` stay fingerprinted throughout the Blu-ray tree. The comment's reason, that libbluray parses every PLAYLIST entry, applies only to `BDMV/PLAYLIST`. Windows Explorer writes `Thumbs.db` into network-share folders by default, for example `BDMV/STREAM` on a NAS, which is the typical Plex/Jellyfin setup. That edit refuses a queued rip, and the user has no way out.
**Fix:** Ignore `Thumbs.db`/`ehthumbs.db`/`desktop.ini` in every Blu-ray directory except `BDMV/PLAYLIST`. libbluray opens `CLIPINF`/`STREAM`/`BACKUP`/`AACS`/`CERTIFICATE` entries only by 5-digit-derived or fixed names, so those names can't be reached once WR-08's `clip_id` validation is in place. In the renderer, when a probe or rip error starts with `Scan the disc again` and `src === state.source`, clear `state.disc` and call `requestScan(src)`.

## Info

### IN-01: The Electron advisory step fails open on an `npm audit` error (carried, STILL OPEN)

**File:** `.github/workflows/ci.yml:248-249`
**Fix:** `if (j.error || !j.vulnerabilities) process.exit(1)`.

### IN-02: The static chokepoint test is easy to sidestep (carried, STILL OPEN)

**File:** `test/unit/gate-static.test.js`
**Fix:** Use whitespace- and bracket-tolerant regexes (`/spinarr\s*(\.|\[\s*['"])scan/`, `/userConfirmed\s*:/`).

### IN-03: `SPINARR_TEST_HOME` accepts relative paths (carried, STILL OPEN)

**File:** `app/main.js:35`
**Fix:** `path.resolve(process.env.SPINARR_TEST_HOME)`. This is dev-only.

### IN-04: The `scans` eviction ignores recency, and the rescan wording is reused for unrelated errors (carried, STILL OPEN)

**File:** `app/main.js:219-220, 248-252`, `app/lib.js:296`
**Fix:** `scans.delete(source)` before `scans.set(...)`. Use a distinct `'Unknown title'` error in `scannedTitle`. Reword `RESCAN_NOT_SCANNED` to "Scan the disc first …", and keep the `Scan the disc` prefix.

### IN-05: The identity walk is synchronous in the main process and follows symlinks out of the disc

**File:** `app/lib.js:252-293`, `app/main.js:193, 198, 212`
**Issue:** It runs up to 20,000 synchronous `stat`/`readdir` calls on the Electron main thread, at each of up to six points (scan before and after, probe, enqueue, pump, prepareBluray, start, plus `revalidateScans` for every cached source on each volume event). `stat` follows symlinks, so `BDMV/x -> /` or a link to a stalled NFS/SMB mount freezes the UI. The freeze lasts until the cap is reached, or forever if the mount hangs. It fails closed, but the app becomes unresponsive. The cap also refuses scans when the sandbox is trusted, where no identity is needed.
**Fix:** Use `lstat` for entries inside the walk, and record a symlink as `l|<readlink target>` instead of following it. Or refuse symlinks that point outside the source. Skip `mediumIdentity` in `scan()` when `sandboxTrusted()`, or catch `IDENTITY_TOO_MANY` there.

### IN-06: Gate coverage gaps in the tests (residual of prior WR-10)

**File:** `test/e2e/scenarios.js:371-434`, `test/unit/lib.test.js:480-611`
**Issue:**
- No test covers an unlistable directory (CR-01), a dot-named clip (WR-08), the `start()` refusal after the async `prepareBluray` gap, or `revalidateScans`.
- Every in-place edit in `sec_gate_inplace` appends a byte, so only the size change is ever exercised end to end.
**Fix:** Add a unit test for CR-01 (expect a throw). Add a test that stubs `identityOf` to change between `pump()` and `start()`. Add one same-size, new-mtime edit to the e2e scenario.

### IN-07: Cap and error-message rough edges

**File:** `app/lib.js:235, 277`, `app/main.js:192-194, 239`
**Issue:**
- On case-insensitive file systems, `VIDEO_TS`/`video_ts`, `AUDIO_TS`/`audio_ts` and `DVD_RTAV`/`dvd_rtav` each list the same directory twice, which doubles the hash input and the cap count.
- `identityOf` swallows `IDENTITY_TOO_MANY`, so probe and rip report "It was removed or changed since it was scanned". The user only gets the real reason after rescanning.

**Fix:** Skip a directory whose `dev|ino` was already walked. That also deduplicates symlink loops. Have `assertScanGate` pass `IDENTITY_TOO_MANY` through when it is the cause.

---

_Reviewed: 2026-10-12T21:03:31Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
