---
phase: 01-safety-gate-ci-baseline
plan: 05
subsystem: docs-and-platform
tags: [legal, dmca, security-policy, disclosure, docs]
requires: []
provides:
  - "platform.dvdcss() without a download url; VIDEOLAN_WIN64 removed"
  - "SECURITY.md fallback contact and truthful scan-gate wording"
  - "Issue-chooser link to private security advisories"
affects:
  - app/main.js (open-dvdcss-page handler is now a no-op; plan 01-06 removes it with the renderer copy)
tech-stack:
  added: []
  patterns: ["neutral decryption guidance: package-manager commands only, no download links or site names"]
key-files:
  created: []
  modified:
    - app/platform.js
    - test/unit/platform.test.js
    - README.md
    - docs/ENCRYPTED_DISCS.md
    - SECURITY.md
    - docs/SECURITY_TESTING.md
    - .github/ISSUE_TEMPLATE/config.yml
decisions:
  - "Left app/main.js open-dvdcss-page and app/renderer/app.js VideoLAN copy for plan 01-06 (renderer half of REL-08); the handler already guards on a missing url, so it is a safe no-op meanwhile"
requirements: [REL-08, REL-05, SAFE-01, QUAL-02]
metrics:
  duration: "~10 min"
  completed: 2026-10-10
  tasks: 2
  files: 7
---

# Phase 1 Plan 05: Neutral decryption guidance and security-doc truth Summary

Removed the VideoLAN libdvdcss download URL from `app/platform.js` and every doc. The README and ENCRYPTED_DISCS now say "choose your own DLL". SECURITY.md has an email fallback for reporters and states the scan gate's limits honestly. The issue chooser links to private advisories.

## What was built

**Task 1 (TDD).**
- `VIDEOLAN_WIN64` is gone: the constant, the `url` field in `dvdcss()` on Windows (`canPick: true` kept) and the export. The header comment stays.
- New unit assertions: `win.info().dvdcss` has no `url` key, and `VIDEOLAN_WIN64` is not exported.
- New test: when `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` are empty strings, paths fall through to `$HOME/.config` and `$HOME/.cache`. This covers `keyDirs.aacsConf`, `cssCache` and `engineEnv` (D-22).
- README Windows install row: no link and no site name. README Windows sandbox row: "asks before every scan".
- ENCRYPTED_DISCS Windows paragraph: no link and no site name.

**Task 2.**
- SECURITY.md:
  - Adds `rickramirez94@gmail.com` as the fallback contact (D-17).
  - Replaces the bullet with "No unsandboxed auto-scan", which has three sub-points and states the compromised-UI-process limit.
  - Adds "asks before every scan" to the Linux-without-bwrap and Windows sentences.
- SECURITY_TESTING.md:
  - Updates the F-8 fix text (mentions SAFE-01).
  - Adds a Windows paragraph sentence.
  - Adds a new SAFE-01 row with status ⬜, to be flipped by plan 01-09.
  - Line 128 (upstream patches) is unchanged.
- `.github/ISSUE_TEMPLATE/config.yml` has a `contact_links` entry pointing to `/security/advisories/new`.

## Verification

- `npm run test:unit`: 46/46 pass.
- RED was confirmed first: the url assertion failed. The empty-XDG test passed at RED because it locks existing fallback behaviour; the plan intends it as a proof, not a new feature.
- The negative grep for libdvdcss links and VideoLAN download mentions in README.md, docs/ and app/platform.js finds nothing.
- `grep -c VIDEOLAN_WIN64 app/platform.js` = 0. "brew install libdvdcss" = 1. "pacman -S libdvdcss" = 1.
- Task 2 verify prints `ok`. "asks before every scan" appears 2 times, "compromised" 1 time, SAFE-01 in SECURITY_TESTING 2 times, and the line-128 check finds 1.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 RED | 5495f7d | test(01-05): add failing test for neutral libdvdcss guidance |
| 1 GREEN | da1eb96 | feat(01-05): drop the libdvdcss download link and neutralize decryption guidance |
| 2 | 2acc812 | docs(01-05): fallback security contact, truthful scan-gate wording, issue-chooser link |

## Deviations from Plan

None. The plan was executed as written.

## Notes for downstream plans

- `app/renderer/app.js:392-393` still says "Download libdvdcss-2.dll (64-bit) from VideoLAN" and has an "Open VideoLAN download" button (`data-action="dvdcss-page"`). `app/main.js:457` still has the `open-dvdcss-page` handler. That handler is now a no-op because `dvdcss().url` is undefined. Both belong to plan 01-06 (the renderer half of REL-08).

## TDD Gate Compliance

The RED commit (`test(...)` 5495f7d) comes before the GREEN commit (`feat(...)` da1eb96). No refactor was needed.

## Self-Check: PASSED

- All 7 modified files exist, and the edits are verified by grep.
- Commits 5495f7d, da1eb96 and 2acc812 are present in `git log`.
