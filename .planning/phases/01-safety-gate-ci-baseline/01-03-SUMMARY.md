---
phase: 01-safety-gate-ci-baseline
plan: 03
subsystem: ci
tags: [ci, supply-chain, github-actions, zizmor, dependabot, coverage, windows]
requires: []
provides:
  - SHA-pinned ci.yml and release.yml (node24 action majors)
  - .nvmrc (Node 22.23.3)
  - hash-pinned meson and zizmor requirements files
  - Dependabot version updates (npm + github-actions)
  - Windows full suite against a verified independent ffmpeg oracle
  - Linux-only c8 coverage wiring (expects npm run test:coverage from plan 01-04)
affects: [01-04, 01-09, 01-10]
tech-stack:
  added: [zizmor 1.30.1 (CI), meson 1.12.1 (hash-pinned), GyanD ffmpeg 8.1.2 essentials (Windows test oracle)]
  patterns: [SHA pins with "# vX.Y.Z" comments, --require-hashes pip installs, no caches in publishing workflows]
key-files:
  created:
    - .nvmrc
    - .gitattributes
    - .github/dependabot.yml
    - .github/requirements-build.txt
    - .github/requirements-audit.txt
  modified:
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
decisions:
  - "Pinned to the latest node24 majors (checkout v7, setup-node v7, cache v6, upload v7, download v8), not the old v4 node20 pins"
  - "setup-node v7 caches by default: release.yml and the audit job set package-manager-cache: false explicitly"
  - "Windows oracle: only the zip is cached; SHA-256 recomputed every run and a bad zip is deleted before throwing"
metrics:
  duration: ~20 min
  completed: 2026-10-10
  tasks: 2
  files: 7
---

# Phase 1 Plan 03: CI and release workflow hardening Summary

Both workflows are now SHA-pinned to node24 action majors, with hash-pinned meson and zizmor and pinned runners. release.yml restores no caches. Linux runs c8. Windows runs unit, security, engine and e2e against a SHA-256-verified independent ffmpeg. The audit job fails on any Electron advisory and runs zizmor.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Toolchain pin files, Dependabot, .gitattributes, pinned cache-free release.yml | d38144c |
| 2 | ci.yml rewrite: pins, c8 on Linux, Windows full suite, Electron audit + zizmor | e6ccf1a |

## Re-verified pins (2026-10-10)

Each was resolved with `gh api repos/<repo>/commits/<tag>` and matches the research table. `action.yml` at each SHA declares `runs.using: node24`.

| Action | SHA | Tag |
|---|---|---|
| actions/checkout | 3d3c42e5aac5ba805825da76410c181273ba90b1 | v7.0.1 |
| actions/setup-node | 949feb2413d6458794dcd2491c4babbbce0c15c1 | v7.1.0 |
| actions/cache | 55cc8345863c7cc4c66a329aec7e433d2d1c52a9 | v6.1.0 |
| actions/upload-artifact | cf430e030ddbb5b0abf93d22962f4752f3646cd9 | v7.0.2 |
| actions/download-artifact | 9000827ccba6bdab643e8b6fd33ac0654aef8333 | v8.0.2 |
| msys2/setup-msys2 | ec48f7c5447b3140e2b088413ae3a55687bccb6e | v2.33.0 |
| softprops/action-gh-release | efb35369e0ad2afab669f228072c1b0d510eae64 | v3.0.3 |

Toolchains:
- **Node:** 22.23.3 (`.nvmrc`).
- **meson:** 1.12.1. The wheel sha256 `930bc754...8b02` was re-confirmed from the PyPI JSON.
- **zizmor:** 1.30.1, with all 11 file digests from the PyPI JSON. The scratch-venv install of this exact file with `--require-hashes` succeeded.
- **Windows oracle zip:** the GitHub API digest `sha256:db580001...584a2ec` matches.

## zizmor (local, 1.30.1, scratch venv)

`zizmor --offline --format plain --min-severity medium .github/workflows`, exit 0:

```
No findings to report. Good job! (1 ignored, 17 suppressed)
```

At all severities there is a single informational finding, `superfluous-actions` on softprops/action-gh-release, which was expected per research. The repo has no `# zizmor: ignore` comments. The online audits (impostor-commit, known-vulnerable-actions) were not run locally because the sandbox refused the token-passing command. CI runs them with `GH_TOKEN: ${{ github.token }}`.

## Verification

- Task 1 verify printed `ok`, with 11 hashes. YAML parses for dependabot.yml and release.yml. `contents: write` appears once, under `release:`. There are 2 `package-ecosystem` entries.
- Task 2 verify printed `ok`. Job ids are `['audit', 'linux', 'macos', 'windows']` and none has a `name:` key. The count of `ORACLE_FFMPEG_DIR: ${{ github.workspace }}` is 0. The D-21 test-only comment sits directly above the brew install.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] setup-node v7 enables npm caching implicitly**
- **Found during:** Task 2 zizmor run.
- **Issue:** Removing `cache: npm` from release.yml was not enough. setup-node v5+ auto-caches when package.json declares a package manager. zizmor still reported high `cache-poisoning` at release.yml.
- **Fix:** Added `package-manager-cache: false` to the release.yml setup-node and, for consistency with the plan's "no cache", to the audit job.
- **Files modified:** .github/workflows/release.yml, .github/workflows/ci.yml
- **Commit:** e6ccf1a

**2. [Rule 2 - Hardening] matrix.target moved to an env var in release.yml Package step**
- **Issue:** `${{ matrix.target }}` was expanded straight into the shell script, which is the template-injection pattern. The values are static here, so this is hygiene only.
- **Fix:** The value is now passed as `TARGET` env and split deliberately.
- **Commit:** d38144c

**3. Comment wording**
- A comment in release.yml originally contained the literal text `cache: npm`, which the plan's verify regex rejects. I reworded it.

## Notes for downstream plans

- `npm run test:coverage` and `.c8rc.json` come from plan 01-04. Until both land, the linux job would fail at that step. Both must merge before the first push (plan 01-09).
- The Windows `test:engine` step depends on the engine tests' `.exe` existence checks (RESEARCH Pattern 7 step 3). That is not in this plan's files; it is owned by another plan in this phase.
- The Windows oracle step prints `ffmpeg -version` as a sanity check. Assumption A7 is unverified: the essentials build may lack a decoder the oracle needs. If so, switch to `full_build` and update the URL and hash together.

## Self-Check: PASSED

- All five created files and both modified workflows exist in the worktree.
- Commits d38144c and e6ccf1a exist on the worktree-agent branch.
