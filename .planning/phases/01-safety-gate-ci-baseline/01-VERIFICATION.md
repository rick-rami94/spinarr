---
phase: 01-safety-gate-ci-baseline
verified: 2026-10-11T00:00:00Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "On any OS where the sandbox probe has not passed, inserting a disc does not scan it; the user sees why and must click to scan, and an e2e test covers every scan entry point (insert, drag-drop, folder/ISO open)."
    status: partial
    reason: "The entry-point gate (requestScan -> confirmScan -> spinarr.scan) is real and e2e-covered (gate_insert, gate_drop, gate_pick_iso, gate_pick_folder), but the broader SAFE-01 invariant ('no disc is ever scanned unsandboxed without the user's click') is violated: probe and rip/enqueue check only scans.has(path), keyed by path and never invalidated on eject, disc swap or file overwrite. Once a user consents to scan D:\\ (or an .iso path), a different disc later at that same path is parsed unsandboxed by ffprobe/ffmpeg via probe/rip with no new prompt. pump() does not re-check the gate before spawning either, so a queued job can run against a swapped disc. This is CR-01 / WR-08 from 01-REVIEW.md, confirmed independently by reading app/main.js."
    artifacts:
      - path: "app/main.js"
        issue: "handle('probe') (line ~447) and enqueue() (line ~274) gate only on scans.has(src)/scans.has(job.source), not on disc identity. pump() (line ~307) never re-checks sandboxTrusted()||scans.has(...) before start(). scans Map (line ~183) is never invalidated on eject/volume-change/file-mtime-change."
        issue: "test/e2e/scenarios.js sec_gate_ipc ends by asserting 'probe works once the source was scanned with consent' (line 268) and never tests that probe/rip are refused after the medium at that path changes -- the gap has no e2e regression coverage."
    missing:
      - "Tie scan consent to the scanned medium's identity (e.g. dev:ino:size:mtime, or a disc/volume serial), not just the path, and invalidate scans entries when the volume is ejected, the drive letter is reused, or the backing file's identity changes."
      - "Re-check the (sandbox-trusted OR scanned-and-still-same-medium) condition inside pump() immediately before start(), not only at enqueue time."
      - "Add an e2e scenario: consent -> eject/fakeEject -> swap the fixture at the same path -> assert spinarr.probe and spinarr.rip are refused with a 'scan again' style error."
---

# Phase 01: Safety Gate & CI Baseline Verification Report

**Phase Goal:** The worst exposure is closed immediately (no disc is ever scanned unsandboxed without the user's click), and the repo and CI are in a state that later phases can safely build on.
**Verified:** 2026-10-11
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | No disc is ever scanned unsandboxed without the user's click; e2e covers every scan entry point | ✗ **FAILED** (partial) | Entry-point gate is real and tested, but CR-01: `probe`/`enqueue`/`pump()` in `app/main.js` gate only on `scans.has(path)`, not disc identity, so a disc swapped at the same path (drive-letter reuse on Windows, or an overwritten `.iso`) is parsed unsandboxed by `ffprobe`/`ffmpeg` with **no new prompt**. Confirmed directly in `app/main.js:183-211,274,307-333,447-451`. No e2e scenario exercises this path (`sec_gate_ipc` stops at "probe works once scanned with consent," `test/e2e/scenarios.js:268`). |
| 2 | Private vuln reporting, SECURITY.md fallback contact, Dependabot alerts/update PRs active | ✓ VERIFIED | `gh api .../private-vulnerability-reporting` → `{"enabled":true}`; `.../automated-security-fixes` → `{"enabled":true,"paused":false}`; `gh api .../dependabot/alerts` returns 1 alert (feature live, not just toggled); `SECURITY.md:7` lists `rickramirez94@gmail.com` as fallback contact. |
| 3 | Every GH Action pinned by SHA; toolchains pinned; main rejects merges without required checks; audit covers Electron | ✓ VERIFIED | `grep -nE "uses:\s" .github/workflows/*.yml \| grep -vE "@[a-f0-9]{40}"` returned nothing — all actions SHA-pinned with version comments. `gh api .../branches/main/protection` shows `required_status_checks.contexts: ["macos","linux","windows","audit"]` and `enforce_admins.enabled: true`. `ci.yml` audit job (line 246-249) explicitly checks `vulnerabilities.electron` and fails the step if present. |
| 4 | README has no direct libdvdcss DLL link; setup guidance neutral; nothing shipped/fetched | ✓ VERIFIED | `grep -i "libdvdcss\|videolan" README.md` shows only neutral package-manager commands (brew/dnf/pacman) and, for Windows, "Choose your own 64-bit libdvdcss-2.dll in Settings → System. Spinarr checks it and never downloads or ships it." — no URL, no VideoLAN site name. |
| 5 | CI on Windows runs full suite; e2e never reads real AACS/dvdcss folders and covers accurateChapters=false; c8 baseline recorded and fails on regression | ✓ VERIFIED | `ci.yml` `windows` job (lines 140-230) runs `test:unit`, `test:security`, `test:engine`, `test:e2e` against a SHA-256-verified independent ffmpeg oracle. `test/e2e/scenarios.js:582` `sec_hermetic_keydirs` asserts `SPINARR_TEST_HOME` is set and paths derive from it; `:622` `us_default_chapters` sets `accurateChapters: false`. `.c8rc.json` has non-zero `check-coverage: true` thresholds (lines/statements 85, functions 88, branches 91) — a recorded floor, not placeholder zeros. |

**Score:** 4/5 truths verified (1 FAILED as a safety-critical blocker)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `app/lib.js` (`scanGate`, `validateScanOptions`, `SANDBOX_OFF`) | Entry-point gate logic | ✓ VERIFIED | Present and used by `handle('scan')` in `app/main.js:440-446`. |
| `app/main.js` (`sandboxTrusted`, gated scan/probe/rip) | Gate enforcement | ⚠️ **PARTIAL** | `scan` is correctly gated (consent-per-call, never remembered). `probe`/`enqueue`/`pump()` gate on path-keyed cache presence only — see CR-01 above. |
| `app/renderer/app.js` (`requestScan`, `confirmScan`, single chokepoint) | Renderer consent flow | ✓ VERIFIED | Chokepoint traced by code review across all 6 entry points (insert, boot, drop, picker, sidebar, KEYDB retry); static test `test/unit/gate-static.test.js` guards new paths. |
| `test/e2e/scenarios.js` (`gate_insert`, `gate_drop`, `gate_pick_iso`, `gate_pick_folder`, `sec_gate_ipc`) | e2e entry-point + IPC gate coverage | ⚠️ **PARTIAL** | Entry points covered; `sec_gate_ipc` does not cover disc-swap/path-reuse (the CR-01 gap). |
| `SECURITY.md` | Fallback contact + truthful gate description | ✓ VERIFIED | Contains `rickramirez94@gmail.com`; describes the threat model, though the "asks before every scan and never remembers the answer" claim is not fully true for probe/rip (per CR-01). |
| `.github/workflows/ci.yml`, `release.yml` | SHA-pinned actions, 4 required jobs, Windows full suite | ✓ VERIFIED | Confirmed via grep and job inspection above. |
| `.c8rc.json` | Recorded coverage floor | ✓ VERIFIED | Non-zero thresholds present (85/85/88/91). |
| `app/platform.js`, `README.md`, `docs/ENCRYPTED_DISCS.md` | No libdvdcss download link / VideoLAN reference | ✓ VERIFIED | `test/unit/neutrality.test.js` exists as a repo-wide guard; manual grep confirms no link present. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `app/renderer/app.js confirmScan` | `main handle('scan')` | `userConfirmed: true` IPC arg | ✓ WIRED | Confirmed in `app/main.js:440-446`. |
| `app/main.js handle('probe')` / `enqueue()` | `scans` cache | `scans.has(src)` | ⚠️ **WIRED BUT WRONG INVARIANT** | Wired, but keyed by path not disc identity — this is the mechanism of CR-01, not a missing link. |
| `app/main.js pump()` | gate re-check before `start()` | none | ✗ **NOT WIRED** | No re-check exists (WR-08); confirmed by reading `pump()` body, lines 307-333 — no `sandboxTrusted()`/`scans` check before `start(job, ...)`. |
| `milestone/v1.0` | `ci.yml pull_request`/`push` triggers | draft PR #2, now merged | ✓ WIRED | PR #2 merged into `main` at `3fcdf1fbc0b61c9ee3f889856abfbb6089a0f285`; all four required checks (`macos`, `linux`, `windows`, `audit`) show `conclusion: success` on that commit via `gh api .../commits/.../check-runs`. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| SAFE-01 | 01-02, 01-05, 01-06, 01-07, 01-10 | Disc never scanned automatically/unsandboxed without a click | ✗ **BLOCKED** | Entry-point click-gate works; probe/rip bypass via disc-swap-at-same-path (CR-01) means the invariant does not hold for the full lifecycle of a scanned source. REQUIREMENTS.md marks this "Complete" — that marking is premature given CR-01. |
| REL-05 | 01-01, 01-05 | Private vuln reporting + SECURITY.md fallback + Dependabot | ✓ SATISFIED | Verified live via `gh api` above. |
| REL-06 | 01-03, 01-10 | SHA-pinned actions, pinned toolchains, branch protection, Electron audit | ✓ SATISFIED | Verified via grep + `gh api` branch protection + audit job content. |
| REL-08 | 01-05 | No direct libdvdcss DLL link; neutral guidance | ✓ SATISFIED | Verified via grep of README.md/platform.js. |
| QUAL-01 | 01-04, 01-09 | c8 coverage measured with recorded baseline, no regression | ✓ SATISFIED | `.c8rc.json` has non-zero thresholds; `check-coverage: true`. |
| QUAL-02 | 01-04, 01-07, 01-08 | e2e hermetic (no real AACS/dvdcss read); accurateChapters=false covered | ✓ SATISFIED | `sec_hermetic_keydirs`, `us_default_chapters` scenarios present and exercised in CI (Windows job included). |
| PLAT-01 | 01-03, 01-04, 01-09 | Windows CI runs full suite | ✓ SATISFIED | `windows` job runs `test:unit`, `test:security`, `test:engine`, `test:e2e`; green on latest merge commit. |

**No orphaned requirements** — all 7 phase requirement IDs (SAFE-01, REL-05, REL-06, REL-08, QUAL-01, QUAL-02, PLAT-01) appear in plan frontmatter and are cross-referenced in REQUIREMENTS.md.

**Note on REQUIREMENTS.md:** The traceability table already marks SAFE-01 as "Phase 1 / Complete." Given CR-01, that mark should be reverted to Pending (or flagged) until the disc-identity gap is closed — the SUMMARY/REQUIREMENTS state was written before independent verification caught the bypass.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `app/main.js` | 274, 447-451, 307-333 | Path-keyed consent cache (`scans.has(path)`) used as the sole untrusted-sandbox gate for `probe`/`enqueue`/`pump` | 🛑 BLOCKER | Directly defeats SAFE-01 / success criterion 1 on disc swap at a reused path (most likely on Windows drive letters, also on re-downloaded/synced `.iso` files). |
| `test/e2e/scenarios.js` | 268 | `sec_gate_ipc` asserts the unsafe behavior ("probe works once scanned with consent") without a companion negative test for a swapped medium | ⚠️ WARNING | The gap has zero regression coverage, so a future refactor could not even detect a fix landing or being reverted. |
| `.github/workflows/release.yml` | ~15-25, 89-107 (per 01-REVIEW.md WR-06) | Signing secrets exposed to `pull_request`-triggered builds | ⚠️ WARNING | Not in phase-1 success-criteria scope directly, but increases blast radius; carried forward from code review, not re-verified line-by-line here since it's outside SAFE-01/REL-06's phase-1 success-criteria text. |
| `test/e2e/run.js` | 57-93 (per 01-REVIEW.md WR-04/WR-05) | CI-only KEYDB sentinel gated only on `CI === 'true'`, no libaacs installed on any runner to actually exercise it | ⚠️ WARNING | Proves less than SUMMARY/docs imply about the sentinel; QUAL-02's hermeticity assertions (path-prefix checks) still hold independently of the sentinel's weakness. |

No unresolved `TBD`/`FIXME`/`XXX` debt markers found in the reviewed file set.

### Human Verification Required

None. The CR-01 gap is independently reproducible by code inspection (no running app needed): `app/main.js`'s `probe`/`enqueue`/`pump` logic is unambiguous, and the absence of a disc-swap e2e scenario is confirmed by reading `test/e2e/scenarios.js` in full. This is a clear FAILED, not an UNCERTAIN.

### Gaps Summary

Phase 1 closed most of the "worst exposure" described in its goal, and the repo/CI foundation (success criteria 2-5; REL-05, REL-06, REL-08, QUAL-01, QUAL-02, PLAT-01) is solid and independently verified — GitHub security settings are live (not just configured), branch protection requires the 4 named checks, all Actions are SHA-pinned, the README/docs are neutral, Windows CI runs the full suite including a hermetic e2e pass and a recorded, non-zero c8 coverage floor, and PR #2 has already merged cleanly to `main` with all checks green.

However, the central safety claim of the phase goal — "no disc is ever scanned unsandboxed without the user's click" — is **not fully true**. The renderer-side consent chokepoint (`requestScan` → `confirmScan` → `spinarr.scan`) is correctly built and well-tested for all 6 entry points. But the two IPC handlers that actually invoke untrusted native parsers on a previously-consented path — `probe` and `rip`/`enqueue` — authorize based on `scans.has(path)`, a cache keyed by path with no disc-identity check and no invalidation on eject or file change. `pump()` compounds this by never re-checking the gate before spawning a queued job. The practical consequence: once a user clicks "Scan anyway" for a disc at `D:\` (or an `.iso` path), any subsequent disc swapped into that same drive letter, or any file later written to that same `.iso` path, is parsed unsandboxed by `ffprobe`/`ffmpeg` with no further prompt — exactly the risk SAFE-01 exists to close. This was independently confirmed by reading `app/main.js` (not just trusting 01-REVIEW.md's narrative), and the e2e suite has no scenario that would catch a regression or prove the gap is closed.

This is classified as a BLOCKER (not a WARNING) because it falls squarely inside the phase's own goal statement and success criterion 1, and the review already rated it `critical`. Recommend returning to `/gsd:plan-phase --gaps` to add an identity-based consent check (disc/volume identity, not path) covering `probe`, `enqueue`, and a re-check inside `pump()` before `start()`, plus a companion e2e scenario (consent → eject/swap fixture at the same path → probe/rip refused) before Phase 1 is considered done.

---

_Verified: 2026-10-11_
_Verifier: Claude (gsd-verifier)_
