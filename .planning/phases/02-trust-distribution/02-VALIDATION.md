---
phase: 2
slug: trust-distribution
status: draft
nyquist_compliant: false
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
| TBD | — | — | REL-01 | — | Engine/app/helper entitlements mapped correctly by sign hook | unit | `node --test test/unit/sign-mac.test.js test/unit/entitlements.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | REL-01 | — | Notarized + stapled app and dmg accepted by spctl | CI / manual | `sh build/verify-mac.sh dist` | ❌ W0 | ⬜ pending |
| TBD | — | — | REL-02 | — | Win sign hook no-ops w/o env, fails with SPINARR_REQUIRE_SIGNING=1, argv-only paths, pinned module | unit | `node --test test/unit/sign-win.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | REL-02 | — | Every exe + installer Authenticode Valid, timestamped | CI / manual | `pwsh build/verify-win.ps1 dist` | ❌ W0 | ⬜ pending |
| TBD | — | — | REL-03 | — | SBOM covers every pin + libudfread + Electron, CycloneDX 1.6 valid | unit + CI | `node --test test/unit/sbom.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | REL-03 | — | release.yml scoped permissions, env-gated signing, attest after notarize, no caches | unit | `node --test test/unit/workflows.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | REL-03 | — | cosign bundle + attestations verify on produced assets | CI self-check | `cosign verify-blob …` / `gh attestation verify …` | ❌ | ⬜ pending |
| TBD | — | — | REL-04 | — | Notices generated from same pin parser; license text present | unit | `node --test test/unit/notices.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | REL-04 | — | Source bundle complete + deterministic | integration | `sh scripts/source-bundle.sh <ver> /tmp/sb && node --test test/unit/source-bundle.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | REL-04 | — | About shows notices; source IPC takes no args | e2e | `node test/e2e/run.js about_notices` | ❌ W0 | ⬜ pending |
| TBD | — | — | SAFE-10 | — | ASan replay of 70-case corpus, no sanitizer report | CI | `SPINARR_ENGINE_BIN=engine/bin-asan node --test test/security/corpus.test.js` | ✅ (needs override) | ⬜ pending |
| TBD | — | — | SAFE-10 | — | Fuzz crash input never exposed publicly | unit | `node --test test/unit/workflows.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/sign-mac.test.js`, `test/unit/entitlements.test.js` — REL-01
- [ ] `test/unit/sign-win.test.js` — REL-02
- [ ] `test/unit/sbom.test.js`, `test/unit/notices.test.js`, `test/unit/source-bundle.test.js`, `test/unit/workflows.test.js` — REL-03/04
- [ ] `test/e2e/scenarios.js` → `about_notices` scenario — REL-04
- [ ] `test/security/corpus.test.js` → `SPINARR_ENGINE_BIN` override + sanitizer exit-code handling — SAFE-10
- [ ] CFLite standalone-run spike + unpatched-harness sanity check — SAFE-10

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gatekeeper accepts downloaded dmg/app with no warning | REL-01 | Needs Apple Developer ID + notarization creds and a real download (quarantine) | Download signed draft dmg; `spctl -a -t open -vvv --context context:primary-signature <dmg>`; `spctl -a -t exec <app>`; `xcrun stapler validate`; open app |
| SmartScreen-clean install on Windows | REL-02 | Needs Azure Artifact Signing account (identity validation is human) | Download signed installer on Windows; confirm no SmartScreen bypass; `Get-AuthenticodeSignature` |
| Immutable Releases enabled | REL-03 | Outward-facing repo setting | `gh api repos/rick-rami94/spinarr/immutable-releases --jq .enabled` → `true` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
