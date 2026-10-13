---
phase: 01-safety-gate-ci-baseline
plan: 12
subsystem: security
tags: [safe-01, cr-01, wr-08, in-03, e2e, docs, gap-closure]
requires:
  - "01-11: lib.mediumIdentity, RESCAN_NOT_SCANNED/RESCAN_CHANGED, assertScanGate at probe/enqueue/pump/prepareBluray/start"
provides:
  - "e2e sec_gate_swap: folder swap after fakeEject, in-place image overwrite, queued job against a changed source (WR-08), recovery via a real consented rescan"
  - "sec_gate_ipc checks refusal reasons (/Scan the disc again/) and ends on a changed-image negative case (IN-03)"
  - "SECURITY.md consent scope and file-system-identity limit that match the code"
affects:
  - "Phase 1 re-verification of SAFE-01 truth #1 (Windows CI job must show sec_gate_swap and sec_gate_ipc passing)"
tech-stack:
  added: []
  patterns:
    - "Swap tests write only to an os.tmpdir() mkdtemp folder with try/finally cleanup; fixtures are read-only"
key-files:
  created: []
  modified:
    - test/e2e/scenarios.js
    - SECURITY.md
    - docs/SECURITY_TESTING.md
    - .planning/REQUIREMENTS.md
    - .planning/phases/01-safety-gate-ci-baseline/01-VALIDATION.md
decisions:
  - "Part 3 of sec_gate_swap cancels job A after overwriting the queued source, so the queue reaches job B fast; job A's outcome is not asserted (plan allows this)"
  - "SAFE-01 checkbox reset to unchecked (01-11 had ticked it); traceability reads 'awaiting re-verification' until the phase verifier flips it"
requirements: [SAFE-01]
metrics:
  duration: "~12 min"
  completed: 2026-10-12
  tasks: 2
  files: 5
---

# Phase 1 Plan 12: Swap-at-same-path regression and truthful consent docs Summary

The CR-01/WR-08 fix from 01-11 is now locked in by an e2e scenario that fails on the old path-keyed gate. SECURITY.md now says what the gate actually does, and where it stops.

## What was built

**Task 1: `sec_gate_swap` and a tighter `sec_gate_ipc` (test/e2e/scenarios.js).**
- `sec_gate_swap` (sandbox off, READRATE 6), all on temp copies:
  1. DVD folder: consent, probe ok, fakeEject, swap `ntsc_basic` for `pal_subs` at the same path. Probe and rip both refuse with "Scan the disc again". Nothing is queued. A real Scan anyway restores probe.
  2. ISO overwritten in place with `pal_subs.iso` bytes. Probe and rip refuse. Nothing is queued.
  3. WR-08: two jobs enqueued (feature_disc title 4, then the queued copy). While job A rips, the queued copy is overwritten. Job A is then cancelled. Job B ends `failed` with "Scan the disc again" and writes no `swap-queued*` file.
- `sec_gate_ipc` now matches `/Scan the disc again/` on the unscanned probe and rip refusals. Its positive control runs on a temp copy, and is followed by appending one byte and checking that probe refuses ("consent does not survive a change to the image").

**Task 2: docs.**
- SECURITY.md: a sub-bullet says a yes covers only that disc or image as scanned. The limit paragraph names the file-system identity check (volume serial or device, file IDs, sizes, timestamps, no content hash), says an eject always clears the answer, and keeps the compromised-UI caveat.
- docs/SECURITY_TESTING.md: new coverage row for `sec_gate_swap` (SAFE-01).
- 01-VALIDATION.md: new map row under the sec_gate_ipc row.
- REQUIREMENTS.md: SAFE-01 is back to `[ ]`. Traceability reads "In Progress (gap CR-01 fixed in 01-11/01-12; awaiting re-verification)".

## Verification

- `node test/e2e/run.js sec_gate_swap sec_gate_ipc gate_insert gate_drop gate_pick_iso gate_pick_folder`: 6/6 PASS.
- **Regression proof:** handle('probe')'s `assertScanGate(src);` was swapped for the pre-fix `if (!sandboxTrusted() && !scans.has(src)) throw new Error('Scan the disc first');` in the working tree only. Result: `sec_gate_swap` FAILED (0/1) at the part 1 probe of the swapped folder (scenarios.js:316, `true !== false`). After `git checkout -- app/main.js` it PASSED (1/1). `git diff --exit-code --stat app/main.js` was empty. The reverted state was never committed. I ran the proof twice, once before and once after the final test edit.
- `npm run test:unit`: 63 pass, 0 fail (neutrality test still passes over the edited docs).
- `npm run test:coverage`: exit 0 (branches 92.4, functions 88.7, lines 85.59).
- Full local e2e on macOS: `node test/e2e/run.js` 33/33 passed.
- Grep acceptance: `sec_gate_swap` in scenarios.js (1), "Scan the disc again" (7), the old "probe works once the source was scanned with consent" is gone, and no write targets are built from `h.fx(`/`FX`.
- Still open: the milestone branch CI `windows` job, where the gate always applies, must show sec_gate_swap and sec_gate_ipc passing before SAFE-01 is re-verified.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | c733634 | test(01-12): add sec_gate_swap regression and tighten sec_gate_ipc |
| 2 | 54ec98d | docs(01-12): make SECURITY.md consent scope and limit match the code |

## Deviations from Plan

- **Part 3 cancels job A** after the overwrite rather than letting it run to completion. This keeps the scenario short (about 6s) and avoids depending on title 4's rip length under READRATE 6. The plan only requires that job A not be `queued`, which is still asserted.
- **Small refusal helper** in sec_gate_swap for part 1. Part 2's asserts are inline, so the literal-count grep (≥6) holds.
- **REQUIREMENTS.md checkbox fix:** 01-11 had ticked SAFE-01 `[x]`. It is reset to `[ ]`, as the plan requires.

## Known Stubs

None.

## Threat Flags

None. Test and doc changes only. T-01-37 (revert-and-fail proof), T-01-38 (wording matches the code) and T-01-39 (temp copies only) are mitigated as planned.

## Self-Check: PASSED

- FOUND: test/e2e/scenarios.js, SECURITY.md, docs/SECURITY_TESTING.md, .planning/REQUIREMENTS.md, 01-VALIDATION.md
- FOUND commits: c733634, 54ec98d
