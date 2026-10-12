---
phase: 1
slug: safety-gate-ci-baseline
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 22 in CI) + custom Electron e2e harness (`test/e2e/run.js`) |
| **Config file** | none for node:test; `.c8rc.json` (new, Wave 0) |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm test`; Linux CI: `npm run test:coverage && xvfb-run -a npm run test:e2e` |
| **Estimated runtime** | ~1 s unit; ~5–20 s per e2e scenario; full suite a few minutes |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit` plus the specific e2e scenarios touched (`node test/e2e/run.js <names>`)
- **After every plan wave:** Run `npm test` locally, push to the draft PR so CI runs on macOS, Linux, Windows
- **Before `/gsd:verify-work`:** CI green on `macos`, `linux`, `windows`, `audit` with coverage floor enforced; branch protection verified via API
- **Max feedback latency:** 60 seconds (local)

---

## Per-Task Verification Map

Filled in from PLAN.md task IDs during execution. Requirement → test map from RESEARCH.md:

| Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|-----------------|-----------|-------------------|-------------|--------|
| SAFE-01 | `scanGate` / `validateScanOptions` truth table | unit | `node --test test/unit/lib.test.js` | ✅ file, ❌ cases | ⬜ pending |
| SAFE-01 | `spinarr.scan(` only in `requestScan`/`confirmScan` | unit (static) | `node --test test/unit/gate-static.test.js` | ❌ W0 | ⬜ pending |
| SAFE-01 | insert / drop / picker-ISO / picker-folder: no scan before click | e2e | `node test/e2e/run.js gate_insert gate_drop gate_pick_iso gate_pick_folder` | ❌ W0 | ⬜ pending |
| SAFE-01 | main refuses unflagged scan; probe/rip of unscanned source refused when untrusted | e2e | `node test/e2e/run.js sec_gate_ipc` | ❌ W0 | ⬜ pending |
| SAFE-01 | consent bound to medium identity; swapped/changed media refused by probe/rip; queued job re-gated | unit + e2e | `node --test test/unit/lib.test.js`; `node test/e2e/run.js sec_gate_swap sec_gate_ipc` | ✅ | ⬜ pending |
| SAFE-01 | identity covers every file the parsers open (DVD root/video_ts, BD BACKUP/AACS/CERTIFICATE); cap refuses; in-place edit refused; OS metadata ignored | unit + e2e | `node --test test/unit/lib.test.js`; `node test/e2e/run.js sec_gate_inplace` | ✅ | ⬜ pending |
| REL-05 | private reporting, alerts, security fixes on; SECURITY.md fallback contact | API + grep | `gh api repos/rick-rami94/spinarr/private-vulnerability-reporting --jq .enabled` | ❌ | ⬜ pending |
| REL-06 | no unpinned actions, no cache poisoning | CI lint | `pipx run zizmor==1.30.1 --format plain .github/workflows` | ❌ | ⬜ pending |
| REL-06 | Electron advisory check + high audit | CI | audit job script | ❌ | ⬜ pending |
| REL-06 | branch protection on `main` | API | `gh api repos/rick-rami94/spinarr/branches/main/protection` | final task | ⬜ pending |
| REL-08 | no libdvdcss download link; no `openDvdcssPage` bridge | unit + e2e | `node --test test/unit/neutrality.test.js`; `node test/e2e/run.js sec_renderer_isolation` | ❌ / ✅ | ⬜ pending |
| QUAL-01 | coverage ≥ recorded floor | CI (Linux) | `npm run test:coverage` | ❌ W0 | ⬜ pending |
| QUAL-02 | e2e key/cache dirs under tmp home; real home untouched | e2e | `node test/e2e/run.js sec_hermetic_keydirs` | ❌ W0 | ⬜ pending |
| QUAL-02 | `accurateChapters=false` rip covered | e2e + engine | `node test/e2e/run.js us_default_chapters` | ❌ W0 | ⬜ pending |
| PLAT-01 | Windows runs unit, security, engine, e2e | CI | windows job steps | ❌ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `.c8rc.json` + `test:coverage` script + `c8@12.0.0` devDependency
- [ ] `test/unit/gate-static.test.js`, `test/unit/neutrality.test.js`
- [ ] Harness helpers: `fakeInsert`, `dropFile` (CDP), `stubDialog`, prompt-aware `h.load`; `platform` in harness `ctx`
- [ ] `SPINARR_TEST_HOME` hook in `main.js` + run.js env
- [ ] Draft PR `milestone/v1.0 → main` so CI runs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GitHub repo security settings + branch protection applied | REL-05, REL-06 | Requires repo-admin `gh` auth; one-time settings change | Run the `gh api` checks above and confirm expected values |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-10 (plan-checker: 0 blockers; Wave 0 items built by plans 01-02, 01-04, 01-06, 01-07)
