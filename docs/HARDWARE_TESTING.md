# Real-hardware testing

*October 9, 2026: macOS 15 (x86_64), HL-DT-ST DVDRAM GP63EX70 (USB), Spinarr 0.1.0.*

## Disc

**Space Jam: Special Edition, Disc 1.** A commercial Region 1, CSS-encrypted DVD-9: 4.57 GB, 5 titles, a 1:27:13 main feature with 38 chapters, EN/FR/ES 5.1 + EN 2.0 audio, and EN/FR/ES subtitles in widescreen and letterbox variants.

## Manual test plan results

| # | Test | Result |
|---|---|---|
| M-1 | Insert disc → auto-detect | ✅ Classified as optical, scanned with **no click** in 1.3–4.0 s inside the engine sandbox (CSS authentication via `/dev/rdisk4`). Main feature preselected; the four extras (10 s–1.3 min) hidden. |
| M-2 | Rip the main feature with default settings | ✅ **4.34 GB in 18.8 min** (avg 4.65× realtime). Independent ffprobe: 1:27:18, 38 chapters, 4 audio + 6 subtitle tracks with correct language tags, viewport tags, MKV title. A full decode of all video and audio found **0 decode errors**: 125,596 video frames, no duplicate timestamps, no gaps. No `.part` left behind. |
| M-3 | Multi-angle / seamless branching | ⏳ Needs a disc with those features |
| M-4 | Scratched disc | ⏳ Needs a damaged disc (covered on images by the truncated-ISO tests) |
| M-5 | Background-completion notification | ⏳ Not observed (the test window was in the foreground) |
| M-6 | No libdvdcss installed | ⏳ Not run (it would require uninstalling the user's libdvdcss) |
| M-7 | Hardware eject mid-scan | ⏳ Not run |

## Bugs found only on real hardware (all fixed)

| # | Finding | Fix |
|---|---|---|
| H-1 | **Ripping was ~10× too slow.** ffmpeg's DVD demuxer disables libdvdnav's read-ahead, so a physical drive (raw device, no OS cache) got one 2 KB read per command: 0.46 MB/s, which projects to ~2.7 h for this disc. Disk images hid it behind the page cache. | `ffmpeg-0002`: enable read-ahead → 2.6–6 MB/s, up to the drive's limit (this LG drive caps video DVDs at about 3.4 MB/s at the inner edge). Output is byte-identical (the lossless tests pass). |
| H-2 | "Accurate chapters" (default **on**) re-read the whole title first, doubling rip time on real drives. Without it, chapter times differ by at most 0.12 s. | Default **off**; the setting now explains the cost. |
| H-3 | Each subtitle language appeared twice ("English, English") because DVDs ship widescreen and letterbox variants. | The track list now labels **Widescreen / Letterbox / Pan and Scan**, plus Forced, Commentary and Described. |
| H-4 | A film DVD (23.976 fps of frames, flagged 29.97) combined with an empty declared audio stream would have been rejected as "stopped early". The frame-count fallback underestimates progress. | The completeness check only uses real timestamps; `-xerror` and read-error detection cover truncation otherwise. |
| H-5 | Label `SPACE_JAM_SE_DISC_1` became "Space Jam **Se** Disc 1". | Edition abbreviations and Roman numerals stay uppercase ("Space Jam SE Disc 1", "Rocky III"). |

## Notes

- Startup on this disc includes about 20 s of libdvdnav's RCE region check ("Suspected RCE Region Protection"). That's normal for Region 1 discs and doesn't affect the rip.
- Read speed is bounded by the drive's video-DVD speed limit, which varies by drive model.
