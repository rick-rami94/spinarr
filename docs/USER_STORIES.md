# User stories

Each story has acceptance criteria and the automated tests that prove it.

**Test IDs**
- `unit:`: `test/unit/*.test.js`
- `engine:`: `test/engine/engine.test.js`, which runs the real rip engine against generated DVDs
- `e2e:`: `test/e2e/scenarios.js`, which drives the real app window

**Personas**
- **Collector:** has a shelf of DVDs and wants them in Plex or Jellyfin with every track intact.
- **Casual user:** wants the movie, one click, and nothing to configure.
- **Archivist:** cares that the copy is bit-exact and that nothing fails silently.

---

## Getting a disc in

| ID | Story | Acceptance criteria | Tests |
|---|---|---|---|
| US-01 | As a **casual user**, when I insert a DVD it's detected automatically. | A physical disc appears in Sources and scans on its own. Disk images and other volumes appear but wait for a click (see SEC-10). | e2e:`us_mounted_image_and_eject`; manual: real drive (see [Manual test plan](#manual-test-plan)) |
| US-02 | As a **collector**, I can open an ISO, a disc folder, or the `VIDEO_TS` folder itself, or drag any of them onto the window. | An ISO, a disc root folder, and a `VIDEO_TS` folder all scan to the same titles. | engine:`VIDEO_TS folder input works the same as an ISO`; unit:`validateSource accepts the VIDEO_TS folder itself…`; e2e:`us_unicode_and_videots_paths` |

## Understanding the disc

| ID | Story | Acceptance criteria | Tests |
|---|---|---|---|
| US-03 | As a **casual user**, I can see which title is the movie. | The longest non-duplicate title is badged **Main feature** and preselected. The disc label becomes a readable name (`THE_TEST_MOVIE_DISC_1` → "The Test Movie Disc 1"). | unit:`analyzeTitles…`, `prettyName…`; e2e:`us_scan_and_filter` |
| US-04 | As a **casual user**, I don't wade through logos and menus. | Titles shorter than the threshold (default 2 min) are hidden behind a "Short titles" toggle, with a "N hidden" count. | e2e:`us_scan_and_filter`, `us_settings_persist` |
| US-05 | As a **collector**, duplicate playlists don't fool me. | Titles with identical length, chapters and size are badged "Same as N" and hidden behind a toggle. | unit:`analyzeTitles…duplicates`; e2e:`us_scan_and_filter` |
| US-06 | As a **collector**, I can see every track before ripping. | Audio shows language, codec and channels (e.g. "English AC3 5.1"); a commentary flag shows on the chip. Subtitles list each language. Each title has a chapter timeline. | engine:`dvdinfo: PAL 4:3 with 5.1 audio, commentary…`; e2e:`us_track_selection`, `us_scan_and_filter` |

## Ripping

| ID | Story | Acceptance criteria | Tests |
|---|---|---|---|
| US-07 | As a **collector**, I choose which tracks to keep. | Unticked audio and subtitle tracks are absent from the MKV; ticked ones are present in order. | engine:`rip: only the selected tracks end up in the file`; e2e:`us_track_selection` |
| US-08 | As a **casual user**, files are named sensibly, and I can rename them. | The disc name sets the file name and the MKV title. Each title's name can be edited. Characters like `/ : ? < >`, leading dots and control characters are made safe. | unit:`safeFile…`; e2e:`us_naming` |
| US-09 | As a **casual user**, I can queue several titles and watch progress. | Jobs run one at a time. The active job shows %, speed (×) and time left; the rest show "Waiting". | unit:`progressParser…`; e2e:`us_queue_progress_cancel` |
| US-10 | As a **casual user**, I can cancel a rip. | Cancelling the active job stops it and deletes its partial file, and the next job starts. Cancelling a waiting job removes it from the run. | e2e:`us_queue_progress_cancel` |
| US-11 | As an **archivist**, an existing file is never overwritten. | A second rip of the same title becomes "Name (2).mkv". In-progress `.part` files count as taken. | unit:`uniquePath…`; e2e:`us_no_overwrite` |
| US-12 | As an **archivist**, the copy is lossless. | Decoded video is bit-identical to the source. Every audio packet is byte-identical and in order; only up to ~0.1 s at the title edges is trimmed for A/V alignment. Timestamps strictly increase. | engine:`rip is lossless: …` (5 titles across 3 discs) |
| US-13 | As a **collector**, chapters survive. | MKV chapters match the disc's chapter starts (±0.6 s). | engine:`rip: chapters and language tags are preserved`; e2e:`us_track_selection` |
| US-14 | As a **collector**, players show the right track languages. | Audio and subtitle tracks carry ISO-639 language tags (eng, spa, fre, ger…). | engine:`rip: chapters…`, `rip: subtitles are copied…`; e2e:`us_track_selection` |
| US-15 | As a **casual user**, I'm warned before running out of disk space. | If the selected titles exceed the free space, the action bar says "not enough space" and Rip is disabled. | e2e:`us_low_disk_space` |
| US-16 | As a **collector**, my preferences stick. | The output folder, short-title threshold and accurate-chapters setting survive a restart. | e2e:`us_settings_persist` |

## When things go wrong

| ID | Story | Acceptance criteria | Tests |
|---|---|---|---|
| US-17 | As a **casual user**, I get a clear message instead of a broken file. | A non-DVD, a missing path or a folder without VIDEO_TS shows an error. An unreadable (scratched or truncated) disc fails the job with "may be scratched or dirty" and leaves **no** output. | unit:`ripVerdict…`; engine:`dvdinfo: malformed input…`, `rip: unreadable disc data fails loudly…`; e2e:`us_errors` |
| US-18 | As a **casual user**, I can eject from the app. | Eject unmounts the disc, and the view clears. | e2e:`us_mounted_image_and_eject` |
| US-19 | As a **casual user**, I'm told when a long rip finishes. | A notification appears when the queue empties while the app is in the background. | manual |
| US-21 | As an **archivist**, pulling the disc mid-rip doesn't leave junk. | The job fails with an error, no `.part` or `.mkv` is left, and the view clears. | e2e:`us_disc_removed_midrip` |
| US-22 | As a **casual user**, quitting mid-rip is safe. | No partial files remain after quitting. | e2e:`us_quit_midrip` |
| US-23 | As a **collector**, non-English titles work. | Unicode disc and folder names show and save correctly. | e2e:`us_unicode_and_videots_paths`; unit:`prettyName…` |
| US-24 | As a **casual user**, the app matches my system appearance. | Light and dark themes both render with the correct palette. | e2e:`ux_light_theme` (plus a screenshot review) |

## Blu-ray (groundwork; tested with generated discs, not yet on a Blu-ray drive)

| ID | Story | Acceptance criteria | Tests |
|---|---|---|---|
| US-25 | As a **collector**, I can open a Blu-ray folder, ISO or disc and see its playlists. | Playlists show length, chapters, resolution and codec (e.g. 1080p · H.264 · 16:9), and audio/subtitle languages. The longest unique playlist is the main feature; duplicate and short playlists are hidden. | engine:`bdinfo: playlists…`, `bdinfo + analyzeTitles…`; e2e:`us_bluray_rip` |
| US-26 | As an **archivist**, a Blu-ray rip is lossless and complete. | Video and audio decode identically to the source. Blu-ray LPCM becomes FLAC (lossless, since MKV can't hold LPCM), TrueHD and DTS-HD are copied. Playlist chapters and track languages are applied. Short bonus playlists rip too. The finished file's video duration is verified. | engine:`Blu-ray rip is lossless…`, `…chapters, languages and title`, `…4-second bonus playlist…`, `completeness check…`; e2e:`us_bluray_rip` |
| US-27 | As a **casual user**, an encrypted Blu-ray tells me what's missing instead of failing. | An AACS disc without libaacs or a matching key shows a clear banner and Rip is disabled. A BD+ disc says it isn't supported. | engine:`bdinfo: an AACS disc…`; e2e:`us_bluray_encrypted` |
| US-28 | As a **power user**, I can drive the app from the keyboard. | ↑↓ move between titles, Space selects, →/← expand and collapse, ⌘A selects every visible title (again to clear), ⌘↩ rips, ⌘, opens Settings. Each title card shows live rip status (Waiting, percent, Ripped). | e2e:`ux_keyboard` |
| US-29 | As **anyone on macOS, Windows or Linux**, I can install Spinarr from one download, and it tells me what's missing. | Releases ship a `.dmg` (arm64 and x64), a Windows installer, an AppImage and a `.deb`, each with the engine built in. Settings → System shows the engine sandbox (macOS profile, bubblewrap, or none) and whether libdvdcss was found, with the install command for this OS, or a DLL picker on Windows. Disc detection, eject, file names and shortcuts follow each OS. | unit:`platform.test.js`; security:`sandbox.test.js` (macOS + Linux); e2e on macOS, Linux and Windows CI; installers built for every packaging PR |

## Security requirements

These are tested in `docs/SECURITY_TESTING.md`.

| ID | Requirement | Tests |
|---|---|---|
| SEC-01 | The renderer has no Node.js and only a minimal, frozen API bridge. | e2e:`sec_renderer_isolation` |
| SEC-02 | The app can't be navigated away from its UI, and can't open windows or webviews. | e2e:`sec_renderer_isolation` |
| SEC-03 | CSP blocks inline script, remote fetches and reads of app files. Only notifications may be requested. | e2e:`sec_renderer_isolation` |
| SEC-04 | Every IPC argument is validated; malformed calls are rejected. | unit:`validate*`; e2e:`sec_ipc_validation` |
| SEC-05 | The renderer can't choose where files are written; the output folder only changes through the native picker. | unit:`validateJob…`, `sanitizeSettingsPatch…`; e2e:`sec_ipc_validation` |
| SEC-06 | No path traversal through file names. | unit:`safeFile…`; e2e:`sec_ipc_validation` |
| SEC-07 | The renderer can't open, launch or reveal arbitrary paths, or eject non-disc volumes. | e2e:`sec_ipc_validation` |
| SEC-08 | Disc-supplied text (labels, folder names, languages, codecs) is never interpreted as HTML. | unit:`esc…`; e2e:`sec_xss_volume_label`, `sec_xss_folder_name` |
| SEC-09 | Malformed or hostile disc structures can't corrupt memory. The engine is patched, fuzzed, and runs in a sandbox. | engine:`dvdinfo: malformed input…`; fuzzing; e2e:`sec_malicious_discs`; unit:`sandbox…` |
| SEC-10 | Only physical optical media scan automatically, so a downloaded disk image needs a click. | unit:`volumeKind…`; e2e:`us_mounted_image_and_eject` |
| SEC-11 | Blu-ray parsing is patched, fuzzed and sandboxed like DVD. Encrypted discs are refused by the backend, not just the UI. Key files are read-only to the engine. Spinarr never ships or downloads keys. | engine/security corpus (`malicious-bd`); unit:`sandboxed() passes the libaacs…`; e2e:`us_bluray_encrypted`, `sec_bluray_hostile` |

---

## Manual test plan

These need hardware, so a human runs them before each release.

| # | Steps | Expected |
|---|---|---|
| M-1 | Insert a commercial, CSS-encrypted DVD. | It's detected as **DVD** in Sources, scans automatically, and the main feature is preselected. |
| M-2 | Rip the main feature. | The MKV plays in VLC/mpv with correct audio sync. Chapters and track languages show in the player. |
| M-3 | Insert a disc with multiple angles or seamless branching. | The title list shows angles; the rip plays end to end. |
| M-4 | Insert a scratched disc. | The job fails with the "scratched or dirty" message, and no file is left. |
| M-5 | Rip with the app in the background. | A notification appears on completion (US-19). |
| M-6 | Insert a disc with no `libdvdcss` installed. | Encrypted titles fail with the libdvdcss message, not a crash. |
| M-7 | Eject with the hardware button mid-scan. | Spinarr shows an error and stays responsive. |
