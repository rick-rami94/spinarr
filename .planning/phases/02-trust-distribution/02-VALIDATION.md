---
phase: 2
slug: trust-distribution
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-12
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built in) + c8 12.0.0 coverage; Electron e2e harness (`test/e2e/run.js`) |
| **Config file** | none for node:test (scripts in package.json); `.c8rc.json` |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm test` (unit + security + engine + e2e) |
| **Estimated runtime** | ~1–2 s unit; ~5–20 s per e2e scenario; full suite a few minutes |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit` plus any touched e2e scenario (`node test/e2e/run.js <name>`)
- **After every plan wave:** Run `npm test` on macOS locally plus CI green on all required checks + `asan`
- **Before `/gsd:verify-work`:** Full suite green; one unsigned `v0.2.0-rc` draft produced end to end (attest + cosign + SBOM + source verified); then the human-gated signed v0.2.0 draft check (D-04)
- **Max feedback latency:** 60 seconds (unit/static); CI jobs excepted

---

## Per-Task Verification Map

*Filled in by the planner/executor from the Phase Requirements → Test Map in 02-RESEARCH.md § Validation Architecture.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 01 | 1 | REL-01 | T-02-01 | Engine/app/helper entitlements mapped correctly by sign hook | unit | `node --test test/unit/sign-mac.test.js test/unit/entitlements.test.js` | ❌ W0 (created in task) | ⬜ pending |
| 02-01-T2 | 01 | 1 | REL-02 | T-02-02, T-02-03 | Win sign hook no-ops w/o env, throws with SPINARR_REQUIRE_SIGNING=1, argv-only, pinned module | unit | `node --test test/unit/sign-win.test.js` | ❌ W0 (created in task) | ⬜ pending |
| 02-01-T3 | 01 | 1 | REL-01, REL-02 | T-02-04 | package.json wiring; verify scripts fail closed on unsigned build | unit + build | `node --test test/unit/sign-*.test.js && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --publish never && ! sh build/verify-mac.sh dist` | ❌ W0 | ⬜ pending |
| 02-02-T1 | 02 | 1 | REL-03 | T-02-05 | Single pin parser matches build.sh; fetch mode verifies tarballs | unit | `node --test test/unit/sbom.test.js && sh engine/build.sh fetch` | ❌ W0 | ⬜ pending |
| 02-02-T2 | 02 | 1 | REL-03 | T-02-07 | SBOM covers every pin + libudfread + Electron, CycloneDX 1.6, deterministic | unit | `node --test test/unit/sbom.test.js` | ❌ W0 | ⬜ pending |
| 02-02-T3 | 02 | 1 | REL-03, REL-04 | T-02-06, T-02-07 | Notices generated from same parser, committed, drift-guarded; SBOM schema-valid in CI | unit + CI | `node --test test/unit/notices.test.js && node scripts/gen-notices.js --check` | ❌ W0 | ⬜ pending |
| 02-03-T1 | 03 | 1 | REL-01..03, SAFE-10 | T-02-10 | Runbook + verification guide; README has no bypass advice | unit (neutrality) + grep | `npm run test:unit && ! grep -n 'Open Anyway\|Run anyway' README.md` | ✅ | ⬜ pending |
| 02-03-T2 | 03 | 1 | REL-03 | T-02-08, T-02-09 | `release` env tag-only; Immutable Releases on | checkpoint + smoke | `gh api repos/rick-rami94/spinarr/immutable-releases --jq .enabled` | n/a | ⬜ pending |
| 02-04-T1/T2 | 04 | 1 | SAFE-10 | T-02-11, T-02-12 | Private corpus repo + least-privilege credential in env `fuzz` | checkpoint + smoke | `gh repo view rick-rami94/spinarr-fuzz-corpus --json visibility` | n/a | ⬜ pending |
| 02-05-T1 | 05 | 1 | SAFE-10 | T-02-14 | Scanner refactor keeps shipped output byte-identical | security + diff | `sh engine/build.sh scanners && npm run test:security` | ✅ | ⬜ pending |
| 02-05-T2 | 05 | 1 | SAFE-10 | T-02-15 | Harnesses run all seeds under ASan/UBSan; path allow-list | local smoke | `sh fuzz/build-local.sh` | ❌ W0 | ⬜ pending |
| 02-06-T1 | 06 | 2 | REL-04 | T-02-16, T-02-17, T-02-19 | No-arg IPCs; notices + licenses bundled in packaged app | build | `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --publish never && ls dist/mac*/Spinarr.app/Contents/Resources/THIRD_PARTY_NOTICES.txt` | n/a | ⬜ pending |
| 02-06-T2 | 06 | 2 | REL-04 | T-02-16, T-02-18 | About shows notices via textContent; source IPC ignores renderer args; six skins | e2e | `node test/e2e/run.js about_notices sec_renderer_isolation us_settings_persist` | ❌ W0 (new scenario) | ⬜ pending |
| 02-07-T1 | 07 | 2 | SAFE-10 | T-02-20, T-02-21 | ASan replay of the corpus; sanitizer exit codes 86/87 + stderr scan | security | `sh engine/build.sh asan && SPINARR_ENGINE_BIN=engine/bin-asan node --test test/security/corpus.test.js` | ✅ (needs override) | ⬜ pending |
| 02-07-T2/T3 | 07 | 2 | SAFE-10 | T-02-21 | `asan` CI job on every change; required on main | CI + smoke | `gh api repos/rick-rami94/spinarr/branches/main/protection/required_status_checks --jq .contexts` | n/a | ⬜ pending |
| 02-08-T1 | 08 | 2 | SAFE-10 | T-02-23, T-02-24 | CFLite build; unpatched harness crashes on known seed | docker | `docker run ... spinarr-cflite compile` | ❌ W0 | ⬜ pending |
| 02-08-T2 | 08 | 2 | SAFE-10 | T-02-22, T-02-25 | Standalone spike decides path; fuzz-run.sh leaks nothing to stdout | spike + script | `sh scripts/fuzz-run.sh --mode batch --seconds 30 ...` (exit 3 on unpatched) | ❌ W0 | ⬜ pending |
| 02-09-T1 | 09 | 2 | REL-04 | T-02-26, T-02-27 | Source bundle complete, checksums match pins, deterministic | integration | `docker run --rm -v "$PWD":/src -w /src node:22 sh -c 'git config --global --add safe.directory /src && node --test test/unit/source-bundle.test.js'` | ❌ W0 | ⬜ pending |
| 02-10-T1 | 10 | 3 | SAFE-10 | T-02-28, T-02-32 | Crash triage dedupes, opens private draft advisory, prints only GHSA link | unit | `node --test test/unit/fuzz-report.test.js` | ❌ W0 | ⬜ pending |
| 02-10-T2 | 10 | 3 | SAFE-10 | T-02-28..31 | Fuzz workflows: no artifacts/run_fuzzers/SARIF/pull_request_target; pinned; no template injection | unit (static) + CI | `node --test test/unit/fuzz-workflows.test.js` | ❌ W0 | ⬜ pending |
| 02-11-T1 | 11 | 3 | REL-03 | T-02-38 | Pre-release + honest unsigned note from signing markers | unit | `node --test test/unit/release-notes.test.js` | ❌ W0 | ⬜ pending |
| 02-11-T2 | 11 | 3 | REL-01, REL-02 | T-02-33, T-02-34, T-02-38 | Env-gated signing, dmg notarize/staple, verify steps, markers | static + PR run | `node -e "<release.yml text check>"` + release.yml PR run green | n/a | ⬜ pending |
| 02-11-T3 | 11 | 3 | REL-03, REL-04 | T-02-35..37 | Scoped permissions, attest after notarize over final bytes, no caches, module pin consistency | unit (static) | `node --test test/unit/workflows.test.js` | ❌ W0 | ⬜ pending |
| 02-12-T1..T3 | 12 | 4 | REL-03, REL-04 | T-02-39, T-02-40 | Unsigned rc draft: cosign + attestations + SBOM + source verified | CI self-check + script | `sh scripts/verify-release.sh <dir> v0.2.0-rc.1` | ❌ (created in task) | ⬜ pending |
| 02-13-T1..T3 | 13 | 5 | REL-01, REL-02, REL-03, SAFE-10 | T-02-41, T-02-42 | Signed v0.2.0 draft: spctl (-t open dmg / -t exec app), stapler, Authenticode on every exe; fuzz cron live on main | manual + script | `sh scripts/verify-release.sh <dir> v0.2.0 && sh build/verify-mac.sh <stage>` | ✅ (from earlier plans) | ⬜ pending |
| 02-14-T1..T3 | 14 | 6 | REL-01..03 | T-02-43, T-02-44 | Real-download Gatekeeper/SmartScreen check; publish; gh release verify; D-08 | manual + smoke | `gh release verify v0.2.0` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/sign-mac.test.js`, `test/unit/entitlements.test.js` — REL-01
- [ ] `test/unit/sign-win.test.js` — REL-02
- [ ] `test/unit/sbom.test.js`, `test/unit/notices.test.js`, `test/unit/source-bundle.test.js`, `test/unit/workflows.test.js`, `test/unit/release-notes.test.js` — REL-03/04
- [ ] `test/unit/fuzz-report.test.js`, `test/unit/fuzz-workflows.test.js` — SAFE-10 (fuzz workflow invariants split from workflows.test.js so plans 02-10 and 02-11 never edit the same file)
- [ ] `test/e2e/scenarios.js` → `about_notices` scenario — REL-04
- [ ] `test/security/corpus.test.js` → `SPINARR_ENGINE_BIN` override + sanitizer exit-code handling — SAFE-10
- [ ] CFLite standalone-run spike + unpatched-harness sanity check — SAFE-10

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gatekeeper accepts downloaded dmg/app with no warning (plan 02-14 Task 1) | REL-01 | Needs Apple Developer ID + notarization creds and a real download (quarantine) | Download signed draft dmg; `spctl -a -t open -vvv --context context:primary-signature <dmg>`; `spctl -a -t exec <app>`; `xcrun stapler validate`; open app |
| SmartScreen-clean install on Windows | REL-02 | Needs Azure Artifact Signing account (identity validation is human) | Download signed installer on Windows; confirm no SmartScreen bypass; `Get-AuthenticodeSignature` |
| Immutable Releases enabled | REL-03 | Outward-facing repo setting | `gh api repos/rick-rami94/spinarr/immutable-releases --jq .enabled` → `true` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (unit/static; electron-builder and Docker build checks excepted)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-12 (plan-checker passed)
