# Phase 1: Safety Gate & CI Baseline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md. This log preserves the alternatives considered.

**Date:** 2026-10-10
**Phase:** 01-safety-gate-ci-baseline
**Areas discussed:** Unsandboxed scan gate, Branch protection (solo), Coverage & CI gates, Disclosure & decryption

---

## Unsandboxed scan gate

| Question | Options | Selected |
|----------|---------|----------|
| Is explicit open (picker/drop) the click? | Confirm every time / Open = consent | Confirm every time |
| What counts as "sandbox active"? | Static check now / Minimal functional probe | Static check now |
| Remember "Scan anyway"? | Never remember / Per session / Settings toggle | Never remember |
| Where is the gate enforced? | Main process / Renderer only | Main process |

## Branch protection (solo)

| Question | Options | Selected |
|----------|---------|----------|
| How to protect main | PRs required, self-merge / Required checks, direct push ok | PRs required, self-merge |
| Admin bypass | No bypass / Admin bypass allowed | No bypass |
| Required jobs | All four (macOS, Linux, Windows, audit) / macOS + Linux + audit | All four |
| Extras | Block force-push + delete / Plus linear history / You decide | Block force-push + delete |

**Notes:** Claude added a sequencing constraint: turn protection on last, so the phase's own pushes aren't blocked.

## Coverage & CI gates

| Question | Options | Selected |
|----------|---------|----------|
| c8 strictness | Floor = baseline rounded down / Exact baseline / Auto-ratchet | Floor rounded down |
| Which OS measures coverage | Linux only / All three | Linux only |
| Windows job budget | 60 min / 90 min / You decide | 60 min |
| Baseline location | .c8rc.json thresholds / Baseline JSON + script | .c8rc.json |

## Disclosure & decryption

| Question | Options | Selected |
|----------|---------|----------|
| SECURITY.md fallback contact | Gmail / New security@ alias / Email + PGP | Gmail |
| In-app VideoLAN URL | Remove the URL / Name VideoLAN, no link / Keep in app | Remove the URL |
| brew libdvdcss in macOS CI | Keep it / Remove | Keep (documented) |
| README neutrality | Keep package-manager names / Fully generic | Keep package-manager names |

## Claude's Discretion

- Prompt visuals within the existing skins; c8 config shape and reporters; Dependabot schedule; fitting the Windows job in 60 minutes.

## Deferred Ideas

- Functional sandbox probe → Linux and Windows sandbox phases.
- A remembered or Settings-based unsandboxed-scan allowance (rejected for now).
