---
phase: 01-safety-gate-ci-baseline
reviewed: 2026-10-12T12:06:21Z
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
  warning: 10
  info: 5
  total: 16
status: issues_found
---

# Phase 01: Code Review Report (re-review after gap closure 01-11 / 01-12)

**Reviewed:** 2026-10-12T12:06:21Z
**Depth:** standard (gap-closure diff 37f1ea7..HEAD, plus carry-forward of the prior review)
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Gap closure 01-11/01-12 is a real improvement. Consent is no longer keyed only by path. `assertScanGate` runs at every engine spawn point I could find: `probe`, `enqueue`, the top of `pump()`, `prepareBluray`, and `start()` immediately before `spawn`. `scan()` brackets the scanner run with a before/after identity check. The error paths fail closed: a missing or changed identity drops the `scans` entry and refuses. I found no unsandboxed engine spawn that skips the gate. The post-rip `ffprobe` only reads the output file, which came from an already-gated rip.

The new gate's weak point is `lib.mediumIdentity` itself. It fingerprints only some of the files the parsers actually read:

- libdvdread searches the source **root** for `*.IFO` / `*.VOB` before it looks in `VIDEO_TS/` (`dvd_reader.c:974`, case-insensitive). The identity records only the root's `dev|ino`.
- For Blu-ray, `BDMV/BACKUP/**`, `AACS/` and `CERTIFICATE/` are never fingerprinted. libbluray and libaacs parse all three.
- Entries past the 5000 cap are counted but never stat'd.

I checked this with `node`. Adding `vts_01_0.ifo` to a consented folder's root, or rewriting `BDMV/BACKUP/PLAYLIST/00000.mpls` and `AACS/Unit_Key_RO.inf`, leaves the identity byte-for-byte unchanged. So the folder variant of the prior CR-01 "contents changed at the same path" scenario still gets past the gate unsandboxed. That contradicts the new SECURITY.md text, so I rate it a BLOCKER (CR-01 below).

The renderer, workflows and e2e runner did not change in this gap closure. Every prior renderer, CI and sentinel finding is therefore still open and carried forward. I also added three new warnings on the new code: the identity changes on harmless edits, stale scans are reused when the sandbox is on, and the swap e2e passes for the wrong reason.

### Status of prior findings (01-REVIEW.md of 2026-10-11)

| Prior ID | Title | Status |
|---|---|---|
| CR-01 | Probe/rip consent tied to a path, not a disc | **RESOLVED** for what was reported: drive-letter reuse, queued jobs, overwritten images, and renderer callers on a changed path are all refused now. A **residual bypass** remains through files the identity doesn't cover; it is tracked as new **CR-01** |
| WR-01 | Consent comes from the renderer (`userConfirmed` over IPC) | **STILL OPEN**, carried as WR-01 |
| WR-02 | Prompt not cleared when a non-`/Volumes/` source disappears; Windows prompt names the drive, not the disc | **STILL OPEN**, carried as WR-02 (now the main path-keyed residue: consent is captured for whatever is at the path at click time) |
| WR-03 | A stale scan error overwrites the current source's state | **STILL OPEN**, carried as WR-03 |
| WR-04 | The CI sentinel never exercises libaacs | **STILL OPEN**, carried as WR-04 |
| WR-05 | The sentinel can be left in a real aacs folder (signals, `CI=true`) | **STILL OPEN**, carried as WR-05 |
| WR-06 | Signing secrets exposed to PR-triggered release builds | **STILL OPEN**, carried as WR-06 |
| WR-07 | `setup-msys2` caches by default despite the "NO caches" claim | **STILL OPEN**, carried as WR-07 |
| WR-08 | `pump()` doesn't re-gate before spawning | **RESOLVED**: gated in `pump()` (main.js:350), `prepareBluray` (373) and `start()` (391) |
| IN-01 | The Electron advisory step fails open | STILL OPEN (IN-01) |
| IN-02 | The static chokepoint test is easy to sidestep | STILL OPEN (IN-02) |
| IN-03 | The `sec_gate_ipc` refusal doesn't check why | **RESOLVED**: it now matches `/Scan the disc again/` |
| IN-04 | `SPINARR_TEST_HOME` accepts relative paths | STILL OPEN (IN-03) |

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The medium identity skips files the parsers read, so in-place changes to a consented folder are still parsed unsandboxed

**File:** `app/lib.js:213-239` (used by `app/main.js:192-246`), `SECURITY.md:39-42`
**Issue:** `mediumIdentity` for a folder hashes `root|dev|ino` plus one listing per directory in `IDENTITY_DIRS`: `VIDEO_TS` for DVD, and `BDMV`, `BDMV/PLAYLIST`, `BDMV/CLIPINF`, `BDMV/STREAM` for Blu-ray. The engine reads more than that.

1. **DVD root-first lookup.** Both `dvdinfo` and ffmpeg's `dvdvideo` demuxer go through libdvdread. Its `findDVDFile` calls `findDirFile(dvd, dvd->rd->path_root, nodirfile, …)` **first** and falls back to `<root>/VIDEO_TS/` only when nothing matches (`engine/deps/libdvdread-7.1.1/src/dvd_reader.c:974-992`). `findDirFile` compares names with `strcasecmp`. So a `VTS_01_0.IFO` or `vts_01_1.vob` dropped into the source root replaces the real file for every later probe and rip. The root's mtime and listing are not in the identity. If `VIDEO_TS` lacks a file, libdvdread also falls back to a lowercase `video_ts/`, which isn't covered either.
2. **Blu-ray subtrees.** libbluray re-reads `BDMV/BACKUP/{index.bdmv,PLAYLIST,CLIPINF}` when the primary fails to parse (`mpls_parse.c:1179`, `clpi_parse.c:865`, `index_parse.c:317`). It reads `CERTIFICATE/[BACKUP/]id.bdmv` (`bdid_parse.c:116`). libaacs parses `AACS/*`. None of these is fingerprinted. The `BDMV` listing does include the `BACKUP` directory entry's own mtime, but that changes only when a direct child is added or removed. It does not change when `BACKUP/PLAYLIST/00000.mpls` is rewritten in place.
3. **Cap.** Past `MAX_IDENTITY_ENTRIES`, entries are only counted (`+N`). A folder padded with 5000 dummy names that sort first (for example in `BDMV/`) leaves every playlist, clip and stream outside the fingerprint, so in-place edits to them go unnoticed.

Verified locally:
```
root-level IFO added, identity same: true
BACKUP+AACS rewritten, identity same: true
```
Precondition: write access to the consented folder between consent and probe/rip. Examples: a rip folder on a NAS share, a sync-client folder, or a downloaded `VIDEO_TS` tree. That is the same attacker capability as the prior CR-01 scenario 3. SECURITY.md:39 now promises that a disc "swapped ... in the same ... folder" or "changed since" is refused, and for these files it is not. On Windows, where the gate is always on, this turns a writable media share into unsandboxed native parsing with no prompt.
**Fix:** Fingerprint everything the engine can open, and fail closed when the walk can't be completed:
```js
const IDENTITY_DIRS = {
  // libdvdread looks in the root first, then VIDEO_TS, then video_ts
  dvd: ['', 'VIDEO_TS', 'video_ts'],
  bluray: ['', 'BDMV', 'BDMV/PLAYLIST', 'BDMV/CLIPINF', 'BDMV/STREAM',
           'BDMV/BACKUP', 'BDMV/BACKUP/PLAYLIST', 'BDMV/BACKUP/CLIPINF',
           'AACS', 'AACS/DUPLICATE', 'CERTIFICATE', 'CERTIFICATE/BACKUP'],
};
// rel '' => the source root itself (path.join(source))
...
if (statted >= MAX_IDENTITY_ENTRIES) throw new Error('Too many files to verify this disc');
```
Throwing at the cap is safe: no real disc has 5000 entries in those directories, and `identityOf` turns the throw into a refusal. Better still, also hash the **contents** of the small control files the parsers trust: `*.IFO`/`*.BUP` (KB each), `index.bdmv`, `MovieObject.bdmv`, `*.mpls`, `*.clpi`. Then a same-size, mtime-restored edit can't pass either. Add unit tests for a root-level `.IFO`, a rewritten `BDMV/BACKUP/PLAYLIST/*.mpls`, a rewritten `AACS/*`, and the cap now throwing. Also add an e2e step to `sec_gate_swap` that drops a root-level IFO into the consented folder and expects `probe` to be refused.

## Warnings

### WR-01: Consent comes from the renderer, so a compromised renderer turns into unsandboxed native parsing (carried, STILL OPEN)

**File:** `app/main.js:483-489`, `app/lib.js:304-316`
**Issue:** Unchanged. `userConfirmed: true` is still a plain IPC argument, and main can't tell a real "Scan anyway" click from injected script. The new identity binding limits what a consent covers, but it does nothing about who gives it.
**Fix:** As before: when `!sandboxTrusted()`, ask with a native `dialog.showMessageBox(win, { type: 'warning', buttons: ['Scan anyway', 'Not now'], cancelId: 1, defaultId: 1 })` in main, and drop `userConfirmed` from the IPC contract.

### WR-02: The prompt survives an eject on Windows/Linux, so "Scan anyway" binds consent to a disc the user never saw (carried, STILL OPEN)

**File:** `app/renderer/app.js:759-763`, `app/renderer/app.js:430-442`
**Issue:** Unchanged. `sourceGone` still matches only `state.source?.startsWith('/Volumes/')`. On Windows and Linux, a `pendingScan` for `D:\` outlives an eject. A disc inserted while a rip is running doesn't trigger `requestScan` (line 764). "Scan anyway" then scans the new disc, and main records **its** identity as consented, because `scan()` captures `before` at click time (main.js:198). This is now the main place where consent is still effectively keyed by path. The banner still names only `D:`.
**Fix:**
```js
const wasDrive = state.drives.discs.some((d) => d.path === state.source); // before state.drives = drives
const sourceGone = wasDrive && !drives.discs.some((d) => d.path === state.source);
```
Show the volume label (`d.name`) in the prompt. Optionally, have main return an opaque identity token with the drive list and require the scan to present the same token.

### WR-03: A stale scan error overwrites the current source's state (carried, STILL OPEN)

**File:** `app/renderer/app.js:460-468`
**Issue:** Unchanged. The `catch` branch sets `state.error` and clears `state.scanning` without checking `state.source !== src`. The only exception is `SANDBOX_OFF`. A late failure from scan A overwrites B's prompt or busy state. The new main-side `'The disc changed while it was being scanned…'` error makes late failures more likely.
**Fix:** Add `if (state.source !== src) return;` as the first line of the `catch` block.

### WR-04: The CI sentinel never exercises libaacs, so it proves nothing (carried, STILL OPEN)

**File:** `.github/workflows/ci.yml:37`, `test/e2e/scenarios.js` (`sec_hermetic_keydirs`)
**Issue:** Unchanged. No runner installs libaacs (the brew line at ci.yml:37 has no `libaacs`), so the key file is never looked up and the sentinel assertion passes vacuously.
**Fix:** Install libaacs on at least one runner and require the `found no KEYDB.cfg` branch whenever the sentinel is active. Otherwise, remove the sentinel.

### WR-05: The sentinel can be left in a real user's aacs folder (carried, STILL OPEN)

**File:** `test/e2e/run.js:55-93`
**Issue:** Unchanged. The only gate is `CI === 'true'` (line 58). Cleanup relies on `process.on('exit')` (line 93), which doesn't run on SIGINT, SIGTERM or SIGKILL. `mkdirSync(..., { recursive: true })` (line 72) can leave a new folder behind.
**Fix:** Require `GITHUB_ACTIONS === 'true' && SPINARR_E2E_SENTINEL === '1'`. Add SIGINT/SIGTERM handlers. Check the sentinel marker before unlinking, and remove the folder only if `run.js` created it.

### WR-06: Release signing secrets are exposed to PR-triggered builds (carried, STILL OPEN)

**File:** `.github/workflows/release.yml:15, 93-99`
**Issue:** Unchanged. `pull_request` triggers the packaging job, and the Package step always passes `MAC_CERT_P12_BASE64`, `WIN_CERT_PFX_BASE64`, the passwords and the Apple ID credentials. There is no protected `environment:`.
**Fix:** Pass the secrets only on `refs/tags/v*`, behind a protected `release` environment. Or split the PR build into an unsigned job with no `secrets.*` references.

### WR-07: "This workflow restores NO caches" is probably false: setup-msys2 caches by default (carried, STILL OPEN)

**File:** `.github/workflows/release.yml:8, 70`
**Issue:** Unchanged. The `setup-msys2` step still has no `cache: false`. I believe its `cache` input defaults to on, but I didn't check that against the pinned `action.yml`.
**Fix:** Add `cache: false` to the step, and record the pinned commit's default in the header comment.

### WR-08: The identity changes on harmless OS edits, so queued rips fail and the UI offers no way to rescan

**File:** `app/lib.js:210-235`, `app/main.js:350, 391`, `app/renderer/app.js:474-487, 557-559`
**Issue:** The comment says "xattr writes (quarantine, Spotlight)" don't change the identity. That holds only on filesystems with native xattrs. On exFAT, FAT32 and many SMB/NAS shares, which are common for Plex/Jellyfin collectors, macOS stores xattrs as AppleDouble `._VTS_01_1.VOB` files in the same folder. Finder writes `.DS_Store` into any folder the user opens, and Windows Explorer writes `Thumbs.db` / `desktop.ini`. Every one of these adds an entry to the hashed `VIDEO_TS` / `BDMV/*` listing. A queued rip then fails with "Scan the disc again" (fail-closed, but spurious). The renderer doesn't handle that message: probe errors go into the track detail, rip refusals become a toast, and `state.disc` keeps showing the stale scan with no rescan action. The user is left with a disc that looks loaded but won't rip.
**Fix:** In the listing, keep only names the parsers can open. That is safe, because libdvdread and libbluray open only fixed name patterns:
```js
const DISC_NAME = { dvd: /^(VIDEO_TS|VTS_\d\d_\d)\.(IFO|BUP|VOB)$/i, bluray: /^(?!\._)[^.].*$/ }; // at least drop dotfiles/AppleDouble
names = names.filter((n) => DISC_NAME[kind].test(n));
```
(Apply this together with the CR-01 coverage fix, so root-level `*.IFO` stays covered.) In the renderer, when a probe or rip error starts with `Scan the disc again` and `src === state.source`, call `requestScan(src)` so the user gets the prompt instead of a dead end.

### WR-09: With the sandbox trusted, a stale scan of a swapped disc or overwritten image is still used to build Blu-ray rips

**File:** `app/main.js:236-246, 258-261, 310-316`
**Issue:** `assertScanGate` returns at once when `sandboxTrusted()` (line 237), so `scannedSame` never runs on macOS/Linux sandboxed builds. `revalidateScans` runs only on a volume-change event, and an overwritten or re-downloaded `.iso`, or an edited folder, produces none. `probeStreams` and `enqueue` then take the old disc's Blu-ray `playlist`, `chapterDurations` and `duration` from `scans.get(src)` and apply them to the new content. The result: chapters land in the wrong places, the wrong playlist is ripped, and `ripVerdict` checks against the wrong duration. That breaks the core value ("a complete, bit-exact copy … or it fails loudly"), and the comment at line 242 ("a stale scan of a swapped disc is wrong either way") says the code meant to prevent exactly this.
**Fix:** Always validate freshness. Gate on consent only when untrusted:
```js
function assertScanGate(src) {
  const had = scans.has(src);
  const fresh = had ? scannedSame(src) : null;     // drops stale entries in every mode
  if (sandboxTrusted()) return;
  if (!had) throw new Error(lib.RESCAN_NOT_SCANNED);
  if (!fresh) throw new Error(lib.RESCAN_CHANGED);
}
```
Also make `probeStreams` and `enqueue` throw `RESCAN_CHANGED` whenever a Blu-ray entry existed but was dropped, rather than silently falling through to the DVD path.

### WR-10: `sec_gate_swap` passes for a reason that doesn't cover the real drive-swap case

**File:** `test/e2e/scenarios.js:304-317`
**Issue:** Step 1 swaps the disc folder with `fs.rmSync` + `fs.cpSync`. That creates a new root directory, so the root `ino` alone changes the identity. The `VIDEO_TS` coverage is never what triggers the refusal. A physical disc at `D:\` or a reused mount point keeps a stable root path and may keep the same `dev`/`ino`, which is exactly where the per-file fingerprint has to work. The comment admits `fakeEject` reaches only the renderer, so `revalidateScans` isn't exercised either. Nothing tests the `start()` re-check after the async `prepareBluray` gap, or any Blu-ray swap. Because of these gaps, the test stays green even with the CR-01 holes.
**Fix:** Add an in-place step that keeps the root directory and replaces only its contents (`fs.rmSync(path.join(disc, 'VIDEO_TS'), …)` then copy the other fixture's `VIDEO_TS` in, and separately add a root-level `VTS_01_0.IFO`), and expect refusal. Add a Blu-ray fixture swap during `prepareBluray`, or at least a unit-level test that `start()` refuses when the identity changes between `pump()` and `start()`.

## Info

### IN-01: The Electron advisory step fails open on an `npm audit` error (carried, STILL OPEN)

**File:** `.github/workflows/ci.yml:248-249`
**Issue:** `|| true` plus `.vulnerabilities||{}` reports "No advisories affect electron." when npm returns `{"error":…}`.
**Fix:** `if (j.error || !j.vulnerabilities) process.exit(1)`.

### IN-02: The static chokepoint test is easy to sidestep (carried, STILL OPEN)

**File:** `test/unit/gate-static.test.js`
**Issue:** Unchanged. It matches the exact text `spinarr.scan(` / `userConfirmed: true`.
**Fix:** Use whitespace- and bracket-tolerant regexes (`/spinarr\s*(\.|\[\s*['"])scan/`, `/userConfirmed\s*:/`).

### IN-03: `SPINARR_TEST_HOME` accepts relative paths (carried, STILL OPEN; was IN-04)

**File:** `app/main.js:35`
**Fix:** `path.resolve(process.env.SPINARR_TEST_HOME)`. This is dev-only.

### IN-04: The `scans` eviction ignores recency, and the rescan wording is reused for unrelated errors

**File:** `app/main.js:219-220, 248-252`, `app/lib.js:242`
**Issue:** `Map.set` on an existing key keeps its original insertion slot. A source the user just rescanned can therefore be the next one evicted at 51 entries, and its queued jobs then fail with "Scan the disc again before ripping". `scannedTitle` throws the same `RESCAN_NOT_SCANNED` when the title simply isn't in the scan, which sends users to rescan for the wrong reason. The never-scanned refusal says "again" and "before ripping" even when it comes from `probe`.
**Fix:** `scans.delete(source)` before `scans.set(...)`. Use a distinct `'Unknown title'` error in `scannedTitle`. Reword `RESCAN_NOT_SCANNED` to "Scan the disc first", and keep the `/Scan the disc/` prefix that tests match on.

### IN-05: SECURITY.md overstates the guarantees ("An eject always clears the answer")

**File:** `SECURITY.md:39, 42`
**Issue:** Eject clearing depends on the watcher firing. Windows polls every 3 s (`platform.js:254-259`), and the check looks only for `VIDEO_TS`/`BDMV` presence, so a quick swap can go unseen. In that case only the identity comparison protects the user, and CR-01 shows it is incomplete. Line 39's "swapped … in the same … folder … refuses" also doesn't hold for root-level or `BACKUP`/`AACS` edits (CR-01).
**Fix:** After fixing CR-01, reword: "Ejecting or changing the disc normally clears the answer; before any probe or rip, Spinarr also checks that the disc's files still match what was scanned."

---

_Reviewed: 2026-10-12T12:06:21Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
