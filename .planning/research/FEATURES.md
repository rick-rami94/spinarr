# Feature Research

**Domain:** Lossless DVD/Blu-ray → MKV ripper for Plex/Jellyfin collectors (desktop: macOS, Windows, Linux)
**Researched:** 2026-10-10
**Confidence:** MEDIUM-HIGH overall. Naming rules are HIGH: Plex support pages and Jellyfin docs/source were read directly. Competitor behaviour is MEDIUM: MakeMKV forums and ARM source/config. Obfuscation heuristics are LOW-MEDIUM: no published deterministic method exists outside BD-J execution.

**Scope note.** This is a brownfield milestone. Spinarr v0.1.3 already ships scan, lossless remux, track selection, queue, main-feature pick, the AACS refusal path and the KEYDB picker. This file covers the v1.0 collector features, and what "expected behaviour" means for each one.

---

## Reference: exact media-server naming rules (verified)

This section exists because naming is the contract with the user's media server. Get it wrong and Plex or Jellyfin mis-matches silently.

### Movies

| Rule | Plex | Jellyfin | Source / confidence |
|---|---|---|---|
| Folder + file | `Movies/Avatar (2009)/Avatar (2009).mkv` (own folder recommended) | `Movie Name (year) [provider id]/` and the file must begin with the folder base name | Plex movie naming page (modified 2026-05-22), Jellyfin movies doc. HIGH |
| External ID | `{tmdb-272}` or `{imdb-tt0372784}`, in folder and/or file. Needs the current Plex Movie agent. | `[tmdbid-272]`, `[imdbid-tt…]` on every version. **Jellyfin 12.0+ (Sep 2026)** also parses `{tmdb-272}`, `(tmdb-272)`, `[tmdb=272]`: alias added in commit d636b82e (May 2026) and curly/paren support in acb9da6f (Dec 2025), both in v12.x. **Jellyfin 10.x needs `[tmdbid-…]`.** | Plex page; Jellyfin `PathExtensions.cs` + tests. HIGH |
| Edition | `{edition-Director's Cut}` (≤32 chars; **Plex Pass required**; one folder per edition recommended; tag order is free) | No `{edition-}` support found. Versions sit in the same folder as `Movie (2021) [tmdbid-…] - Director's Cut.mkv`, and each file must begin with the exact folder name. | Plex page; Jellyfin docs + code search (no `edition-` hits). HIGH for Plex, MEDIUM for "Jellyfin ignores it" |
| Split / multi-part | ` - cdX / discX / diskX / dvdX / partX / ptX`. Plex **discourages** it: max 8 parts, and features degrade. | `cd`, `dvd`, `part`, `pt`, `disc`, `disk` with any separator | Both docs. HIGH |
| Extras (subfolder) | `Behind The Scenes`, `Deleted Scenes`, `Featurettes`, `Interviews`, `Scenes`, `Shorts`, `Trailers`, `Other` | All of Plex's names, plus `extras`, `clips`, `samples`, `theme-music`, `backdrops` | Plex extras page (2025-02-08); Jellyfin `NamingOptions.cs`. HIGH |
| Extras (inline suffix) | `-behindthescenes -deleted -featurette -interview -scene -short -trailer -other` (hyphen, no space) | Same set plus `-clip -deletedscene -extra -sample` | Same. HIGH |
| Reserved chars | (OS-dependent) | `< > : " / \ | ? *` | Jellyfin doc. HIGH |

**Implications for Spinarr:**
- The cross-server common layout is `Title (Year)/Title (Year).mkv`, with no ID tag. It is safe on both servers and all versions.
- ID tags must be **server-profile-specific**:
  - Plex → `{tmdb-N}`
  - Jellyfin → `[tmdbid-N]`, which works on 10.x and 12.x
  - `{tmdb-N}` is only universal once the user is on Jellyfin ≥ 12.
- Edition naming is incompatible between the servers. The profile must choose:
  - Plex: a `{edition-…}` folder per edition
  - Jellyfin: a ` - Label` suffix in a shared folder
- For extras, use only the **eight Plex folder names**. Jellyfin accepts them too (matching appears case-insensitive; MEDIUM). Never use a generic `Extras` folder: ARM's default `EXTRAS_SUB: "extras"` is not a Plex folder name, so Plex treats those files as movies or ignores them.
- `safeFile()` today turns `Mission: Impossible` into `Mission- Impossible`. Radarr-style "colon → ` - `" ("Mission - Impossible") reads better and still matches.

### TV

| Rule | Plex | Jellyfin |
|---|---|---|
| Layout | `TV Shows/Show (Year) {tmdb-N}/Season 01/Show (Year) - s01e01 - Optional Title.ext`. The English word "Season" is required. | `Shows/Series (Year) [tmdbid-N]/Season 01/Series S01E01.mkv`. `Season NN` zero-padded is recommended. |
| Multi-episode file | `s02e01-e03` | `S01E01-E02` |
| Specials | `Season 00` (or `Specials`), `s00eNN` | `Season 00` |
| Episode order | Per-show setting: TMDB (aired) or TVDB aired/DVD/absolute. **File numbers must match the chosen order.** | Display Order. TMDB **episode groups** (incl. DVD order) support merged 2026-10-07 for the next major (PR #16052). |

**Universal TV pattern:** `Show (Year)/Season 01/Show (Year) - S01E01 - Episode Name.mkv`. Specials go in `Season 00`.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these and a Plex/Jellyfin collector goes back to MakeMKV + FileBot or ARM.

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Media-server naming (movies)** | MakeMKV's default name is `title_t00.mkv` (template `{NAME1}{-:CMNT1}{-:DT}{title:+DFLT}{_t:N2}`). Fixing that is why FileBot exists. ARM writes `Title (Year)` folders. | LOW | Pure `lib.js` logic plus tests. Output root gets `Movies/` and `TV Shows/` subfolders, or separate roots; Plex warns hard against mixing types. Year comes from TMDB or user entry. If no year is known, write the folder without one and flag "needs year". Show a **path preview** before rip. |
| **Server profile: Plex / Jellyfin (/ Emby / Generic)** | IDs and editions differ between servers (see above). One wrong pattern silently mis-matches. | LOW | A single setting that drives the ID tag form, edition form and multi-version layout. Default: "Generic", no ID tags. |
| **TV episode workflow (series discs)** | ARM's top complaint (Discussion #594): series discs rip as one "movie", episodes land in extras, ordering is wrong, and "it's not an automatic process." MakeMKV leaves it all manual. | HIGH | See "Expected behaviour: TV" below. Must work **without** TMDB: the user types show + season + start episode. |
| **"Play all" titles skipped** | The play-all title is the longest, so today it wins main feature (audit §6). Users expect episodes, not one giant file. | MEDIUM | DVD: a title whose cells/sector ranges cover ≥2 other titles, or whose duration ≈ the sum of a run of candidate titles. BD: a playlist whose clip list is the concatenation of other playlists' clip lists. |
| **Multi-angle choice** | HandBrake has an "Angle" dropdown in the source section and outputs a single angle. MakeMKV lists each angle as a separate title. v0.1.3 silently rips angle 1. | MEDIUM | ffmpeg 8.0.1 `dvdvideo` has `-angle 1..9`, and the `bluray:` protocol has `angle`. Both are verified in source. A dropdown appears only when `angles > 1`, default 1; the chosen angle is recorded in MKV metadata. The rip must be tested to prove it *is* the chosen angle (manual test M-3). |
| **Read-error retries + Retry button** | MakeMKV: "Read retry count" (Preferences → IO), **default 5**; forum regulars run 10–20. After retries it aborts that file. **There is no skip.** Users also expect to retry a failed job without rescanning. | MEDIUM-HIGH | Per-read retry has to sit below ffmpeg: in a patched libdvdread/libbluray read path, or in a block-read shim. Plus a whole-job "Retry" in the queue and a configurable count (default 5, max ~25). The failure message must say *where*: timestamp/chapter and sector. |
| **Robust Blu-ray main feature** | Obfuscated retail discs (Lionsgate, Disney, Sony, Universal: John Wick ~100 playlists, Knives Out 100+) are common. Picking the lowest-numbered decoy is a silent wrong rip. | HIGH | Exact parity with MakeMKV is impossible without BD-J. The table-stakes bar is **never silently wrong**: detect obfuscation, apply the best heuristic, and when unsure say so and ask the user. |
| **Keyed AACS end-to-end** | Most retail Blu-rays are AACS. A Blu-ray ripper that only does unencrypted discs is a toy (PROJECT.md key decision). | HIGH | Uses the user's libaacs + KEYDB.cfg, inside the sandbox, and must be validated on a real disc. Errors name the cause (already US-27). |
| **First-run setup for decryption libs** | HandBrake's best-known pain point: on Apple Silicon it doesn't look in `/opt/homebrew/lib`, so users copy dylibs into `/usr/local/lib` by hand (HandBrake issue #6716, Homebrew discussion #5681). | MEDIUM | A checklist (DVD: libdvdcss; Blu-ray: libaacs + KEYDB.cfg) with live status, a per-OS copyable command and "Check again" without restart. DVD-only users skip the Blu-ray part, and unencrypted discs need nothing. |
| **Signed, notarized installers** | Telling users to bypass Gatekeeper/SmartScreen fails the "one you'd point strangers at" bar. | MEDIUM | Owned by the trust/distribution track. From the user's view this is table stakes: it installs with no warnings. |
| **Desktop notification on completion / failure** | ARM notifies through ~10 channels. A desktop app's equivalent is the OS notification. | LOW | US-19 exists for queue-empty. Batch mode needs per-disc success/failure notifications. |
| **Auto-eject after rip (batch)** | ARM: "Insert disc → wait for eject → repeat." | LOW | Platform eject already exists (US-18). Needs cross-OS tests. |

### Differentiators (Competitive Advantage)

These line up with Spinarr's core value: bit-exact or fail loudly, and safe to open any disc.

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Honest uncertainty badges** ("Main feature, confident" / "Disc hides the real movie among 37 look-alikes: pick one") | MakeMKV marks `(FPL_MainFeature)` only when its Java analysis works, and users call it "hit or miss". ARM picks the largest or most-chaptered file and moves on. No tool *says* when it's guessing. | MEDIUM | Builds on title classification. In batch mode an uncertain disc **pauses or ejects as "needs review"**, never guesses. |
| **Continue-numbering across discs** | Season box sets span 3–6 discs. Disc 2 should start at E05 automatically. ARM has nothing like this, and a second disc with the same label is treated as a duplicate (ARM Discussion #1490). | MEDIUM | Needs a disc fingerprint (content hash, not label) plus a small per-show "next episode" record. The user can always override the start number. |
| **Offline title identification** | Better names with zero network calls: Blu-ray `META/DL/bdmt_eng.xml` (what ARM and bdpl use), and the **KEYDB.cfg title entry** for the AACS disc ID (format `0x<discid> = Title \| D \| date …`, verified in the libaacs grammar). | LOW-MEDIUM | Parsed in main from the user's own files and passed to the engine read-only, so the engine stays without network. Pre-fills the name or the TMDB query. |
| **TMDB match ranked by runtime** | Users hate wrong silent matches. ARM accepts the first OMDb/TMDB hit after stripping words until something matches. Comparing TMDB runtime to the scanned main-title duration is a strong extra signal. | MEDIUM | Needs the TMDB lookup. One extra call per candidate (`/movie/{id}` for runtime), so only for the top 3–5. |
| **Edition detection on seamless-branching DVDs** | DVDs with theatrical + extended cuts expose two long titles that share most cells. Offering both as editions, named per profile (`{edition-Extended}` / ` - Extended`), is something no competitor automates. | MEDIUM | Needs cell overlap data from `dvdinfo` and the server profile. |
| **Per-rip verification report** | "Every rip is complete or it fails loudly" made visible: checked streams, durations, read retries used, angle, playlist, and the source fingerprint. This is the archivist persona. | LOW-MEDIUM | Depends on all-stream verification (R-07). Kept in the app's history; an optional sidecar file is v1.x (a `.txt` next to the MKV could be picked up as an extra by servers). |
| **Path preview before rip** | Shows exactly `TV Shows/Show (2004)/Season 01/Show (2004) - S01E05 - Name.mkv` before committing 40 GB. FileBot users rely on this. | LOW | Pure rendering of the naming engine. |
| **Sandboxed, network-free engine + signed builds** | MakeMKV is closed, ARM runs as a root-ish daemon in Docker, and DVDFab is commercial and closed. Spinarr can say "a hostile disc can't reach your files or the network" and prove it. | (exists / in other tracks) | A marketing point, not a new feature. Keep auto-scan off where there's no sandbox (SF-1). |
| **Smart Homebrew/MacPorts/distro lib detection** | Directly fixes HandBrake's documented failure mode. | LOW | Search `/opt/homebrew/lib`, `/usr/local/lib`, `/opt/local/lib` and distro multiarch dirs. Show which file was found and its version. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Run BD-J (Java) to find the real playlist** | It's how MakeMKV gets `FPL_MainFeature`. | Needs a JVM and executes **untrusted disc code**, which breaks the core safety promise. Still "hit or miss" for MakeMKV, and Java 8 vs 11 behaves differently. | Structural heuristics plus an honest "pick one" flow (see Expected behaviour: Blu-ray main feature). |
| **"Ignore read errors / skip bad sectors" rip mode** | Users with scratched discs want *something*, and old DVD Decrypter-style tools had it. | It contradicts "bit-exact or fail loudly", and the output would look fine while hiding glitches. MakeMKV deliberately refuses this too. | Retries with a configurable count, clear location of the failure, tips (clean disc, try another drive). Revisit post-1.0 as an explicitly labelled "damaged copy" mode with a sidecar error map. |
| **Auto-apply first TMDB result** | Fully hands-off batch ripping. | It's ARM's behaviour and the source of mis-named libraries. Labels like `DVD_VIDEO`, `BDROM`, `DISC1` give garbage queries. | Auto-apply only on a high-confidence match: normalized exact title, plus year or runtime within ±3 min. Otherwise use the cleaned label and mark "needs review". |
| **Ship or download keys / libdvdcss / libaacs / KEYDB** | Zero-friction setup. MakeMKV ships its own decryption. | DMCA §1201 exposure (PROJECT.md constraint). RedFox/AnyDVD vanished in June 2024. | First-run checklist that detects user-installed libs. KEYDB picker (exists). Neutral wording, no links to key sources. |
| **Online "correct playlist" database** | AnyDVD and DVDFab rely on curated playlist knowledge. | Needs a network service, curation and legal review. It's network access triggered by disc data, which conflicts with the privacy stance. | Defer. Maybe a user-local "remember my choice for this disc fingerprint". |
| **Transcoding (HandBrake presets)** | ARM's default pipeline transcodes. | Out of scope: Spinarr is lossless, and HandBrake does transcoding better. | Document "rip with Spinarr → transcode with HandBrake if wanted". |
| **Webhook / Pushover / Apprise notifications, Plex/Jellyfin library-refresh API** | ARM has ~10 channels and Emby refresh. | Needs stored credentials, outbound network and more IPC surface. Low value for a desktop user who is sitting at the machine. | OS notifications in v1.0. Library refresh is a candidate for v1.x behind opt-in (Plex/Jellyfin both auto-scan on file change anyway). |
| **Headless server / web UI mode** | ARM's whole model. | A different product, with a network listener and auth. | Stay a desktop app. Batch mode covers the "work through a shelf" job. |
| **Rip all angles merged into one MKV (seamless branching in MKV)** | Discussed on the MakeMKV forum. | MKV ordered-chapters support in players is poor, and it's complex. | One angle per file. Optionally each angle as a separate file named as an edition/version. |
| **Auto-join multi-disc movies** | Plex discourages split files. | Concatenation across discs is a separate pipeline with re-timing risk. | v1.0: name parts ` - part1`/` - part2` (both servers accept them) and document joining. Defer a real join. |
| **Posters / NFO / artwork download** | Kodi-style completeness. | Plex/Jellyfin fetch artwork themselves once the match is right. Images also complicate the CSP (`connect-src 'none'`). | Get the name/ID right and let the server do metadata. |

---

## Expected behaviour, per v1.0 feature

### 1. TV episode workflow (complexity HIGH)

How the competition does it:
- **ARM** decides movie vs. series from OMDb, rips every title ≥ `MINLENGTH` (600 s) into one folder, and leaves naming to FileBot. The maintainer admits series discs often rip "as if it was a movie."
- **AutoHandbrake** looks for sequential, similar-length titles.
- **bdpl** (Blu-ray, MIT) does it best:
  - it dedupes by segment signature and by first clip (alternate `01xxx` playlists share their opening clip with the `00xxx` primary)
  - it detects Play All as a concatenation of other playlists
  - it orders episodes by body-clip ID
  - it decomposes Play-All-only discs by play item (≥5 min each), or splits a single long title by chapters
  - it boosts confidence using `index.bdmv` / `MovieObject.bdmv` playlist refs and IG-menu chapter marks
- **MakeMKV forum wisdom:** the Play-All segment map *is* the episode order (e.g. play-all `8,9,10,21` → the title whose segment map is `8` is episode 1).

Expected Spinarr behaviour:
1. **Classify** every title as `main | episode-candidate | play-all | duplicate | short/extra | decoy`. This classifier is shared with the main-feature and batch features.
2. **Detect series discs:** ≥3 non-duplicate titles whose durations cluster within ±15 % of their median, each ≥ ~8 min, with no single title ≫ the cluster except a play-all. Offer "This looks like a TV disc: rip 4 episodes?", and let the user toggle between Movie and TV.
3. **Order** episodes by Play-All segment order when present. Otherwise by title/VTS/clip number.
4. **Handle one-title-many-chapters DVDs** (episodes only exist as chapter ranges) by splitting with `dvdvideo` `chapter_start`/`chapter_end`, which are verified in ffmpeg 8.0.1. Every split must still pass verification.
5. **Number** each episode from user-confirmed {show, season, start episode}. The start is pre-filled from the last disc of this show (continue-numbering). Multi-episode titles become `S01E01-E02`.
6. **Episode names** come from TMDB when opt-in is on. Otherwise the filename has no name part, which is valid on both servers.
7. **Order mismatch** warning: if the user picks TMDB DVD order (episode group type DVD), tell them to set the same order in Plex/Jellyfin.
8. **Bonus content** on series discs goes to `Season 00` only when the user maps it to a known special. Otherwise skip it, or put it under `Other`.

### 2. Blu-ray main feature with obfuscation (complexity HIGH, LOW-MEDIUM confidence on heuristics)

Known facts:
- MakeMKV uses Java (BD-J) to find the real playlist and marks it `(FPL_MainFeature)`. It added "much better support" in 1.16.4. It is still hit-or-miss: Deepwater Horizon, Patriots Day and Stronger were not resolved.
- DVDFab reads "the main playlist from the main menu". AnyDVD showed "Java BD protection good playlists" (both defunct or closed).
- libbluray's own `_pl_guess_main_title` uses:
  - for playlists >30 min, chapter count, then video format/codec, then HD audio, then "known" playlists, and the known list comes only from prior BD-J playback
  - then duration
  - then stream count
  - plus `TITLES_FILTER_DUP_TITLE` / `TITLES_FILTER_DUP_CLIP`, which drop playlists that repeat clips
- Spinarr today: decoys with identical duration/chapters/size collapse onto the lowest-numbered playlist, which is crowned main (audit §6).
- An SSIM frame-continuity script worked on its author's 2 discs and failed on a third.

Expected behaviour:
1. **Detect obfuscation:** ≥ ~5 playlists within ±1 % of the longest duration that use the same clip *set* in different orders.
2. **Rank candidates:**
   - (a) playlists referenced by HDMV navigation (`index.bdmv` title → `MovieObject.bdmv` PlayPL), which applies to HDMV discs only
   - (b) clip-order continuity
   - (c) libbluray's stream/format heuristics
   - (d) TMDB runtime, which only helps against *non*-decoy confusion
3. **If one candidate clearly wins,** badge it "likely". Otherwise show "This disc hides the real movie among N look-alike playlists" with the top candidates side by side (playlist number, segment map, chapters), and require a choice.
4. **Remember** the user's choice per disc fingerprint locally.
5. **Never auto-rip** an unresolved obfuscated disc in batch mode.

Validation dependency: obfuscated discs are almost all AACS retail, so this **cannot be validated on real media until keyed AACS works.**

### 3. Read-error handling (complexity MEDIUM-HIGH)

- **Expectation, from MakeMKV:** retry each bad read N times (default 5, user-configurable, ~25 max), then abort that title. No silent skipping. The OS also retries before the app sees the error.
- **Spinarr today:** `-xerror` fails fast, with no retry and no Retry button (audit §6).
- **Expected:**
  - per-read retry in the engine's read layer, with a configurable count
  - progress shows "re-reading damaged area…" instead of looking frozen
  - on final failure: "Unreadable at 01:12:33 (chapter 14) after 5 retries. Clean the disc or try another drive"
  - no output left behind (existing US-17 behaviour)
  - a **Retry** button on the failed job
  - optional single automatic job-level retry in batch mode
- **Resume-from-offset** is v2: remux resume is fragile.

### 4. Multi-angle (complexity MEDIUM)

- HandBrake shows an Angle dropdown only when the source has angles, and outputs one angle. MakeMKV shows each angle as its own title (only angle 1 pre-selected).
- Most angles in practice are localized on-screen text (e.g. Pixar titles), not camera angles. Default to angle 1 and explain this in a tooltip.
- **Expected:**
  - angle selector on the title card when `angles > 1`
  - the selection is carried in the job and validated in main (1..angles)
  - passed as `-angle` (DVD) / `angle` (Blu-ray)
  - "Rip all angles" is optional: one file per angle, named as an edition/version
- The DVD demuxer forces angle 1 for seeking and reverts, and skips 3 VOBUs after a seek on multi-angle discs. Rips don't seek, but verification of the chosen angle must be **tested** on a real multi-angle disc.

### 5. Batch / auto-rip mode (complexity MEDIUM)

- **ARM flow:**
  - udev insert → identify (DVD: CRC64 via pydvdid then a community API; BD: `bdmt_eng.xml`; then OMDb/TMDB with progressively stripped titles)
  - `MANUAL_WAIT` 60 s for the user to correct the ID in the web UI
  - rip (main feature by chapters desc, size desc, track asc; or all titles in length bounds)
  - `AUTO_EJECT`, then notify
  - `ALLOW_DUPLICATES: false` by default
  - `PREVENT_99: true` ejects DVDs with "Track 99" fake-title protection
- **Expected Spinarr behaviour:** a toggle "Auto-rip discs as I insert them" with a preset (Movie: main feature | TV: series X, season Y, continue numbering). Then:
  1. Insert.
  2. Sandboxed scan.
  3. Optional ID with a visible countdown for override, ~30–60 s.
  4. Classify.
  5. If confident, queue main feature or episodes; if uncertain (obfuscation, ambiguous series, unknown title), notify "needs review" and keep the disc in.
  6. Rip and verify.
  7. Eject.
  8. Notify success/failure.
  9. Wait for the next disc.
- **Duplicate warning** uses the content fingerprint, not the label. This avoids ARM's "second DVD of a series is a duplicate" bug.
- **Requires a sandboxed engine on every OS**, because auto-scan without a sandbox is SF-1. On an unsandboxed host the toggle is disabled.
- **History list:** disc → files → verification result.

### 6. TMDB identification (complexity MEDIUM)

- **Expected:**
  - off by default; enabling it shows what is sent (search text, year, language) and to whom
  - requests made only from main
  - the TMDB logo plus "uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB" (required by the TMDB terms)
  - cache ≤ 6 months (terms)
  - honour HTTP 429 (limit is ~40 req/s)
- **Query source priority:** `bdmt_eng.xml` title → KEYDB title for the AACS disc ID → cleaned volume label. Strip `DISC_1`, `WS`, `16X9`, `SKU`, `SE`, region suffixes, and underscores.
- **Results:** 5 hits showing title, year, original title, and a runtime delta vs the scanned main title. The query stays editable. Confirm with one keypress.
- **TV:** search `/search/tv`, pick a season, fetch episode names. Offer DVD order via `/tv/{id}/episode_groups` when it exists.
- **Disliked behaviour to avoid:**
  - silent wrong matches
  - mandatory API key setup before anything works (ARM needs an OMDb/TMDB key)
  - posters that slow everything down
  - aired-vs-DVD order surprises (FileBot forum threads)
- **API key decision (open):** TMDB community guidance is "users should get their own key". Shipping a project key is common but extractable and revocable. Recommend a bundled key with a user-override field, and confirm with the TMDB terms owner. Non-commercial use only: Spinarr is free and GPL, so it qualifies.

### 7. First-run setup / KEYDB (complexity MEDIUM)

- **Library availability, verified 2026-10-10:**
  - **Homebrew:** `libdvdcss` 1.6.0, `libaacs` 0.12.0, `libbdplus` 0.2.0
  - **Ubuntu:** `libaacs0` is in the archive; libdvdcss comes via `libdvd-pkg` (LOW: from memory, not re-verified)
  - **VideoLAN** now publishes libdvdcss **source only, no Windows DLLs**, so Windows users must pick a DLL they obtained themselves. That makes Windows the hardest path, and it is already handled by the DLL picker.
- **KEYDB.cfg paths** (libaacs):
  - macOS `~/Library/Preferences/aacs/`
  - Linux `~/.config/aacs/`
  - Windows `%APPDATA%\aacs\` (some guides say `C:\ProgramData\aacs\`; MEDIUM)
- **Expected:**
  - a checklist in a first-run sheet and in Settings → System
  - "Check again" without restart
  - on KEYDB import: validate the format, report "N disc entries", copy with 0600 (exists)
  - "No key for this disc" shows the disc ID with a copy button
  - a skippable setup that never blocks unencrypted discs
  - neutral wording, no links to key sources

---

## Feature Dependencies

```
[Server profile + naming engine (templates, path preview)]
    ├──required by──> [Movie naming w/ year/ID/edition]
    ├──required by──> [TV episode naming S01E01 / Season 00]
    ├──required by──> [Extras folders]  [Edition detection]  [Angle-as-version]
    └──required by──> [Batch mode]  (unattended output needs final paths)

[Title classifier: main | episode | play-all | dup | extra | decoy]
    ├──requires──> [bdinfo: full clip lists + streams across all clips]   (today: clip 0 only)
    ├──requires──> [dvdinfo: cell/sector ranges per title]
    ├──required by──> [Play-all skip] ──> [TV episode workflow]
    ├──required by──> [Obfuscation-aware BD main feature]
    └──required by──> [Batch mode] (decides "confident vs needs review")

[Keyed AACS end-to-end] ──required to VALIDATE──> [Obfuscation heuristics on real discs]
[First-run lib/KEYDB setup] ──enhances──> [Keyed AACS]

[Disc fingerprint (content hash / AACS disc ID)]
    ├──required by──> [Batch duplicate warning]
    ├──required by──> [Continue-numbering across discs]
    └──required by──> [Remember playlist choice]  [TMDB cache key]

[All-stream verification (R-07)] ──required by──> [Read-error retry] (to know a retry succeeded)
                                 ──required by──> [Verification report]
[Read-error retry] ──required by──> [Batch mode] (unattended rips must self-heal)
[Engine sandbox on all OSes (SF-1)] ──required by──> [Batch/auto-rip] (zero-click scan)

[TMDB lookup (opt-in)] ──enhances──> [Naming] [TV episode names] [Runtime-ranked match]
[Offline ID (bdmt_eng.xml, KEYDB title)] ──enhances──> [TMDB query] [Naming without network]
[Angle selection] ──enhances──> [Edition detection]

[Auto-apply TMDB match] ──conflicts──> [Never silently wrong]  (resolved via confidence gate)
[BD-J execution] ──conflicts──> [Sandboxed, network-free engine]
[Ignore-read-errors mode] ──conflicts──> [Bit-exact or fail loudly]
```

### Dependency Notes

- **TV workflow requires the classifier, and the classifier requires richer scanner output.** `bdinfo` must emit every clip of every playlist (IDs + in/out) and aggregate streams; `dvdinfo` must emit cell ranges. Do this scanner work first. It also closes the audit's "clip 0 only" finding.
- **TV workflow must not require TMDB.** Show/season/start-episode entry is the baseline, and TMDB only adds names and order options.
- **Batch mode is the integrator.** It needs naming, the classifier, retry, verification, eject on all OSes, notifications, the fingerprint and the sandbox everywhere. Schedule it last among collector features.
- **Obfuscation work can be coded against synthetic decoy fixtures early.** Real validation waits on keyed AACS plus a real obfuscated retail disc.
- **Naming engine is the foundation.** It's cheap (pure logic), testable, and every other collector feature writes through it.

## MVP Definition

### Launch With (v1.0)

- [ ] Naming engine + server profile (Plex / Jellyfin / Generic), path preview, extras folder names: the foundation for all collector features
- [ ] Richer scans: full BD clip lists + aggregated streams; DVD cell ranges. These unblock the classifier and fix an audit finding.
- [ ] Title classifier with play-all detection and confidence: the core of both TV and main feature
- [ ] TV episode workflow (manual show/season/start; chapter-split DVDs; S01E01-E02; continue-numbering): the #1 gap vs ARM/MakeMKV
- [ ] Obfuscation-aware BD main feature with honest "pick one" fallback: never silently wrong
- [ ] Multi-angle selector: today's behaviour is silently angle 1
- [ ] Read retries (configurable, default 5) + Retry button + located failure message: the reliability score is 5/10
- [ ] Keyed AACS end-to-end + first-run lib/KEYDB checklist: Blu-ray usefulness
- [ ] Opt-in TMDB (movie + TV + episode names, runtime-ranked, confirm step, attribution)
- [ ] Batch/auto-rip with confidence gate, eject, notifications, fingerprint duplicate warning (only where sandboxed)

### Add After Validation (v1.x)

- [ ] Edition detection on seamless-branching DVDs: trigger is beta testers reporting extended-cut discs
- [ ] Verification report sidecar file: trigger is archivist demand
- [ ] TMDB DVD-order episode groups UI: trigger is order complaints; Jellyfin's episode-group support lands in its next major
- [ ] Plex/Jellyfin library refresh (opt-in, token stored in OS keychain)
- [ ] "Rip all angles" as separate versions

### Future Consideration (v2+)

- [ ] Labelled "damaged copy" mode with a sidecar error map: conflicts with the core value unless very explicit
- [ ] Resume interrupted rips from offset
- [ ] Multi-disc movie join
- [ ] Shared playlist-choice database: needs a network service and legal review

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Naming engine + server profile + path preview | HIGH | LOW | P1 |
| Scanner enrichment (BD clips/streams, DVD cells) | HIGH (enabler) | MEDIUM | P1 |
| Title classifier + play-all skip | HIGH | MEDIUM | P1 |
| TV episode workflow | HIGH | HIGH | P1 |
| Obfuscation-aware BD main feature | HIGH | HIGH | P1 |
| Keyed AACS + first-run checklist | HIGH | HIGH | P1 |
| Read retry + Retry button | HIGH | MEDIUM-HIGH | P1 |
| Multi-angle selector | MEDIUM | MEDIUM | P1 |
| Opt-in TMDB | MEDIUM-HIGH | MEDIUM | P1 |
| Batch/auto-rip | MEDIUM-HIGH | MEDIUM (integration-heavy) | P1 (last) |
| Offline ID (bdmt_eng.xml, KEYDB title) | MEDIUM | LOW | P2 (cheap, do with TMDB) |
| Continue-numbering across discs | MEDIUM | LOW-MEDIUM | P1 (part of TV) |
| Edition detection | MEDIUM | MEDIUM | P2 |
| Verification report | MEDIUM | LOW | P2 |
| Library refresh API | LOW | MEDIUM | P3 |

## Competitor Feature Analysis

| Feature | MakeMKV | ARM (2.24.4, Oct 2026, ~5.3k★) | HandBrake | DVDFab / AnyDVD | FileBot | Spinarr v1.0 approach |
|---|---|---|---|---|---|---|
| Lossless remux | Yes | Via MakeMKV (then transcodes by default) | No (transcode) | Yes (commercial / AnyDVD defunct June 2024) | n/a | Yes, oracle-tested |
| Naming | `title_t00.mkv` template (expert mode) | `Title (Year)` folder; series left to FileBot | Source name | Basic | Full Plex/Jellyfin renamer | Built-in, per-server profile |
| BD main feature | BD-J → `(FPL_MainFeature)`; hit-or-miss | Chapters desc → size desc → track asc | libbluray heuristic | "Main movie" from menu | n/a | Structural heuristics + honest pick-one |
| TV episodes | Manual | Rips all ≥600 s; weak | None | Some | Renames after the fact | Classifier + numbering + continue across discs |
| Multi-angle | Each angle a separate title | n/a | Angle dropdown, single output | Yes | n/a | Dropdown; optional all-angles |
| Read errors | Retry count (default 5), then abort; no skip | `dd conv=noerror` only for data discs | n/a | Varies | n/a | Configurable retry, located failure, Retry button; no skip |
| Batch/auto | No (CLI scripts: MakeMKV-Auto-Rip) | Core feature: insert→rip→eject→notify, 60 s manual-ID wait | Queue only | No | Watch folders | Desktop auto-rip with confidence gate |
| Identification | Disc name | DVD CRC64 → community API; BD `bdmt_eng.xml`; OMDb/TMDB (key required) | None | Online DB | TMDB/TVDB/OMDb | Offline first, then opt-in TMDB with confirm |
| Decryption setup | Built-in (closed) | MakeMKV inside Docker | User installs libdvdcss; fails on `/opt/homebrew` | Built-in | n/a | Detect user libs on all paths; KEYDB picker |
| Safety | Closed, unsandboxed | Daemon/Docker | Unsandboxed | Closed | n/a | Sandboxed, network-free engine; signed builds |

## Sources

**Primary / HIGH confidence**
- Plex movie naming, editions, IDs, split files (last modified 2026-05-22): https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/
- Plex local extras (last modified 2025-02-08): https://support.plex.tv/articles/local-files-for-trailers-and-extras/
- Plex TV naming: https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/
- Jellyfin movies: https://jellyfin.org/docs/general/server/media/movies/
- Jellyfin shows: https://jellyfin.org/docs/general/server/media/shows/
- Jellyfin ID parser + tests (master, in v12.x): https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/Library/PathExtensions.cs ; commits d636b82e, 1294990f, acb9da6f
- Jellyfin extras rules: https://github.com/jellyfin/jellyfin/blob/master/Emby.Naming/Common/NamingOptions.cs
- Jellyfin TMDB episode groups PR #16052 (merged 2026-10-07): https://github.com/jellyfin/jellyfin/pull/16052
- ARM config (main): https://github.com/automatic-ripping-machine/automatic-ripping-machine/blob/main/setup/arm.yaml ; `arm/ripper/identify.py`, `makemkv.py`, `arm_ripper.py`
- libbluray 1.5.0 `navigation.c` (`_pl_guess_main_title`): https://code.videolan.org/videolan/libbluray
- FFmpeg n8.0.1 `dvdvideodec.c` (angle, chapter_start/end), `bluray.c` (playlist, angle): https://github.com/FFmpeg/FFmpeg
- libaacs KEYDB format / parser: https://code.videolan.org/videolan/libaacs
- TMDB API terms: https://www.themoviedb.org/api-terms-of-use ; rate limits: https://developer.themoviedb.org/docs/rate-limiting ; search: https://developer.themoviedb.org/reference/search-movie
- Homebrew formula API (libdvdcss 1.6.0, libaacs 0.12.0, libbdplus 0.2.0); VideoLAN libdvdcss download dir (source only)

**Secondary / MEDIUM**
- MakeMKV forum, read retries: https://forum.makemkv.com/forum/viewtopic.php?t=24324 , https://forum.makemkv.com/forum/viewtopic.php?p=128827
- MakeMKV forum, obfuscation / FPL_MainFeature: https://forum.makemkv.com/forum/viewtopic.php?t=16089 , https://forum.makemkv.com/forum/viewtopic.php?t=14330&start=90 , https://forum.makemkv.com/forum/viewtopic.php?t=18936
- MakeMKV output template: https://forum.makemkv.com/forum/viewtopic.php?t=18313
- MakeMKV multi-angle: https://forum.makemkv.com/forum/viewtopic.php?t=41713
- HandBrake angles: https://handbrake.fr/docs/en/latest/technical/video-angles.html
- HandBrake libdvdcss path issue: https://github.com/HandBrake/HandBrake/issues/6716 , https://github.com/orgs/Homebrew/discussions/5681
- ARM TV problems: https://github.com/automatic-ripping-machine/automatic-ripping-machine/discussions/594 , duplicate-disc issue #1490
- bdpl (BD episode heuristics): https://github.com/yxbh/bdpl
- TRaSH Radarr naming (per-server ID formats): https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/
- TMDB episode groups / DVD order: https://www.themoviedb.org/talk/628a69111a324877dda97d1e
- FileBot DVD vs aired order: https://www.filebot.net/forums/viewtopic.php?t=13271

**LOW (single source or community)**
- SSIM frame-continuity deobfuscation: https://forum.makemkv.com/forum/viewtopic.php?t=15570
- Doom9 playlist heuristics: https://forum.doom9.org/showthread.php?t=171338
- RedFox/AnyDVD shutdown June 2024: https://borncity.com/win/2024/06/08/redfox-bz-anystream-clonedvd-etc-is-offline-june-2024/
- KEYDB Windows path variants (`%APPDATA%\aacs` vs `C:\ProgramData\aacs`): https://www.itechguides.com/how-to-fix-this-blu-ray-disc-needs-a-library-for-aacs-decoding/
- TMDB key-in-open-source guidance (community talk): https://www.themoviedb.org/talk/58ff62be925141080b0094f9

---
*Feature research for: lossless DVD/Blu-ray → MKV ripping for Plex/Jellyfin collectors*
*Researched: 2026-10-10*
