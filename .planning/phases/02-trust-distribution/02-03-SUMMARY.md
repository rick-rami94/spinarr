---
phase: 02-trust-distribution
plan: 03
subsystem: release-docs
tags: [docs, release, immutable-releases, environments]
requirements: [REL-01, REL-02, REL-03, SAFE-10]
key-files:
  created: []
  modified: [docs/RELEASING.md, README.md, SECURITY.md]
completed: 2026-10-12
---

# Phase 2 Plan 03: Release runbook and repository trust settings Summary

Account runbook and verification guide written, the README's Gatekeeper/SmartScreen bypass advice removed, and the two repository settings the release pipeline relies on are in place.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Release runbook, verification guide, README install section, SECURITY.md fuzz flow | bd9efc0 | docs/RELEASING.md, README.md, SECURITY.md |
| 2 | `release` environment (v* tag rule) + Immutable Releases | (GitHub settings, no repo files) | — |

## Task 2 verification (2026-10-12)

Applied at Rick's direct request after the subagent's attempt was blocked by the permission check.

- `gh api repos/rick-rami94/spinarr/immutable-releases --jq .enabled` → `true`
- `gh api repos/rick-rami94/spinarr/environments/release --jq .deployment_branch_policy.custom_branch_policies` → `true`
- `gh api repos/rick-rami94/spinarr/environments/release/deployment-branch-policies --jq '.branch_policies[] | .name + ":" + .type'` → `v*:tag`

## Deviations

- Checksum examples use `--ignore-missing` so users who downloaded one installer can verify it.
- Added step 5 to "Verifying a release" (`spctl` on macOS, `Get-AuthenticodeSignature` on Windows).
- Retired secrets (Windows .pfx, Apple app-specific password) are described in words, since the acceptance check forbids their names in RELEASING.md.
- VideoLAN mentions avoid "download"/"dll" to satisfy the neutrality guard.

## Notes

- Immutable Releases is now on: a published tag name can never be reused. Rehearse with `v0.2.0-rc.N` drafts and never publish before the draft is verified.
- Apple and Azure runbook sections can be started now; they are needed by plan 02-13.

## Self-Check: PASSED
