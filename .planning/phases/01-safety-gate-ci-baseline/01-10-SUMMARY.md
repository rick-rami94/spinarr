---
phase: 01-safety-gate-ci-baseline
plan: 10
subsystem: release
tags: [branch-protection, release, dependabot, rel-06, rel-05, safe-01]
requires:
  - "01-09: green CI with check-run names macos, linux, windows, audit"
provides:
  - "Classic branch protection on main: PR required, 0 reviews, enforce_admins, required contexts macos/linux/windows/audit, strict false, no force-push, no deletion, no linear-history requirement"
  - "PR #2 merged into main (merge commit 3fcdf1fbc0b61c9ee3f889856abfbb6089a0f285); milestone/v1.0 kept"
  - "Annotated tag v0.1.4 on the merge commit; v0.1.4 Draft release with 7 installers + SHA256SUMS.txt"
  - ".github/dependabot.yml on main, so Dependabot version updates are active"
affects:
  - "All later phases: every change to main needs a PR with the four checks green, admins included"
  - "Phase 2 (signing): v0.1.4 is still unsigned; the draft waits for the user to publish"
tech-stack:
  added: []
  patterns:
    - "Protection applied last, only after the four required contexts were SUCCESS on the PR head (D-11)"
key-files:
  created: []
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Task 1 decision: apply-strict-false"
  - "Task 3 decision: merge-and-release"
  - "Branch protection uses strict: false (branch need not be up to date with main before merge)"
  - "v0.1.4 ships unsigned as a Draft release; publishing stays with the user"
requirements: [REL-06, REL-05, SAFE-01]
metrics:
  duration: "~55 min (mostly CI and release waits)"
  completed: 2026-10-11
  tasks: 4
  files: 2
---

# Phase 1 Plan 10: Branch protection on main and v0.1.4 draft release Summary

main is protected: PRs only, four required checks, admins included. The SAFE-01 gate is merged and v0.1.4 is built as a draft release.

## Checkpoint decisions (recorded verbatim)

- **Task 1:** `apply-strict-false`
- **Task 3:** `merge-and-release`

Both were answered by the user through the orchestrator before this executor ran.

## Task 2: branch protection

Pre-check: CI run 38102268623 on PR head 023d705 showed `macos`, `linux`, `windows`, `audit` all SUCCESS. Payload written to the session scratchpad and PUT to `repos/rick-rami94/spinarr/branches/main/protection`.

Verification GET:

```
{"admins":true,"contexts":["audit","linux","macos","windows"],"del":false,"force":false,"linear":false,"reviews":0}
```

`required_status_checks.strict` = `false`. PR #2 `mergeStateStatus` after protection = `CLEAN` (no unknown-context block).

## Task 4: merge and release

1. `npm version 0.1.4 --no-git-tag-version`, committed as `chore(release): v0.1.4` (4b5d4e0, repo-local identity, no trailers), pushed to milestone/v1.0.
2. CI run 38136610725 on 4b5d4e0: `macos`, `linux`, `windows`, `audit` all SUCCESS.
3. `gh pr ready 2`, then `gh pr merge 2 --merge`. No `--admin`, no `--delete-branch`. The merge went through the protection rules.
4. PR #2 state: `MERGED`. Merge commit: `3fcdf1fbc0b61c9ee3f889856abfbb6089a0f285`. `git ls-remote --heads origin milestone/v1.0` still returns the branch.
5. `git tag -a v0.1.4 3fcdf1f... -m "v0.1.4: unsandboxed scans need a click (SAFE-01)"`, pushed.
6. Release workflow: https://github.com/rick-rami94/spinarr/actions/runs/38137733039. Result: success (linux-x64, linux-arm64, macos-arm64, macos-x64, windows-x64, release).
7. `gh release list`: `v0.1.4  Draft`. Assets: SHA256SUMS.txt, Spinarr-0.1.4-linux-amd64.deb, Spinarr-0.1.4-linux-arm64.AppImage, Spinarr-0.1.4-linux-arm64.deb, Spinarr-0.1.4-linux-x86_64.AppImage, Spinarr-0.1.4-mac-arm64.dmg, Spinarr-0.1.4-mac-x64.dmg, Spinarr-0.1.4-win-x64.exe. Not published.
8. `gh api repos/rick-rami94/spinarr/contents/.github/dependabot.yml?ref=main --jq .path` returns `.github/dependabot.yml`.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 2 | (none) | Branch protection applied through the GitHub API |
| 4 | 4b5d4e0 | chore(release): v0.1.4 |
| 4 | 3fcdf1f | Merge pull request #2 (on main, created by GitHub) |

## Deviations from Plan

None. The plan ran as written.

## Follow-ups for the user

- Publish the v0.1.4 draft when ready. It is unsigned, at the same trust level as v0.1.3. Signing is Phase 2.
- milestone/v1.0 is behind main by the merge commit only. Later phases continue on it. The next PR into main will need the four checks green.

## Self-Check: PASSED

- Protection GET matches the expected object.
- Commit 4b5d4e0 exists. Merge commit 3fcdf1f is on origin/main.
- Tag v0.1.4 is on origin. The v0.1.4 Draft release exists.
