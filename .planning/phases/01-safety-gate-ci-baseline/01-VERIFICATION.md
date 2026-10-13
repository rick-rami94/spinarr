---
phase: 01-safety-gate-ci-baseline
verified: 2026-10-12T21:55:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Round-3 CR-01 (traverse-only / unreadable walked directory froze the Blu-ray or DVD fingerprint while libbluray/libdvdread could still open the files by name). CLOSED by plan 01-15: app/lib.js's mediumIdentity walk now treats only ENOENT/ENOTDIR as absent ('<rel>|missing'/'<relName>|gone'); every other readdir/stat error (EACCES, EPERM, EIO, ELOOP, codeless) throws IDENTITY_UNREADABLE at all three catch sites (recurse-mode top-level probe, readdir, per-entry stat). Independently confirmed in this pass by: (1) reading app/lib.js and confirming no unconditional `catch { lines.push }` remains; (2) running `node --test test/unit/lib.test.js` (56/56 pass, including the two real chmod-0o311 tests which ran for real, not skipped); (3) a from-scratch repro script (not reusing any prior script) against a temp copy of test/fixtures/out/bd_movie: chmod 0o311 BDMV *before* computing identity -> mediumIdentity throws IDENTITY_UNREADABLE; a consented scan while readable, then chmod 0o311 + in-place edit of BDMV/index.bdmv -> mediumIdentity throws (identity goes from a valid hash to a throw, satisfying 'differs or throws'); (4) confirming engine/bin/bdinfo still fully parses the same traverse-only tree (4 titles printed, exit 0), proving the original bypass vector (engine needs only search/execute, not read) is real and that the fix closes exactly that gap without over-restricting the engine; (5) running `node test/e2e/run.js sec_gate_unlistable sec_gate_inplace sec_gate_swap sec_gate_ipc gate_insert gate_drop gate_pick_iso gate_pick_folder us_bluray_rip` locally: 9/9 PASS, including sec_gate_unlistable's coverage of both the post-scan chmod case and the exact 01-VERIFICATION repro (BDMV traverse-only before the scan)."
  gaps_remaining: []
  regressions: []
---

# Phase 01: Safety Gate & CI Baseline Verification Report

**Phase Goal:** The worst exposure is closed immediately (no disc is ever scanned unsandboxed without the user's click), and the repo and CI are in a state that later phases can safely build on.
**Verified:** 2026-10-12T21:55:00Z
**Status:** passed
**Re-verification:** Yes — after round-3 gap closure (plan 01-15) and round-3 re-review (01-REVIEW.md, commit dc225e2: 0 critical, CR-01 resolved, no new bypass class)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | No disc is ever scanned unsandboxed without the user's click; e2e covers every scan entry point | ✓ **VERIFIED** | Round-1 (path-keyed consent), round-2 (identity coverage gaps) and round-3 (readdir fail-open on unreadable-but-traversable directories) are all closed. Independently reproduced in this pass (not trusted from SUMMARY/REVIEW narrative) with a fresh repro script: `chmod 0o311` on `BDMV` *before* computing identity makes `mediumIdentity` throw `IDENTITY_UNREADABLE`; a consented scan followed by `chmod 0o311` + an in-place edit of `BDMV/index.bdmv` makes a second call throw (identity goes from a stable hash to a throw — satisfies "differs or throws"). Confirmed `engine/bin/bdinfo` still parses the same traverse-only tree fully (4 titles, exit 0), proving the fix closes the real gap (engine needs search, not read) without breaking the engine. `node --test test/unit/lib.test.js`: 56/56 pass (chmod tests ran for real, not skipped, as a non-root macOS user). `node test/e2e/run.js sec_gate_unlistable sec_gate_inplace sec_gate_swap sec_gate_ipc`: 4/4 PASS; full set including `gate_insert gate_drop gate_pick_iso gate_pick_folder us_bluray_rip`: 9/9 PASS. The round-3 re-review (01-REVIEW.md, commit `dc225e2`) traced every error path in `mediumIdentity` and found 0 critical issues and no new bypass class. |
| 2 | Private vuln reporting, SECURITY.md fallback contact, Dependabot alerts/update PRs active | ✓ VERIFIED (live-checked) | `gh api repos/rick-rami94/spinarr/private-vulnerability-reporting --jq .enabled` → `true`. `SECURITY.md` contains `rickramirez94@gmail.com` as fallback contact (line 7). Unaffected by 01-15. |
| 3 | Every GH Action pinned by SHA; toolchains pinned; main rejects merges without required checks; audit covers Electron | ✓ VERIFIED (live-checked) | `grep -nE "uses:\s" .github/workflows/*.yml \| grep -vE "@[a-f0-9]{40}"` returns nothing. `gh api repos/rick-rami94/spinarr/branches/main/protection --jq '.required_status_checks.contexts'` → `["macos","linux","windows","audit"]`. Unchanged by 01-15. |
| 4 | README has no direct libdvdcss DLL link; setup guidance neutral; nothing shipped/fetched | ✓ VERIFIED | `grep -i "libdvdcss\|videolan" README.md` shows only neutral package-manager commands and the Windows "choose your own DLL" wording, no URL. `npm run test:unit` includes `neutrality.test.js`'s 2 tests, both passing. Unchanged by 01-15. |
| 5 | CI on Windows runs full suite; e2e never reads real AACS/dvdcss folders and covers accurateChapters=false; c8 baseline recorded and fails on regression | ✓ **VERIFIED** (Windows CI result now complete, not pending) | `.github/workflows/ci.yml` windows job runs `test:unit`, `test:security`, `test:engine`, `test:e2e` (confirmed by reading the job steps, lines 37-84). `sec_hermetic_keydirs` and `us_default_chapters` (`accurateChapters: false`) are present in `test/e2e/scenarios.js`. Locally: `npm run test:coverage` → 191/191 pass, 87.06% lines / 93.01% branches / 89.39% functions / 87.06% statements, all above the `.c8rc.json` floor (85/91/88/85). CI for the actual code-complete commit `cc5c35d` (head of plan 01-15, before the docs-only re-review commit `dc225e2` which is unpushed): watched to completion in this verification pass — `audit`, `macos`, `linux` and `windows` all `completed`/`success`; overall run conclusion `success`. This resolves the prior round's "Windows in_progress, treated as pending" caveat. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `app/lib.js` (`mediumIdentity`, `IDENTITY_WALK`, `IDENTITY_UNREADABLE`, `IDENTITY_TOO_MANY`, `identityRefusal`, `absentCode`) | Fail-closed filesystem identity on every error path | ✓ VERIFIED | Read in full (lines 190-320). `absentCode(err)` is true only for ENOENT/ENOTDIR. All three catch sites (recurse-mode top-level probe, `readdir`, per-entry `stat`) throw `IDENTITY_UNREADABLE` for anything else. `grep -n "catch { lines.push"` returns nothing. `identityRefusal` exported and used. |
| `app/main.js` (`scan`, `identityOf`, `assertScanGate`, `revalidateScans`) | Pass the real refusal reason through; gate enforced at every spawn site | ✓ VERIFIED | `scan()`'s first catch passes `IDENTITY_TOO_MANY`/`IDENTITY_UNREADABLE` through verbatim. `assertScanGate` computes identity, compares, and on mismatch calls `lib.identityRefusal(failure)` (always prefixed "Scan the disc again"). Gate call sites (probe, enqueue, pump, prepareBluray, start) unchanged from prior rounds — confirmed by reading the file. |
| `test/unit/lib.test.js` | chmod 0o311 tests, injected-error tests, optional-dir test, identityRefusal test | ✓ VERIFIED | `node --test test/unit/lib.test.js`: 56/56 pass. Two real chmod-0o311 tests ran (not skipped) on macOS as a non-root user. `grep -c "0o311"` ≥ 2, `getuid` and `win32` skip guards present. |
| `test/e2e/scenarios.js` (`sec_gate_unlistable`) | e2e regression for traverse-only directories, both post-scan and pre-scan (the exact 01-VERIFICATION repro) | ✓ VERIFIED | Read in full. `platforms: ['darwin', 'linux']`, skips as root, covers both the post-consent chmod+edit case and the pre-scan traverse-only case (the scenario shape independent verification shows matches the round-3 repro exactly). `node test/e2e/run.js sec_gate_unlistable`: PASS. |
| `SECURITY.md` | Truthful, best-effort-not-sandbox description with the three residuals disclosed and scoped to SF-1 | ✓ VERIFIED | Read in full (lines 1-60). Contains "best-effort guard, not a sandbox", all three residuals ((a) lazy re-reads, (b) crafted clip_id names, (c) same-size rewrite with restored timestamps), "tracked as SF-1". `grep` confirms "No disc reader opens them", "everything under BDMV" and "more than 20,000 files" are gone. |
| `.planning/REQUIREMENTS.md` | SAFE-05 carries the SAFE-01 residual note; SAFE-01 traceability reflects the fix and residual scoping | ✓ VERIFIED | Line 17: SAFE-05 sub-bullet "Must also close the SAFE-01 residual: ... (01-REVIEW.md WR-10, WR-08, T-01-44; disclosed in SECURITY.md)". Line 140: SAFE-01 traceability "In Progress (traverse-only bypass fixed in 01-15; residual documented and scoped to SF-1 / SAFE-05; awaiting re-verification)" — accurate as of before this report; this verification is what resolves "awaiting re-verification" (not self-ticked by this verifier per instructions). |
| `.planning/ROADMAP.md` | Phase 4 carries the SAFE-01 residual | ✓ VERIFIED | Line 129: "**Carries**: the SAFE-01 residual from Phase 1 ... The Windows sandbox (SAFE-05, SF-1) and the Linux no-bwrap path must remove it; see SECURITY.md." Phase 1 line (16) still `- [ ]`, correctly left for the orchestrator to update post-verification. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `app/main.js scan()` / `assertScanGate` / `revalidateScans` | `lib.mediumIdentity` | identity captured before/after, checked at every spawn site | ✓ WIRED | Confirmed by reading app/main.js; gate call sites unchanged from prior rounds. |
| `lib.mediumIdentity` readdir/stat catches | `app/main.js identityOf` / `assertScanGate` | throw → null identity → RESCAN refusal | ✓ WIRED | `absentCode` gate on every catch site; `identityRefusal` names the real reason in the thrown message. Independently reproduced (see Truth #1). |
| `test/e2e/scenarios.js sec_gate_unlistable` | `app/lib.js mediumIdentity` | traverse-only directory, pre- and post-scan | ✓ WIRED | e2e scenario exercises exactly the engine-can-read / identity-can't-list asymmetry; PASS locally. |
| `engine/bin/bdinfo` (unsandboxed parser) | consented BDMV tree | search-only (execute-bit) access | ✓ CONFIRMED STILL WORKS | `bdinfo` on the traverse-only (0o311) tree returns the full 4-title JSON, exit 0 — this is the mechanism the fix defends against, confirmed still present and now correctly refused at the identity layer rather than accidentally blocked at the engine layer. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| SAFE-01 | 01-02, 01-05, 01-06, 01-07, 01-10, 01-11, 01-12, 01-13, 01-14, 01-15 | Disc never scanned automatically/unsandboxed without a click | ✓ **SATISFIED** | Round-1, round-2 and round-3 bypasses are all closed and independently re-confirmed in this pass. The three accepted residuals (lazy re-reads, crafted clip_id names, same-size rewrite) are explicitly scoped to SF-1/SAFE-05 per the locked user decision, and that scoping is documented accurately in SECURITY.md, REQUIREMENTS.md, and ROADMAP.md (verified above). REQUIREMENTS.md line 12 remains `- [ ]` — this verifier does not self-tick it per instructions, but the evidence here supports marking it complete. |
| REL-05 | 01-01, 01-05 | Private vuln reporting + SECURITY.md fallback + Dependabot | ✓ SATISFIED | Live-checked this pass. |
| REL-06 | 01-03, 01-10 | SHA-pinned actions, pinned toolchains, branch protection, Electron audit | ✓ SATISFIED | Live-checked this pass. |
| REL-08 | 01-05 | No direct libdvdcss DLL link; neutral guidance | ✓ SATISFIED | Verified this pass. |
| QUAL-01 | 01-04, 01-09, 01-13, 01-15 | c8 coverage measured with recorded baseline, no regression | ✓ SATISFIED | Independently re-ran `npm run test:coverage`: 191/191 pass, all metrics above floor. |
| QUAL-02 | 01-04, 01-07, 01-08, 01-14 | e2e hermetic (no real AACS/dvdcss read); accurateChapters=false covered | ✓ SATISFIED | `sec_hermetic_keydirs`, `us_default_chapters`, `sec_gate_inplace`, `sec_gate_unlistable` all present and passing. |
| PLAT-01 | 01-03, 01-04, 01-09 | Windows CI runs full suite | ✓ **SATISFIED** | Windows CI run for head `cc5c35d` watched to completion in this verification pass: `success`. All 4 required jobs (`macos`, `linux`, `windows`, `audit`) green on the actual code-complete commit. |

**No orphaned requirements** — all 7 phase requirement IDs (SAFE-01, REL-05, REL-06, REL-08, QUAL-01, QUAL-02, PLAT-01) appear in plan frontmatter (across 15 plans) and are cross-referenced in REQUIREMENTS.md.

### Accepted Residuals (locked user decision, 2026-10-12)

These are explicitly **not** gaps for Phase 1. They apply only to an attacker who already has write access to a folder/image the user has consented to scan, and are scoped to the engine-sandbox work (SAFE-05 / SF-1, Phase 4):

| # | Residual | Documented at | Traced to Phase 4 / SAFE-05? | Accurate? |
|---|---|---|---|---|
| (a) | Lazy re-reads by the unsandboxed engine after the spawn-time check — the engine keeps opening files for the whole rip after the last gate check passes | `SECURITY.md` "Known limit" bullet 1; `app/lib.js:212-215` comment | Yes — `REQUIREMENTS.md:17` (SAFE-05 sub-bullet), `ROADMAP.md:129` (Phase 4 "Carries" line) | Yes — matches `main.js start()` being the last check before spawn |
| (b) | A crafted Blu-ray playlist can name clip files the fingerprint skips (hidden dot-names reachable via a 5-byte `clip_id`) | `SECURITY.md` bullet 2; `app/lib.js` `identityIgnored` comment | Yes — same REQUIREMENTS.md/ROADMAP.md lines, citing WR-08 | Yes — confirmed via source citations in 01-REVIEW.md (`mpls_parse.c`, `navigation.c`) |
| (c) | A same-size rewrite with timestamps restored looks unchanged to the metadata fingerprint | `SECURITY.md` bullet 3 | Yes — same lines, citing T-01-44 | Yes |

The round-3 re-review (01-REVIEW.md, 0 critical findings) independently confirmed all three residual descriptions are accurate and found no additional bypass class beyond them.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `app/main.js` | 239 (`assertScanGate`) | `sandboxTrusted()` short-circuits before any identity check, so a stale Blu-ray scan can still be reused on the sandboxed path (WR-09, carried, open) | ⚠️ WARNING | Correctness issue on the trusted-sandbox path, not a SAFE-01 safety breach on the unsandboxed path this phase is scoped to close. Not fixed by 01-15 (explicitly out of scope per the locked decision: "No hardening beyond this"). |
| `app/main.js` | ~395 (`start()`) | The same-disc check runs only at spawn, not continuously during the rip (WR-10) | ℹ️ INFO (accepted residual a) | Disclosed in SECURITY.md and traced to SF-1/SAFE-05; not a Phase 1 blocker per locked decision. |
| `.github/workflows/release.yml` | ~15, 93-99 | Signing secrets exposed to `pull_request`-triggered builds (WR-06, carried, open) | ⚠️ WARNING | Outside Phase 1's SAFE-01/REL-06 success-criteria text; unchanged this round. |
| `app/renderer/app.js` | 759-764, 430-442 | Consent prompt can outlive an eject on Windows/Linux (WR-02, carried, open) | ⚠️ WARNING | Unchanged this round; non-blocking for this phase's success criteria. |
| `app/renderer/app.js` | 474-487, 557-559 | Refusals dead-end in the UI; no "scan again" action (WR-12, carried, open) | ⚠️ WARNING | UX gap, not a safety gap; carried unchanged. |
| `.github/workflows/ci.yml`:37, `test/e2e/run.js` | — | CI sentinel never exercises libaacs for real (WR-04); sentinel cleanup gap on SIGINT/SIGTERM (WR-05) | ⚠️ WARNING | Both carried, open; outside this phase's SAFE-01 scope. |
| `.github/workflows/release.yml`:70-76 | — | `setup-msys2` caches by default despite "no caches" comment (WR-07) | ⚠️ WARNING | Carried, open; informational. |

No unresolved `TBD`/`FIXME`/`XXX` debt markers found in `app/lib.js`, `app/main.js`, `test/unit/lib.test.js`, `test/e2e/scenarios.js`, or `SECURITY.md` (grep-confirmed, clean).

**Carried, non-blocking warnings (confirmed still open, explicitly out of scope for this gap-closure round per the locked decision):** WR-01, WR-02, WR-03, WR-04, WR-05, WR-06, WR-07, WR-09, WR-11 (minor residual: SECURITY.md's closing sentence names Windows/SF-1 but not Linux-without-bwrap/SF-7 as also lacking the sandbox), WR-12. None of these defeat the phase's core invariant (no disc scanned unsandboxed without a click); they are UX, CI-hygiene, or defense-in-depth items correctly deferred to later phases or left as backlog.

### Human Verification Required

None. The round-3 fix is independently reproducible by direct code inspection, a from-scratch repro script run against the real `app/lib.js` and `engine/bin/bdinfo`, local unit/e2e runs, and a watched-to-completion CI run on the actual commit — all verifiable programmatically. There is no Intel-Mac real-drive manual pass scoped to this phase (that work belongs to later phases involving physical optical media and VM USB passthrough); it does not block Phase 1's success criteria, which concern the software-only consent/identity gate.

### Gaps Summary

No gaps. The round-3 CR-01 (traverse-only / unreadable directory silently freezing the fingerprint while the unsandboxed engine could still read the files by name) is closed and independently re-confirmed. The three residuals that remain — lazy re-reads during a rip, crafted playlist clip-id names, and same-size-rewrite-with-restored-timestamps — are not gaps under the locked user decision: they require write access to an already-consented folder, they are accurately disclosed in SECURITY.md, and they are explicitly traced to the engine-sandbox work (SAFE-05 / SF-1, Phase 4) in both REQUIREMENTS.md and ROADMAP.md. The round-3 re-review (01-REVIEW.md) found 0 critical issues and confirmed no new bypass class. Windows CI, previously `in_progress` and treated as pending, was watched to completion in this verification pass and is green for the actual code-complete commit (`cc5c35d`). All 7 phase requirement IDs are satisfied. Remaining carried warnings (WR-01 through WR-12, excluding the three accepted/transferred residuals) are non-blocking UX/CI-hygiene items correctly left open for later phases or backlog, consistent with three successive reviews' disposition of them.

---

_Verified: 2026-10-12T21:55:00Z_
_Verifier: Claude (gsd-verifier)_
