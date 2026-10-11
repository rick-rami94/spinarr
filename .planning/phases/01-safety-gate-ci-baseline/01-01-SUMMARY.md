---
phase: 01-safety-gate-ci-baseline
plan: 01
subsystem: repo-settings-ci
tags: [github, ci, dependabot, vulnerability-reporting, REL-05]
requires: []
provides:
  - "Draft PR #2 milestone/v1.0 -> main (CI trigger for all phase-1 commits)"
  - "Private vulnerability reporting enabled"
  - "Dependabot alerts + Dependabot security updates enabled"
affects: [01-09, 01-10]
tech-stack:
  added: []
  patterns: ["Outward-facing GitHub actions gated behind an explicit user decision"]
key-files:
  created: []
  modified: []
decisions:
  - "Task 1 decision: approve-all (push milestone/v1.0, open draft PR, enable three security settings)"
  - "PR #2 stays draft until plan 01-10"
metrics:
  duration: "~5 min"
  completed: 2026-10-10
  tasks: 3
  files: 0
requirements: [REL-05, REL-06]  # partial: REL-05 repo settings done; SECURITY.md (01-05) and dependabot.yml (01-03) still pending
---

# Phase 1 Plan 01: GitHub-side setup (draft PR + security settings) Summary

milestone/v1.0 is published with draft PR #2 into main, so CI runs on every Phase 1 commit. Private vulnerability reporting, Dependabot alerts and Dependabot security updates are on, and each one was checked with a `gh api` GET.

## Task 1: Approval decision

User decision (via orchestrator): **approve-all**

## Task 2: Push and draft PR

- Pre-flight leak check `git ls-files | grep -iE 'spinarr-audit|SPINARR_REVIEW_HANDOFF|SPINARR_ENGINEERING_AUDIT'`: printed nothing (exit 1).
- Identity: `Rick Ramirez <30266247+rick-rami94@users.noreply.github.com>`.
- `git push -u origin milestone/v1.0`: new branch created on origin.
- PR: **#2** https://github.com/rick-rami94/spinarr/pull/2

Verification:

```
$ gh pr view milestone/v1.0 --json isDraft,baseRefName,headRefName,state --jq '[...]|@csv'
true,"main","milestone/v1.0","OPEN"
$ git ls-remote --heads origin milestone/v1.0
830e90a4811afbcbf4deb25df3e29744de6d45cd	refs/heads/milestone/v1.0
$ gh pr view milestone/v1.0 --json body --jq .body | grep -ciE 'co-authored-by|generated with'
0
$ gh pr checks milestone/v1.0
macos	pending	https://github.com/rick-rami94/spinarr/actions/runs/38098152881/job/114348293055
audit	pass	12s
linux	pending	https://github.com/rick-rami94/spinarr/actions/runs/38098152881/job/114348293078
```

`windows` was not in the list when checked. In `.github/workflows/ci.yml` the windows job has `needs: linux`, so its check run only appears after linux finishes. That is expected, not a fault.

## Task 3: Security settings (REL-05 evidence)

PUTs, in order (alerts before security fixes):

```
PUT repos/rick-rami94/spinarr/private-vulnerability-reporting -> HTTP/2.0 204 No Content
PUT repos/rick-rami94/spinarr/vulnerability-alerts           -> HTTP/2.0 204 No Content
PUT repos/rick-rami94/spinarr/automated-security-fixes       -> HTTP/2.0 204 No Content
```

Verification GETs (raw):

```
$ gh api repos/rick-rami94/spinarr/private-vulnerability-reporting --jq .enabled
true
$ gh api -i repos/rick-rami94/spinarr/vulnerability-alerts | head -1
HTTP/2.0 204 No Content
$ gh api repos/rick-rami94/spinarr/automated-security-fixes
{"enabled":true,"paused":false}
```

## Commits

Tasks 2 and 3 change only GitHub remote state, not repo files, so they have no per-task commits. The only commit is the docs commit for this SUMMARY and the state files.

## Deviations from Plan

None. The plan ran as written. The one thing to note is the windows check timing explained above.

## Self-Check: PASSED

- PR #2 is open and in draft (verified)
- origin/milestone/v1.0 exists (verified)
- All three settings report enabled / 204 / enabled (verified)
