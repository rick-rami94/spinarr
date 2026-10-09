# Design notes

A running journal for Spinarr's interface, so each design pass builds on the last. Newest at the bottom.

## 2026-10-09 · Identity pass (distinct-design + ui-craft)
- **Subject:** a lossless disc ripper for collectors. Its artefacts: the silver data side, the disc-case spine, the volume label as burned, h:mm:ss timecodes.
- **Tried:** three concepts.
  - Studio, evolved: kept.
  - Case spine: its type idea was absorbed into Studio.
  - Timecode strip: rejected; it's too narrow for multi-title discs.
- **Kept:**
  - Native system type for UI text.
  - Archivo (bundled, OFL), condensed to about 80%, for disc titles, timecodes, hero numbers and the volume label.
  - Sentence-case labels instead of tracked uppercase eyebrows.
  - One orchestrated moment: the header disc spins up while its title rips.
- **Fixed:**
  - Focus rings use the darker amber: the light amber measured 1.68:1.
  - Progress fills animate `transform`.
  - Badges are 11 px minimum.
  - A spacing token scale.
- **Removed:**
  - The sidebar tagline: a dot-joined meta string that repeated the start screen.
  - The "· N active" dot prefix.
- **Lints:** `tells.py` and `audit.py` both clean.
- **Next time:**
  - Move the remaining raw px spacing onto `--space-*`.
  - Consider an optional Y2K skin behind `data-skin` (see the UI directions canvas).
