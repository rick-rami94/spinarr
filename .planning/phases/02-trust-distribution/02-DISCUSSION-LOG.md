# Phase 2: Trust & Distribution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-12
**Phase:** 02-trust-distribution
**Areas discussed:** Signing accounts & timing, Release flow & old releases, Fuzz crash handling, License notices & source

---

## Signing accounts & timing

| Question | Options | Selected |
|---|---|---|
| Apple Developer enrollment | Not enrolled yet / Enrolled, no cert / Fully ready | Enrolled, no cert |
| Azure Artifact Signing | Nothing set up / Subscription only / Fully ready | Nothing set up |
| Publisher name | Rick Ramirez / A business entity | Rick Ramirez |
| If accounts aren't ready | Build now, sign later / Block until ready / Close without signing | Build now, sign later |

**Notes:** Signing steps no-op without secrets; the phase stays open until a real signed release passes spctl/signtool (human check).

---

## Release flow & old releases

| Question | Options | Selected |
|---|---|---|
| First pipeline release version | v0.2.0 / v0.1.5 / You decide | v0.2.0 |
| Publish model | Draft, you approve / Auto-publish on tag | Draft, you approve |
| Unsigned tag builds | Fail when secrets exist / Always fail on tags / Never block | Fail when secrets exist |
| Existing v0.1.x releases | Mark pre-release + warn / Leave as-is / Delete them | Mark pre-release + warn |

**Notes:** The v0.1.x release edits are outward-facing; the executor needs Rick's explicit go before running them.

---

## Fuzz crash handling

| Question | Options | Selected |
|---|---|---|
| Crash reporting | Private advisory / CI artifact only / Public issue | Private advisory |
| Corpus storage | Separate private repo / Branch in this repo / You decide | Separate private repo |
| Fuzz CI budget | 10 min PR + 1 h nightly / 5 min PR + 30 min nightly / Nightly only | 10 min PR + 1 h nightly |
| Fix flow | Patch locally, offer upstream / Local patch only / You decide | Patch locally, offer upstream |

---

## License notices & source

| Question | Options | Selected |
|---|---|---|
| Notices UI | Settings > About / Separate window / File only | Settings > About |
| Source bundle | Full, one tarball / App + pinned links / You decide | Full, one tarball |
| SBOM scope | Engine pins + Electron / Everything incl. toolchain / You decide | Engine pins + Electron |

---

## Claude's Discretion

- mac.sign hook design, DMG notarize/staple steps, TrustedSigning module pinning approach, provenance tooling, CFLite build setup, source tarball assembly, release-notes wording.

## Deferred Ideas

- Linux package signing (GPG deb repo / AppImage signatures)
- README "verify a release" section (likely folded into REL-03)
- OSS-Fuzz harness contribution (post-1.0)
- SignPath Foundation OSS signing (post-1.0)
