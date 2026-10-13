---
phase: 01-safety-gate-ci-baseline
plan: 14
subsystem: security
tags: [safe-01, cr-01, wr-08, wr-10, in-05, e2e, docs, gap-closure]
requires:
  - "01-13: lib.mediumIdentity full coverage, OS-metadata filter, IDENTITY_TOO_MANY cap"
  - "01-12: sec_gate_swap conventions (temp copies, local refused() helper)"
provides:
  - "sec_gate_inplace e2e scenario: in-place edits with the root inode held constant are refused by probe and rip; OS metadata is not"
  - "SECURITY.md same-disc wording that matches the code (coverage, ignored names, 20,000 cap, size+timestamp residual, Windows polling caveat)"
affects:
  - "Phase 1 re-verification of SAFE-01 truth #1"
  - "Windows CI job must show sec_gate_inplace / sec_gate_swap / sec_gate_ipc passing before SAFE-01 is re-verified"
tech-stack:
  added: []
  patterns:
    - "Root-inode equality assertions so an e2e proves the per-file fingerprint, not a folder replacement, triggers the refusal"
key-files:
  created: []
  modified:
    - test/e2e/scenarios.js
    - SECURITY.md
    - docs/SECURITY_TESTING.md
    - .planning/REQUIREMENTS.md
    - .planning/phases/01-safety-gate-ci-baseline/01-VALIDATION.md
    - .planning/ROADMAP.md
decisions:
  - "SAFE-01 stays [ ] in REQUIREMENTS.md, traceability 'In Progress (identity coverage gap fixed in 01-13/01-14; awaiting re-verification)'"
  - "ROADMAP Phase 1 top-level line set back to [ ] without '(completed ...)'; the verifier flips it after re-verification"
requirements: [SAFE-01]
metrics:
  duration: "~6 min"
  completed: 2026-10-12
  tasks: 2
  files: 6
---

# Phase 1 Plan 14: In-place-edit e2e regression and truthful same-disc docs Summary

`sec_gate_inplace` adds a root-level `VTS_01_0.IFO` to a consented DVD folder and rewrites `BDMV/BACKUP/PLAYLIST/00000.mpls` in place in a consented Blu-ray folder. The folder's root inode stays the same each time. Probe and rip both refuse with "Scan the disc again" and nothing gets queued. `.DS_Store` and `._` files do not block. SECURITY.md now says which files the check covers and states its limits honestly.

## Tasks

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | sec_gate_inplace e2e scenario (in-place edits, same root inode) | f735049 | test/e2e/scenarios.js |
| 2 | SECURITY.md wording, test catalog and traceability | d174ba9 | SECURITY.md, docs/SECURITY_TESTING.md, .planning/REQUIREMENTS.md, 01-VALIDATION.md, .planning/ROADMAP.md |

## Regression proof (WR-10)

Pre-01-13 `app/lib.js` = `39bbe5c` (the last commit before `fa8805a fix(01-13)`).

- **Old lib.js, scenario as committed:** FAIL. The failure came at the OS-metadata step, which is earlier than the plan predicted: "OS metadata files do not invalidate consent: ... Scan the disc again". The old walk fingerprinted dot files inside VIDEO_TS, so writing `.DS_Store` / `._VTS_01_1.VOB` already broke consent. That is the WR-08 half of 01-13.
- **Old lib.js, diagnostic run with the three metadata writes removed (working-tree only, never committed):** FAIL at the root-level IFO step. `refused(probe after a root-level IFO was added)` got `ok: true`, so the old identity accepted the added root IFO. That is the CR-01 / WR-10 half.
- **01-13 lib.js (restored with `git checkout -- app/lib.js`):** PASS. `git diff --exit-code --stat app/lib.js` came back empty both times, and the scenario file was restored from a scratchpad backup before the commit (the committed version still contains the metadata writes).
- The Blu-ray BACKUP step was not run separately against the old code. The 01-13 RED unit tests already show the old identity missed BACKUP rewrites.

## Verification

- `node test/e2e/run.js sec_gate_inplace sec_gate_swap sec_gate_ipc`: 3/3 PASS.
- `node test/e2e/run.js sec_gate_inplace sec_gate_swap sec_gate_ipc gate_insert gate_drop gate_pick_iso gate_pick_folder us_bluray_rip`: 8/8 PASS.
- Full local `node test/e2e/run.js` on macOS: 34/34 PASS (sec_gate_inplace included).
- `npm run test:unit`: 73/73 pass, so neutrality.test.js still passes on the edited docs. `npm run test:coverage`: exit 0.
- Task 2 acceptance greps: "An eject always clears the answer" 0; "never remembers" 1; "changed since", BACKUP, CERTIFICATE, AACS, DS_Store, 20,000, "every few seconds", "volume serial" all match. SAFE-01 is still `- [ ]`, and its traceability row has `01-13/01-14` and `awaiting re-verification`. ROADMAP has no `[x] **Phase 1:` and no "completed" on the Phase 1 line.
- `git status --porcelain test/fixtures`: empty.

## Deviations from Plan

None. The plan was executed as written. The only difference from the plan's expectation is where the old code fails (the metadata step instead of the IFO step). A diagnostic run, recorded above, covered the IFO step separately.

## Known Stubs

None.

## Open items

- Windows CI (`windows` job on milestone/v1.0) must show sec_gate_inplace, sec_gate_swap and sec_gate_ipc passing before SAFE-01 is re-verified. That is the platform where the gate always applies. Not run here.
- SAFE-01 and the Phase 1 roadmap line stay unchecked until /gsd:verify-work re-checks truth #1.

## Self-Check: PASSED

- FOUND: test/e2e/scenarios.js, SECURITY.md, docs/SECURITY_TESTING.md
- FOUND: f735049, d174ba9
- Roadmap note: `roadmap update-plan-progress` re-ticked the Phase 1 line and set the progress row to Complete once all 14 summaries existed. Both were reverted by hand: the line is back to `- [ ]` and the row reads "Awaiting re-verification". The SDK also wrote a wrong `stopped_at` (01-08) and `completed_phases: 1` into STATE.md, and both were corrected. `requirements.mark-complete` was intentionally not run for SAFE-01.
