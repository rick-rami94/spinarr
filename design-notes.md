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

## 2026-10-09 · Standout pass
- **Feedback:** "looks nice but not a standout." The identity pass was tidy, but nothing on screen was unique to a disc ripper.
- **Kept, the signature move:** the disc is the progress display. Discs are read from the hub outward, so while ripping:
  - a gold "read" band grows from the hub to the rim
  - a bright laser line marks the leading edge
  - the unread area is dimmed
  - the 196 px disc spins in the header
  - a 64 px condensed percentage replaces the title stats
- **Also kept:**
  - The title at 52 px condensed (38 px when longer than 22 characters).
  - A soft glow behind the header: warm for DVD, violet for Blu-ray.
  - At 1100 px and narrower, the disc and type scale down.
- **Next time:**
  - The title cards could echo the disc, for example a small read ring instead of the bar for the active title.
  - The empty state could show a disc tray sliding in.
