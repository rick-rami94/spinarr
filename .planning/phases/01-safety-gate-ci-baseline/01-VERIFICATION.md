---
phase: 01-safety-gate-ci-baseline
verified: 2026-10-12T12:11:32Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "No disc is ever scanned unsandboxed without the user's click; e2e covers every scan entry point (roadmap success criterion 1 / SAFE-01)"
    status: partial
    reason: "lib.mediumIdentity's tracked-directory list does not cover every file the disc parsers read: for DVD it omits the source root (libdvdread's findDVDFile searches the root before VIDEO_TS/), and for Blu-ray it omits BDMV/BACKUP/**, AACS/ and CERTIFICATE/ (all read by libbluray/libaacs). Files past the 5000-entry cap are counted but never stat'd. A write to one of these uncovered locations inside an already-consented folder leaves the computed identity unchanged, so probe/rip proceed unsandboxed with no new prompt. Independently reproduced in this verification pass with a standalone node script against app/lib.js: a root-level .IFO added to a consented DVD folder, and a rewritten BDMV/BACKUP/PLAYLIST/*.mpls plus AACS/*.inf in a consented Blu-ray folder, both left the identity string unchanged ('identity same: true')."
    artifacts:
      - path: "app/lib.js"
        issue: "IDENTITY_DIRS (line ~214) = { dvd: ['VIDEO_TS'], bluray: ['BDMV','BDMV/PLAYLIST','BDMV/CLIPINF','BDMV/STREAM'] } omits the DVD root and the Blu-ray BACKUP/AACS/CERTIFICATE subtrees; mediumIdentity (line ~216-239) only counts (does not stat) entries past MAX_IDENTITY_ENTRIES = 5000, so a padded directory can hide real changes past the cap."
      - path: "test/e2e/scenarios.js"
        issue: "sec_gate_swap's folder-swap step (lines ~304-317) replaces the whole directory with fs.rmSync + fs.cpSync, which changes the root inode and masks the per-file fingerprint gap; no scenario edits a file in place (same root inode) inside a consented folder, so the new CR-01 has zero regression coverage."
      - path: "SECURITY.md"
        issue: "The sub-bullet added in 01-12 (around line 39) claims a disc 'swapped for another disc in the same drive or folder... or [an image] changed since' is always refused; this is not true for an in-place edit to a root-level IFO or a BDMV/BACKUP/AACS file, which is a case of 'changed since' that is NOT refused today."
    missing:
      - "Extend IDENTITY_DIRS to also walk the DVD source root ('') and the lowercase video_ts fallback, and the Blu-ray BDMV/BACKUP, BDMV/BACKUP/PLAYLIST, BDMV/BACKUP/CLIPINF, AACS, AACS/DUPLICATE, CERTIFICATE and CERTIFICATE/BACKUP subtrees."
      - "Make the MAX_IDENTITY_ENTRIES cap fail closed (throw, producing a refusal) instead of silently counting unstat'd entries past the cap."
      - "Add unit tests: root-level .IFO added, BDMV/BACKUP/PLAYLIST/*.mpls rewritten, AACS/* rewritten, and the cap now causing a refusal instead of a silent pass-through."
      - "Add an e2e case that edits a file in place inside an already-consented folder (same root inode, not a full directory replace) and asserts probe/rip are refused with /Scan the disc again/ — sec_gate_swap's current folder-swap step cannot catch this because it replaces the whole directory."
      - "Re-word SECURITY.md's 'swapped... or changed since' sub-bullet once the fix lands, or soften it now to acknowledge the in-place-edit limit, so it does not overstate current coverage."
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Prior CR-01 (path-keyed consent): probe/enqueue only checked scans.has(path) with no disc-identity binding, scans were never invalidated on eject/swap, and pump() never re-checked the gate before spawning a queued job. CLOSED — app/main.js now binds every scans entry to lib.mediumIdentity(source) captured before and after the scan; assertScanGate(src) is enforced at handle('probe'), enqueue(), the top of pump(), the top of prepareBluray() (before its ffprobe), and immediately before spawn in start(); revalidateScans() runs on every platform.watch volume-change callback. Independently confirmed by reading app/main.js and app/lib.js, by 40/40 passing unit tests (test/unit/lib.test.js, 8 new mediumIdentity cases run locally), and by running the e2e suite locally: sec_gate_swap, sec_gate_ipc, gate_insert, gate_drop, gate_pick_iso, gate_pick_folder all PASS (6/6)."
  gaps_remaining:
    - "Roadmap truth #1 / SAFE-01 is still not fully true: a NEW, narrower CR-01 from the fresh 01-REVIEW.md (committed 0de0f3f) is confirmed independently — lib.mediumIdentity's IDENTITY_DIRS for 'dvd' only walks VIDEO_TS (missing the source root, which libdvdread's findDVDFile searches first per dvd_reader.c) and for 'bluray' only walks BDMV/{PLAYLIST,CLIPINF,STREAM} (missing BDMV/BACKUP/**, AACS/, CERTIFICATE/, all of which libbluray/libaacs read). A file written into one of the uncovered locations inside an already-consented folder leaves the identity string byte-for-byte unchanged, so probe/rip proceed unsandboxed with no new prompt. Reproduced independently in this verification run (not just trusting 01-REVIEW.md's narrative) with a standalone node script against app/lib.js: adding a root-level .IFO to a consented DVD folder, and separately rewriting BDMV/BACKUP/PLAYLIST/*.mpls plus AACS/*.inf in a consented Blu-ray folder, both printed 'identity same: true'."
  regressions: []
---

# Phase 01: Safety Gate & CI Baseline Verification Report

**Phase Goal:** The worst exposure is closed immediately (no disc is ever scanned unsandboxed without the user's click), and the repo and CI are in a state that later phases can safely build on.
**Verified:** 2026-10-12
**Status:** gaps_found
**Re-verification:** Yes — after gap closure (plans 01-11, 01-12)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | No disc is ever scanned unsandboxed without the user's click; e2e covers every scan entry point | ✗ **FAILED** (partial — narrower than before) | The original path-keyed-consent gap (drive-letter reuse, no pump() re-check, no e2e coverage) is CLOSED — see `gaps_closed` above. A NEW, narrower residual bypass is confirmed independently in this run: `lib.mediumIdentity` (`app/lib.js:210-239`) does not fingerprint every file the engines read. For DVD, libdvdread's `findDVDFile` searches the source **root** before `VIDEO_TS/` (`dvd_reader.c:974`), but `IDENTITY_DIRS.dvd = ['VIDEO_TS']` never stats the root's contents. For Blu-ray, libbluray re-reads `BDMV/BACKUP/{index.bdmv,PLAYLIST,CLIPINF}` on fallback and `CERTIFICATE/[BACKUP/]id.bdmv`, and libaacs parses `AACS/*` — none of these are in `IDENTITY_DIRS.bluray = ['BDMV','BDMV/PLAYLIST','BDMV/CLIPINF','BDMV/STREAM']`. I independently reproduced this with a standalone node script (not a re-run of the reviewer's script, a fresh one written in this verification pass) against the real `app/lib.js`: writing a root-level `VTS_01_0.IFO` into a consented DVD folder left `mediumIdentity` unchanged (`identity same: true`), and separately rewriting `BDMV/BACKUP/PLAYLIST/00000.mpls` and `AACS/Unit_Key_RO.inf` in a consented Blu-ray folder also left it unchanged. Precondition: write access to the already-consented folder between consent and probe/rip (e.g. a NAS/SMB share, sync-client folder, or downloaded disc-folder tree) — narrower than the original bug (no longer "any disc swap at the same path"), but the SAME invariant text ("no disc is ever scanned unsandboxed without the user's click") is still violated for this case. |
| 2 | Private vuln reporting, SECURITY.md fallback contact, Dependabot alerts/update PRs active | ✓ VERIFIED (regression-checked) | Not re-queried live via `gh api` this pass (no code changed in this area since the prior verification); `SECURITY.md` still contains `rickramirez94@gmail.com` as fallback contact (grep-confirmed). No file touched by 01-11/01-12 affects this truth. |
| 3 | Every GH Action pinned by SHA; toolchains pinned; main rejects merges without required checks; audit covers Electron | ✓ VERIFIED (regression-checked) | `grep -nE "uses:\s" .github/workflows/*.yml \| grep -vE "@[a-f0-9]{40}"` returns nothing (still all SHA-pinned). Live re-check: `gh api repos/:owner/:repo/branches/main/protection` shows `required_status_checks.contexts: ["macos","linux","windows","audit"]` and `enforce_admins.enabled: true` — unchanged from the prior verification. No workflow files were touched by 01-11/01-12. |
| 4 | README has no direct libdvdcss DLL link; setup guidance neutral; nothing shipped/fetched | ✓ VERIFIED (regression-checked) | `grep -i "libdvdcss\|videolan" README.md` still shows only neutral package-manager commands and the Windows "choose your own DLL" wording, no URL. Unchanged by this gap-closure round. |
| 5 | CI on Windows runs full suite; e2e never reads real AACS/dvdcss folders and covers accurateChapters=false; c8 baseline recorded and fails on regression | ✓ VERIFIED (regression-checked) | `.github/workflows/ci.yml` Windows job still runs `test:unit`, `test:security`, `test:engine`, `test:e2e`. `sec_hermetic_keydirs` and the `accurateChapters: false` scenario (`us_default_chapters`, line ~721) are both still present in `test/e2e/scenarios.js`. `.c8rc.json` thresholds unchanged (lines/statements 85, functions 88, branches 91) and `npm run test:coverage` exited 0 per the 01-11/01-12 SUMMARYs; not independently re-run with full coverage in this pass since no `app/*.js` behavior outside the gated functions changed, but the local unit suite (`node --test test/unit/lib.test.js`) passed 40/40 including 8 new `mediumIdentity` cases. |

**Score:** 4/5 truths verified (truth #1 still FAILED, now for a narrower reason)

**Windows CI note:** Per task instructions, the full local suite (unit, security, engine, e2e 33/33) passed on macOS after gap closure, but the milestone branch's Windows CI job has not yet run on these commits (not pushed). Windows evidence is treated as unavailable, not as passing — this is relevant because Windows is the one platform where `sandboxTrusted()` is always false and the gate (including the newly-found residual gap) is always live.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `app/lib.js` (`mediumIdentity`, `RESCAN_NOT_SCANNED`, `RESCAN_CHANGED`) | Filesystem identity + shared refusal strings | ⚠️ **PARTIAL** | Present, exported, unit-tested (8 new cases, all passing). But the identity function itself has an incomplete file list (see truth #1) — it exists and is substantive, but is not a complete fingerprint of what the engines read. |
| `app/main.js` (`scannedSame`, `assertScanGate`, `revalidateScans`, gate at probe/enqueue/pump/prepareBluray/start) | Identity-bound gate enforcement at every spawn site | ✓ VERIFIED | Confirmed by reading the file directly: `assertScanGate` (line 236), called at `handle('probe')` (492), `enqueue()` (309), top of `pump()` (350), top of `prepareBluray()` (373), and immediately before `spawn` in `start()` (391). `revalidateScans()` wired into `watchVolumes()` (165). This is a correct, complete implementation of what plan 01-11 specified — the residual gap is in `mediumIdentity`'s file coverage, not in the gate wiring. |
| `test/e2e/scenarios.js` (`sec_gate_swap`, tightened `sec_gate_ipc`) | e2e regression for whole-disc swap, ISO overwrite, queued-job swap | ✓ VERIFIED, but incomplete coverage | Both scenarios exist and pass (confirmed by running `node test/e2e/run.js sec_gate_swap sec_gate_ipc gate_insert gate_drop gate_pick_iso gate_pick_folder` locally: 6/6 PASS). However, per 01-REVIEW.md WR-10 (independently plausible from reading the scenario text at scenarios.js:304-317): the folder-swap step uses `fs.rmSync` + `fs.cpSync`, which creates a new root directory and therefore changes the root `dev`/`ino` — the test passes because of the root-identity change, not because `VIDEO_TS`/`BDMV` coverage caught anything. No e2e scenario exercises an in-place edit to a root-level IFO or a `BDMV/BACKUP`/`AACS` file while the root inode stays the same, so the new CR-01 has no regression coverage. |
| `SECURITY.md` | Truthful gate description including residual limits | ⚠️ **PARTIAL** | Contains "never remembers the answer," "changed since," and a limits paragraph naming "volume serial or device, file IDs, sizes, timestamps" (grep-confirmed) — this is accurate for the *mechanism*, but the sub-bullet's claim that a disc "swapped for another disc in the same drive or folder... [or an image] changed since" is always refused is not fully true given the new CR-01: an in-place edit to a root-level IFO or a `BDMV/BACKUP`/`AACS` file is a case of "changed since" that is NOT refused. |
| `.planning/REQUIREMENTS.md` | SAFE-01 unchecked, traceability reflects pending re-verification | ✓ VERIFIED | Line 12 `- [ ] **SAFE-01**` still unchecked; line 139 reads "In Progress (gap CR-01 fixed in 01-11/01-12; awaiting re-verification)" — accurate given this verification's finding (the specific prior gap IS fixed; a new one is found). |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `app/main.js scan()` | `lib.mediumIdentity` | identity captured before/after `readInfo` | ✓ WIRED | Confirmed at `app/main.js:198` (before) and `:212` (after); mismatch throws and nothing is stored. |
| `app/main.js handle('probe') / enqueue() / pump() / prepareBluray() / start()` | `assertScanGate` | direct call before any engine spawn | ✓ WIRED | Confirmed at lines 492, 309, 350, 373, 391 respectively. |
| `app/main.js watchVolumes()` | `revalidateScans()` | called first in the `platform.watch` callback | ✓ WIRED | Confirmed at line 165, ahead of `abandonVanishedSource()`. |
| `lib.mediumIdentity` | the actual file set libdvdread/libbluray/libaacs read | fingerprint completeness | ✗ **NOT WIRED (gap)** | This is the link that is broken: the gate machinery is wired correctly to `mediumIdentity`, but `mediumIdentity` itself is not wired to the full set of files the engines can open. The gate is only as strong as this fingerprint, and the fingerprint is incomplete. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| SAFE-01 | 01-02, 01-05, 01-06, 01-07, 01-10, 01-11, 01-12 | Disc never scanned automatically/unsandboxed without a click | ✗ **BLOCKED** | The specific gap from the prior verification (path-keyed consent, no pump re-check, no e2e coverage) is closed. A new, narrower residual bypass (incomplete file-fingerprint coverage in `mediumIdentity`) keeps this requirement from being fully satisfied. REQUIREMENTS.md correctly keeps it unchecked and "awaiting re-verification" — that wording should now be updated to reflect a new, narrower open issue rather than "awaiting re-verification" of the old one. |
| REL-05 | 01-01, 01-05 | Private vuln reporting + SECURITY.md fallback + Dependabot | ✓ SATISFIED | Regression-checked (see truth #2); unaffected by this round's changes. |
| REL-06 | 01-03, 01-10 | SHA-pinned actions, pinned toolchains, branch protection, Electron audit | ✓ SATISFIED | Regression-checked (see truth #3); unaffected by this round's changes. |
| REL-08 | 01-05 | No direct libdvdcss DLL link; neutral guidance | ✓ SATISFIED | Regression-checked (see truth #4); unaffected by this round's changes. |
| QUAL-01 | 01-04, 01-09 | c8 coverage measured with recorded baseline, no regression | ✓ SATISFIED | Regression-checked (see truth #5); `.c8rc.json` thresholds unchanged, new `mediumIdentity` unit tests pass. |
| QUAL-02 | 01-04, 01-07, 01-08 | e2e hermetic (no real AACS/dvdcss read); accurateChapters=false covered | ✓ SATISFIED | Regression-checked (see truth #5); `sec_hermetic_keydirs` and `accurateChapters: false` scenarios both still present and unaffected by this round. |
| PLAT-01 | 01-03, 01-04, 01-09 | Windows CI runs full suite | ✓ SATISFIED (code present) / **UNVERIFIED on this commit** | Windows job still runs the full suite per `ci.yml`. These exact commits have not been pushed, so Windows CI has not actually run them — treated as unavailable per task instructions, not as a regression or new gap, since the job definition itself is unchanged. |

**No orphaned requirements** — all 7 phase requirement IDs (SAFE-01, REL-05, REL-06, REL-08, QUAL-01, QUAL-02, PLAT-01) appear in plan frontmatter (now across 12 plans, including 01-11/01-12) and are cross-referenced in REQUIREMENTS.md.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `app/lib.js` | 213-239 (`IDENTITY_DIRS`, `mediumIdentity`) | Incomplete file-fingerprint coverage: DVD root and Blu-ray `BACKUP`/`AACS`/`CERTIFICATE` subtrees are never stat'd; entries past `MAX_IDENTITY_ENTRIES` are counted, not fingerprinted | 🛑 **BLOCKER** | Directly defeats SAFE-01 / roadmap success criterion 1 for in-place edits to a consented folder (new CR-01, independently confirmed above). |
| `test/e2e/scenarios.js` | 304-317 (`sec_gate_swap` part 1) | The folder-swap step replaces the whole directory (new inode), so it never exercises the per-file fingerprint that the new CR-01 shows is weak | ⚠️ WARNING | The new gap has zero regression coverage, carried from 01-REVIEW.md WR-10. |
| `.github/workflows/release.yml` | ~15, 93-99 | Signing secrets exposed to `pull_request`-triggered builds (WR-06, carried, still open) | ⚠️ WARNING | Outside Phase 1's SAFE-01/REL-06 success-criteria text; not re-verified line-by-line this pass, carried forward unchanged. |
| `test/e2e/run.js` | 55-93 | CI-only KEYDB sentinel gated only on `CI==='true'`, no libaacs installed on any runner (WR-04/WR-05, carried, still open) | ⚠️ WARNING | Proves less than docs imply about the sentinel; QUAL-02's hermeticity path-prefix assertions still hold independently. |
| `app/renderer/app.js` | 759-763, 430-442 | Consent prompt can outlive an eject on Windows/Linux (`sourceGone` only matches `/Volumes/`); WR-02, carried, still open | ⚠️ WARNING | Narrows where consent is still effectively path-bound on non-macOS; now the main remaining avenue for the *old* class of bug, compounding the new CR-01's exposure window. |
| `app/main.js` | 236-237 (`assertScanGate`) | `sandboxTrusted()` short-circuits `scannedSame` entirely, so a stale Blu-ray scan (wrong playlist/chapters/duration) can be used on the sandboxed path too (WR-09, carried, still open) | ⚠️ WARNING | Correctness issue (wrong rip), not a SAFE-01 safety breach on the sandboxed path, but worth tracking — carried from 01-REVIEW.md. |

No unresolved `TBD`/`FIXME`/`XXX` debt markers found in the reviewed file set.

### Human Verification Required

None. The new CR-01 is independently reproducible by code inspection and a standalone node script against `app/lib.js` (done in this verification pass, not borrowed from the reviewer's output) — this is a clear FAILED, not an UNCERTAIN.

### Gaps Summary

**What closed cleanly:** The gap this re-verification was commissioned to check — path-keyed consent in `probe`/`enqueue`, no re-check in `pump()`, and no e2e regression coverage — is genuinely fixed. `app/main.js` now binds every scan to `lib.mediumIdentity(source)`, checks `sandboxTrusted() || scanned-and-still-same-medium` at all five engine-spawn sites (`probe`, `enqueue`, `pump`, `prepareBluray`, `start`), and drops stale entries on every volume-change event. 40/40 unit tests pass including 8 new `mediumIdentity` cases, and all 6 named e2e gate scenarios (`sec_gate_swap`, `sec_gate_ipc`, `gate_insert`, `gate_drop`, `gate_pick_iso`, `gate_pick_folder`) pass locally. Truths 2-5 and requirements REL-05/REL-06/REL-08/QUAL-01/QUAL-02 remain solid on regression check.

**What is still open:** A fresh code re-review (01-REVIEW.md, committed 0de0f3f) found a new, narrower CR-01 in the mechanism that plan 01-11 built: `lib.mediumIdentity`'s tracked-directory list does not cover every file the engines actually read. For DVDs, libdvdread checks the disc **root** before `VIDEO_TS/`; for Blu-ray, libbluray/libaacs read `BDMV/BACKUP/**`, `AACS/*` and `CERTIFICATE/*`. None of these are fingerprinted. I independently reproduced this in this verification pass with a fresh node script against the real `app/lib.js` (not a re-run of the reviewer's script): adding a root-level `.IFO` to a consented DVD folder, and separately rewriting a `BDMV/BACKUP/PLAYLIST/*.mpls` and an `AACS/*.inf` file in a consented Blu-ray folder, both left the computed identity byte-for-byte unchanged. This means probe/rip on such a folder proceed unsandboxed with no new prompt, which is exactly the SAFE-01 invariant this phase exists to guarantee. The precondition — write access to a path the user already consented to scan — is narrower than the original bug (which required only a disc/image swap at the same path with no write-access-to-contents requirement), but the invariant text is still violated, and SECURITY.md's claim that a folder "changed since" scan is always refused is not fully true for this case.

This is classified as a BLOCKER, consistent with 01-REVIEW.md's own "critical" rating, because it falls inside the phase's own goal statement and roadmap success criterion 1, and it is independently reproducible (not just asserted) in this verification pass.

**Recommended fix scope for the next gap-closure plan:**
- Extend `IDENTITY_DIRS` (or an equivalent mechanism) to cover: for DVD, the source root itself (`''`) in addition to `VIDEO_TS` and the lowercase `video_ts` fallback; for Blu-ray, add `BDMV/BACKUP`, `BDMV/BACKUP/PLAYLIST`, `BDMV/BACKUP/CLIPINF`, `AACS`, `AACS/DUPLICATE`, `CERTIFICATE`, `CERTIFICATE/BACKUP`.
- Make the `MAX_IDENTITY_ENTRIES` cap fail closed (throw, causing a refusal) instead of silently counting unstat'd entries past the cap, so a padded directory cannot hide changes to real control files.
- Consider hashing the contents of the small control files themselves (`*.IFO`/`*.BUP`, `index.bdmv`, `MovieObject.bdmv`, `*.mpls`, `*.clpi`) rather than only size/mtime/ino, so a same-size mtime-restored edit cannot pass either.
- Add unit tests: root-level `.IFO` added, `BDMV/BACKUP/PLAYLIST/*.mpls` rewritten, `AACS/*` rewritten, and the cap now causing a refusal.
- Add an e2e case (new scenario or an addition to `sec_gate_swap`) that edits a file in-place inside a consented folder (same root inode, not a full directory replace) and asserts probe/rip are refused — this is the regression the current `sec_gate_swap` cannot catch per WR-10.
- Re-word SECURITY.md's sub-bullet once fixed so it no longer overstates "changed since" coverage until the fix lands.

**This looks intentional only in the narrow sense that plan 01-11 deliberately scoped itself to filesystem identity and explicitly deferred the stronger DVDDiscID/Blu-ray disc_id catalog to Phase 3.** However, the specific files missed here (DVD root, Blu-ray BACKUP/AACS) are not an intentional simplification documented anywhere in 01-11-PLAN.md or its SUMMARY — they are an implementation gap within the filesystem-identity approach the plan committed to delivering ("spinarr.probe and spinarr.rip of a path whose medium was swapped, overwritten, ejected or replaced since the consented scan are refused"). No override is suggested; this should go back through `/gsd-plan-phase 1 --gaps`.

---

_Verified: 2026-10-12T12:11:32Z_
_Verifier: Claude (gsd-verifier)_
