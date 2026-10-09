# Contributing to Spinarr

Thanks for helping. Spinarr aims to be the friendliest *and* most trustworthy way to back up your DVDs.

## Setup

```sh
brew install meson ninja nasm pkg-config libdvdcss   # engine build + CSS support
brew install ffmpeg dvdauthor                         # test fixtures + oracle only
npm install
npm run engine      # builds engine/bin (verified sources + patches), ~5 min
npm run fixtures    # generates test DVDs in test/fixtures/out
npm start
```

## Tests

| Command | What it runs |
|---|---|
| `npm run test:unit` | Pure logic: validation, naming, progress parsing, sandbox args (seconds) |
| `npm run test:engine` | Real scans and rips of the fixture DVDs, checked against the system ffmpeg as an independent oracle: losslessness, chapters, languages, track selection, broken discs (~1 min) |
| `npm run test:e2e` | Drives the real app window through every user story and security requirement, one isolated app instance per scenario (~3 min). Screenshots land in `test/reports/screenshots/`. |
| `npm run test:security` | Replays the malicious-disc corpus through `dvdinfo` |
| `npm test` | unit + engine + e2e |

Every user-facing change should map to a story in [docs/USER_STORIES.md](docs/USER_STORIES.md) and come with a test.

## Ground rules

- **Never trust the disc.** Anything read from a disc (labels, IFO fields, language codes) is attacker-controlled. Escape it with `esc()` before it reaches HTML; validate it before it reaches a path or argument.
- **Validate in the main process.** IPC handlers must validate every argument, even when the renderer "always" sends good data.
- **No new engine capabilities without a sandbox review.** If an engine process needs a new file or network permission, explain why in the PR.
- **Engine patches** live in `engine/patches/<library>-NNNN-*.patch` with a header explaining the bug. Please also send them upstream.
- Keep the UI dependency-free (plain HTML/CSS/JS). Match the existing style.

## Legal

Spinarr is for personal backups of discs you own. Don't open issues or PRs about circumventing protection on discs you don't own, Blu-ray AACS keys, or distributing ripped content.
