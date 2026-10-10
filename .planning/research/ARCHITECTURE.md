# Architecture Research

**Domain:** Sandboxed, lossless desktop disc ripper (Electron main + native engine), v0.1.3 → v1.0 brownfield
**Researched:** 2026-10-10
**Confidence:** MEDIUM overall. HIGH for code-level integration points, libbluray, ffmpeg and electron-builder behaviour (read from the pinned sources in `engine/deps` and `node_modules`). MEDIUM for macOS deny-default and Linux seccomp mechanics. LOW for Windows raw optical-device access from an AppContainer, which needs a spike.

---

## Standard Architecture

### Guiding rule (unchanged, now applied to every new capability)

> **All parsing of disc bytes happens in the sandboxed engine. The main process parses only the engine's JSON, after validating it. All network access lives in the main process. The renderer only sees validated, minimal DTOs.**

Every v1.0 capability below is placed by this rule:

- Blu-ray segment maps and episode cells are emitted by the C scanners.
- Obfuscation and episode heuristics run in pure JS over validated JSON.
- TMDB is a main-process service.
- Verification compares engine-reported numbers against main-held scan truth.

### System Overview (target v1.0)

```
┌──────────────────────────────── Renderer (app://spinarr, sandbox, CSP connect-src 'none') ──────────────────────────┐
│  store.js (state)  ──▶  views/* (sources, titles, detail, episodes, match, queue, settings)                         │
│  html.js: auto-escaping tagged templates + Trusted Types policy  ──▶ mount(region)                                  │
└───────────────────────────────────────────┬──────────────────────────────────────▲─────────────────────────────────┘
                                            │ invoke (validated)                   │ events: queue, drives-changed,
                                            ▼                                      │ autorip, catalog
┌──────────────────────────────── Main process (Node, full user privilege) ───────┴─────────────────────────────────┐
│  main.js (bootstrap/window)   ipc.js (handle() + lib validators)                                                   │
│                                                                                                                    │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  ┌───────────────┐    │
│  │ DiscCatalog  │  │ JobQueue      │  │ JobRunner    │  │ OutputManager│  │ AutoRip        │  │ MetadataSvc   │    │
│  │ scans+probes │◀─│ pure reducer  │─▶│ prepare/rip/ │─▶│ reserve/     │  │ controller     │  │ (TMDB, opt-in)│    │
│  │ keyed by     │  │ + journal     │  │ verify/final │  │ staging/fsync│  │ insert→scan→   │  │ net via own   │    │
│  │ discId       │  │ (queue.json)  │  │              │  │ /rename/sweep│  │ pick→enqueue→  │  │ session, cache│    │
│  └──────┬───────┘  └───────────────┘  └──────┬───────┘  └──────────────┘  │ eject          │  └───────┬───────┘    │
│         │      lib/: analyze (dvd, bd), episodes, naming, verify, validate └────────────────┘          │ HTTPS     │
│         │                                     │                                                        ▼ only here │
│  ┌──────▼─────────────────────────────────────▼─────────────────────────────────────┐        api.themoviedb.org     │
│  │ EngineRunner: spawn (no shell), stderr ring buffer, cancel/kill semantics,       │                              │
│  │ capability request {tool, read[], write[], device, decrypt}  ──▶ platform.wrap() │                              │
│  └──────┬───────────────────────────────────────────────────────────────────────────┘                              │
│         │  SandboxProbe (startup functional test) gates auto-scan / auto-rip                                       │
└═════════╪══════════════════════════════════ TRUST BOUNDARY 2 ═══════════════════════════════════════════════════════┘
          ▼
   macOS:   sandbox-exec, per-tool deny-default profile (generated from capability request)
   Linux:   bwrap (+ --seccomp FD blocklist) ; AppArmor profile for the deb ; probe-gated
   Windows: spinarr-sandbox.exe launcher → AppContainer (no capabilities) + Job object (kill-on-close,
            1 active process) + child-process-restricted + mitigation policies ; ACE grant/revoke ledger
          │
   ┌──────▼──────┐ ┌─────────────┐ ┌──────────────┐ ┌───────────────┐     every engine binary also calls
   │ dvdinfo v2  │ │ bdinfo v2   │ │ ffprobe      │ │ ffmpeg -c copy│     lockdown() at start: Linux late
   │ +discId     │ │ +discId     │ │ (src | out)  │ │ → staging/    │     seccomp (no execve/socket),
   │ +cells      │ │ +clips/segs │ │              │ │   *.mkv.part  │     Windows self-mitigations, mac no-op
   │ +angles     │ │ +agg streams│ │              │ │               │
   └─────────────┘ └─────────────┘ └──────────────┘ └───────────────┘
══════════════════════════════════ TRUST BOUNDARY 3: untrusted disc / ISO / folder ═══════════════════════════════════
```

### Component Responsibilities

| Component | Owns | Talks to | New or refactor |
|---|---|---|---|
| `main.js` | Window, protocol, app lifecycle, wiring | everything (composition root only) | Shrinks from 513 lines to about 150 |
| `ipc.js` | `handle()` sender check plus per-channel validation | Catalog, Queue, Metadata, AutoRip, platform | Extracted from main.js |
| `engine/runner.js` | spawn/exec without a shell; fd passing (seccomp fd); stderr head and tail ring buffer; timeout; cancel → kill semantics per OS | `platform.wrap()`, sandbox probe | Extracted; `run()` becomes spawn-based so it can pass fds |
| `platform.js` → `platform/{mac,linux,win}.js` | Drives, watch, eject, `wrap(tool, caps)`, `probe()` | runner | Split per OS; `wrap` takes a capability request, not raw paths |
| `sandbox/macProfile.js` | Builds a deny-default SBPL text from a capability request | platform/mac | New; replaces `lib.SANDBOX_PROFILE` |
| `sandbox/seccomp-*.bpf` (build artefact) | Linux syscall blocklist for bwrap `--seccomp` | platform/linux | New; generated at engine build time |
| `engine/sandbox-win.c` → `spinarr-sandbox.exe` | AppContainer profile/SID, ACE grant/revoke plus a ledger, job object, process attributes, exit-code passthrough, stdin control channel | platform/win (via runner) | New native helper |
| `engine/lockdown.c` | In-process self-restriction compiled into dvdinfo/bdinfo, and patched into ffmpeg/ffprobe `main()` | — | New; defense in depth |
| `disc/catalog.js` | Source of truth for scans and probes, keyed by `discId` and mapped from the mount path; invalidated on drive change; disc-identity check before rip | runner (scan/probe), lib analyzers | Replaces the `scans` Map |
| `lib/analyze-dvd.js`, `lib/analyze-bd.js` | Main-title pick, duplicates, BD obfuscation clusters, confidence | catalog | Splits `analyzeTitles` (DVD and BD diverge) |
| `lib/episodes.js` | TV-disc detection, play-all detection, episode ordering | catalog/renderer DTO | New, pure |
| `lib/naming.js` | Template engine → relative path segments (Plex/Jellyfin presets) | ipc (validate), OutputManager | New, pure |
| `lib/verify.js` | Per-stream completeness verdict | JobRunner | Replaces `ripVerdict` / `outputVideoSeconds` |
| `rip/queue.js` | Job state machine (pure reducer), retry policy, groups (per-disc batch), persistence journal | JobRunner, AutoRip, ipc | Extracted plus redesigned |
| `rip/runner.js` | prepare → ffmpeg → verify → finalize effects for one job | runner, catalog, OutputManager | Extracted from `pump`/`start` |
| `rip/output.js` | Reserve the final name (`wx`), per-job staging dir, fsync, no-follow rename, startup sweep | fs | New (closes SF-10 and R-16) |
| `autorip.js` | Batch mode: insert → scan → select → name → enqueue → eject | catalog, queue, naming, metadata, platform.eject | New |
| `metadata/tmdb.js` | Opt-in TMDB client: allow-listed endpoints, own `session`, cache, rate limit, DTO normalisation, token in `safeStorage` | ipc, AutoRip | New |
| Renderer `html.js`, `store.js`, `views/*` | Safe-by-default templating; region renders | preload bridge | Refactor of the 757-line `app.js` |

---

## Recommended Project Structure

```
app/
├── main.js                 # composition root: window, protocol, lifecycle, wiring
├── ipc.js                  # every handle() + validation; the only IPC surface
├── preload.js              # bridge (grows: metadata:*, autorip:*, queue:retry)
├── engine/
│   ├── runner.js           # spawn/exec, ring buffers, kill semantics, capability → platform.wrap
│   └── caps.js             # per-tool capability presets (scan, probe-src, rip, probe-out)
├── platform/
│   ├── index.js            # createPlatform() picks one
│   ├── mac.js              # drives (+DiskArbitration-aware watch), eject, wrap → macProfile
│   ├── linux.js            # lsblk, bwrap args + seccomp fd, functional probe
│   └── win.js              # drive letters, eject, wrap → spinarr-sandbox.exe argv
├── sandbox/
│   └── macProfile.js       # deny-default SBPL generator (pure; unit-tested on its text)
├── disc/
│   └── catalog.js          # scan/probe store keyed by discId; path→discId map
├── rip/
│   ├── queue.js            # pure reducer: (state, event) → { state, effects }
│   ├── journal.js          # atomic queue.json persistence (tmp + fsync + rename)
│   ├── runner.js           # executes effects for one job
│   └── output.js           # reserve/staging/finalize/sweep
├── metadata/
│   └── tmdb.js             # main-only network service
├── autorip.js              # batch controller
├── lib/                    # pure, Electron-free, unit-tested (current lib.js split up)
│   ├── validate.js  analyze-dvd.js  analyze-bd.js  episodes.js
│   ├── naming.js    verify.js       args.js (ripArgs/blurayRipArgs)  progress.js
└── renderer/
    ├── index.html          # <script type="module" src="app.js">
    ├── app.js              # boot + delegated events only
    ├── html.js             # html`` / raw() / mount() + Trusted Types policy
    ├── store.js            # state + subscribe(region)
    ├── format.js
    └── views/  sources.js titles.js detail.js episodes.js match.js queue.js settings.js
engine/
├── dvdinfo.c  bdinfo.c     # schema v2 output
├── lockdown.c lockdown.h   # shared self-sandbox
├── sandbox-win.c           # Windows launcher (MinGW, static)
├── seccomp-gen.c           # build-time only: libseccomp → seccomp-<arch>.bpf
├── patches/ffmpeg-0004-lockdown.patch
└── build.sh
build/
├── entitlements.mac.plist          # app: allow-jit only
├── entitlements.mac.inherit.plist  # Electron helpers: allow-jit only
└── entitlements.engine.plist       # engine: disable-library-validation only
```

### Structure Rationale

- **`lib/` stays pure and Electron-free.** The existing ~45 unit tests prove the pattern works. Every new heuristic (obfuscation, episodes, naming, verify) goes here so it can be tested with fixtures and no drive.
- **`rip/queue.js` is a reducer, not a class with timers.** Persistence, retries, batch groups and eject are all transitions plus effects. They can be tested exhaustively with `node:test` without spawning anything.
- **`platform/` split per OS.** The Windows sandbox adds about 150 lines of argv and ledger logic. One 348-line file covering three OSes would become unreadable.
- **No new runtime npm dependencies.** Everything above is plain Node and Electron APIs. Win32 work happens in a small C helper, not a native Node addon (an addon would add an ABI-coupled build to the Electron release matrix).

---

## Architectural Patterns

### Pattern 1: Capability-request sandboxing (one seam, three backends)

**What:** The runner never assembles sandbox paths itself. Each engine call declares a capability request, and each platform turns it into its own mechanism.

```js
// engine/caps.js
const scan     = (src, k) => ({ tool: src.kind === 'bluray' ? 'bdinfo' : 'dvdinfo',
                                read: [src.path, ...(src.encrypted ? k.confDirs : [])],
                                write: src.encrypted ? k.cacheDirs : [],
                                device: src.device || null, decrypt: !!src.encrypted });
const rip      = (src, job, k) => ({ tool: 'ffmpeg', read: [src.path, job.chaptersFile, ...k.confDirs],
                                     write: [job.stagingDir, ...k.cacheDirs], device: src.device, decrypt: src.encrypted });
const probeOut = (job) => ({ tool: 'ffprobe', read: [job.partFile], write: [], device: null, decrypt: false });
// platform.wrap(binPath, args, caps) -> [cmd, argv, { extraFds }]
```

**Per-tool capability matrix (what each profile must allow; everything else is denied):**

| Call | Read | Write | Raw device | dlopen decrypt libs | macOS extra (AACS only) |
|---|---|---|---|---|---|
| dvdinfo (scan) | source | CSS cache | yes if physical | libdvdcss | — |
| bdinfo (scan) | source, aacs/bdplus conf | aacs/bdplus cache | yes if physical | libaacs, libbdplus | DiskArbitration mach-lookup, IOKit MMC user client |
| ffprobe (source probe) | same as scan for that disc type | caches | yes | yes | as bdinfo |
| ffmpeg (rip) | source, conf, chapters file | **job staging dir only**, caches | yes | yes | as bdinfo |
| ffprobe (verify output) | the `.part` file only | none | no | no | none |

Unencrypted ISOs and folders drop `device` and `decrypt` entirely. That gives the narrowest profile for the zero-click case.

**When:** Always. This is the prerequisite for all three sandbox workstreams and for the staging-dir output model.
**Trade-offs:** It's one more indirection layer. In return, sandbox tests can assert per-tool denials (SF-2), and a new tool can't silently inherit the rip profile.

### Pattern 2: Disc identity as the key for scan truth

**What:** Today `scans` is keyed by path. A different disc at the same `/Volumes/LABEL` (or `D:\`) can reuse a stale scan, and Blu-ray rip args are built from that cache. v1.0 keys the catalog by `discId`:

- **DVD:** `DVDDiscID()` exists in the pinned libdvdread (`dvd_reader.h:340`, MD5 of the IFOs).
- **Blu-ray:** `BLURAY_DISC_INFO.disc_id[20]` when AACS is present. Otherwise the scanner emits a hash over the (playlist, clip list, duration) tuples it already enumerates.

The path maps to a `discId`, and drive changes invalidate the path map. `JobRunner.prepare` re-runs a cheap identity check (`dvdinfo --id-only`, about 1–4 s) before the rip starts.

**When:** Required before queue persistence (resuming a job needs "is this the same disc?"), batch mode and verification redesign.
**Trade-offs:** One extra short engine run per job start. That's negligible next to a 20-minute rip.

### Pattern 3: Pure queue reducer + effects + journal

**What:**

```js
// rip/queue.js — no fs, no spawn, no timers
function reduce(state, ev) {
  switch (ev.type) {
    case 'enqueue':   return add(state, ev.jobs);                       // effects: persist, broadcast, pump
    case 'started':   return set(state, ev.id, { status: 'ripping', attempt: +1 });
    case 'finished':  return ev.verdict.ok ? done(state, ev) : fail(state, ev); // fail decides retry
    case 'boot':      return recover(state);   // ripping|verifying → interrupted; queued → paused
    case 'cancel': ...
  }
}
// effects: [{type:'spawnJob', id}, {type:'persist'}, {type:'broadcast'}, {type:'eject', discId}, {type:'sweep', staging}]
```

States are `queued → preparing → ripping → verifying → finalizing → done`, plus `failed` (with `retryable`), `cancelled`, `interrupted`, `paused` and `waiting-disc`. Jobs belong to a **group** (one disc session) carrying `ejectWhenDone`.

**Retry policy lives in the reducer and is security-aware:**

- Read errors: auto-retry up to N (default 1).
- Decrypt errors: never retry automatically (user action needed).
- **Engine killed by a signal: never auto-retry.** A crash on untrusted input shouldn't be replayed against the parser.
- Verify failures: one retry.

**Persistence:** `queue.json` holds only declarative job specs and outcomes, never progress. It's written atomically (tmp → fsync → rename) on status transitions, not on progress ticks.

**When:** Before retries, batch mode, eject-after-rip and the Windows grant ledger (crash recovery reads the same journal).
**Trade-offs:** More code than the current 150-line queue. It pays for itself the moment two features (retry and batch) touch the same transitions.

### Pattern 4: Reserve → stage → fsync → rename (atomic output)

**What:**

1. Main computes the final path from `naming` and asserts it's contained in `outputDir`.
2. Main `mkdir -p`s the parent and **reserves** the final name with `fs.openSync(final, 'wx')`, creating an empty placeholder. This is O_EXCL, so there's no TOCTOU.
3. Main creates a per-job staging dir `outputParent/.spinarr-<jobId>/`.
4. The engine writes only `staging/<name>.mkv.part`. Chapter files live in staging too.
5. On a pass: fsync the file, then `rename(part, final)`. Rename atomically replaces our own placeholder. POSIX `rename` never follows a symlink at the destination, and on Windows `MoveFileEx` replaces the link object.
6. fsync the parent directory (POSIX), then remove staging.
7. On boot, the startup sweep removes `.spinarr-*` staging dirs listed in the journal, plus their zero-byte reservations.

**Why staging dirs:** They are the only thing the sandbox ever gets write access to. That gives:

- **Windows:** ACE grants on a fresh, empty dir are instant. Granting on the user's media library would propagate inheritance across thousands of files.
- **macOS and Linux:** `OUT` shrinks from the whole output folder to one directory.

**Confidence:** HIGH for POSIX semantics. MEDIUM for Windows replace-over-placeholder (libuv's `rename` uses `MOVEFILE_REPLACE_EXISTING`; verify on NTFS and exFAT).

### Pattern 5: Safe-by-default renderer templating (still dependency-free)

**What:** Keep string templating, but invert the default. A tagged template escapes every interpolation unless it's explicitly wrapped in `raw()`. Only `mount()` writes `innerHTML`, through a Trusted Types policy.

```js
// renderer/html.js
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s) });
export function html(strings, ...vals) {
  return raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
}
const part = (v) => v?.[RAW] ?? (Array.isArray(v) ? v.map(part).join('') : esc(v ?? ''));
const policy = trustedTypes.createPolicy('spinarr', { createHTML: (s) => s });
export const mount = (el, tpl) => { el.innerHTML = policy.createHTML(tpl[RAW]); };
```

CSP moves from the `<meta>` tag into a response header set by `serveRenderer`, adding `require-trusted-types-for 'script'; trusted-types spinarr`. Then any stray `el.innerHTML = string` throws instead of becoming an XSS bug.

**When:** Before the TV/episode, TMDB-match and angle UIs land. Those add three new sources of untrusted text: TMDB strings, episode names and disc labels in paths.
**Trade-offs:** It's a mechanical migration of about 25 `innerHTML` sites. ES modules need `.js` served as `text/javascript` from `app://` (it already is, via `net.fetch(file://)`). No framework, no build step, and the "UI stays dependency-free" convention holds.
**Answer to "is innerHTML sustainable?":** Yes, with this change. Not as it is today. A component framework isn't needed. What's needed is (a) safe-by-default escaping, (b) one file per view with region-scoped re-render, and (c) a store with per-region subscriptions, so the 250 ms queue tick doesn't re-render title cards.

---

## Data Flow

### Scan → select → rip → verify (target)

```
drive event / user pick
   ↓
platform.watch ──▶ SandboxProbe ok? ── no ──▶ list disc, NO auto-scan, banner "engine sandbox unavailable"
   ↓ yes
Catalog.scan(path)
   ↓  runner(caps.scan) ─▶ dvdinfo/bdinfo v2 (sandbox) ─▶ JSON
   ↓  lib.validateScan(JSON)  (caps arrays, clamps numbers, drops unknown keys)
   ↓  analyze-dvd | analyze-bd  (main pick + confidence + obfuscation clusters + angles)
   ↓  episodes.detect           (TV / play-all)
   ↓  store { discId → disc }, map path → discId
   ↓
renderer gets DisplayDTO (no paths beyond source, no raw JSON)
   ↓ user selects titles / angle / tracks / naming fields   (or AutoRip does)
ipc 'rip' { discId, title, angle, streams, naming:{kind,title,year,season,episode,...} }
   ↓ validate; expected = Catalog.get(discId).title(title, angle)   ← durations, stream list, chapters
   ↓ relPath = naming.render(fields, preset)  → segments → safeFile each → contained in outputDir
Queue.reduce(enqueue) ─▶ effects ─▶ journal.persist, broadcast
   ↓
rip/runner: identity check (discId still at source?) → output.reserve/stage → args (angle, maps)
   ↓ runner(caps.rip) ─▶ ffmpeg -v verbose ... -progress pipe:1 → staging/*.part
   ↓ stderr tail ring → parse per-stream "packets read"/"packets muxed" (ffmpeg_demux.c:846, ffmpeg_mux.c:732)
   ↓ runner(caps.probeOut) ─▶ ffprobe .part → per-track DURATION tags (matroska muxer writes one per track)
lib.verify({expected, ffmpegStats, outputTracks, tolerance}) → verdict {ok | category, message}
   ↓ ok: output.finalize (fsync, rename over reservation)     ↓ fail: Queue.reduce(finished, verdict) → retry?
Queue → effects: broadcast, maybe eject (group complete & all ok)
```

### Verification redesign (where truth lives)

**Truth lives in the Catalog (main), never the renderer.** The renderer sends only `{discId, title, angle, streams}`. Main looks up:

- The expected title duration (DVD: IFO cell times summed for the chosen angle; BD: playlist duration).
- The probed stream list for that title. Probes are cached in the Catalog per (discId, title, angle), so the stream indices the user picked are resolved against main's own probe.

This closes SF-9 for DVD and generalises the Blu-ray path.

**Checks, in order:**

1. Exit status, signal and stderr classification, as today. Keep `-xerror`.
2. **Read vs muxed packets per mapped stream** (ffmpeg's own end-of-run stats, logged at `-v verbose`). Any mapped stream with `muxed < read` fails. This catches muxer drops (the AC3 duplicate-PTS class of bug patch 0001 fixed) and is cheap.
3. **Per-track output duration** from the MKV's `DURATION` tags:
   - Video ≥ `expected × (1 − ε_v)`. Start with ε_v = 1% and calibrate against fixtures and the M-2 real-disc rip, since IFO cell times versus trimmed padding cells differ slightly.
   - Each audio track ≥ video − δ (e.g. 2 s).
   - Subtitle tracks are checked only for "packets > 0 if the source declared packets". They legitimately end at the last cue.
4. Document the tolerance in `docs/` and lock it with a regression fixture that has a truncated audio track (P1-2 acceptance).

**Do not** use `ffprobe -count_packets` on the output. It reads the whole file (25–50 GB for Blu-ray), which is minutes of extra I/O, and ffmpeg already reports the same numbers for free. The runner's stderr capture changes from "first 64 KB" to "first 16 KB + last 64 KB ring", because the summary is at the end. **Confidence:** HIGH that the stats exist at VERBOSE (read in the pinned source). MEDIUM on verbose-log volume from the dvdvideo/bluray demuxers on long titles (the ring buffer bounds it either way).

### TMDB lookup flow (network stays in main)

```
renderer: "Find match" (opt-in enabled, token present)
   ↓ ipc metadata:search {kind:'movie'|'tv', query≤100 chars, year?}
MetadataSvc
   ├─ cache hit (metadata-cache.json, TTL ≤ 30 d; TMDB ToS caps caching at 6 months) → DTO
   └─ miss → token bucket (≈4 rps) → session.fromPartition('spinarr-metadata').fetch(
          'https://api.themoviedb.org/3/search/movie?' + URLSearchParams, {Authorization: Bearer <safeStorage token>},
          timeout 8 s, response cap 1 MB) → JSON.parse → normalise → DTO [{id, title(≤200, ctrl-stripped), year}]
   ↓ DTO only (never raw JSON, never URLs)
renderer renders escaped; user confirms → naming fields → ipc 'rip'
```

- **Endpoint allow-list:** `search/movie`, `search/tv`, `movie/{id}`, `tv/{id}`, `tv/{id}/season/{n}`. IDs and season are validated as integers in main.
- **Token:** the user's own TMDB API Read Access Token, stored with `safeStorage`. On Linux, check `safeStorage.getSelectedStorageBackend()`. If it reports `basic_text`, warn that the token is stored unencrypted. Never send the token back over IPC.
- **CSP:** `connect-src 'none'` and `img-src 'self'` stay unchanged. Posters are deferred for 1.0. If they're added later, main fetches the bytes, checks PNG/JPEG magic and size, caches them, and serves them as `app://spinarr/poster/<id>.jpg`.
- **Attribution:** the TMDB logo and the required "uses TMDB… not endorsed" notice go in Settings → About. **HIGH:** this is required by the TMDB terms.

### Batch / auto-rip flow

```
AutoRip (per drive):  idle → scanning → selecting → { needs-user | enqueued } → ripping → ejecting → idle
  preconditions: settings.autoRip && SandboxProbe ok && discId not in ripped-history (unless user re-arms)
  selecting: movie → main feature only if confidence=high (no obfuscation cluster, unique longest);
             TV   → episodes only if episodes.detect confidence=high; name via preset (+TMDB if enabled & unique match)
  needs-user: notification, disc stays in, nothing queued
  ejecting: only when every job in the group is done; failure → keep disc, notify
```

AutoRip is a **client of** the Queue and Catalog, not part of them. The queue stays agnostic of drives.

### Key Data Flows

1. **Truth flow:** engine JSON → `validateScan` → Catalog (by discId) → jobs reference `discId + title + angle`. Durations, playlists, chapters and stream maps are always re-derived in main.
2. **Write flow:** naming fields → `naming.render` → contained path → reserve → staging (only sandbox-writable place) → fsync → rename.
3. **Network flow:** renderer intent → ipc → MetadataSvc (only module that imports `session.fetch`) → DTO. The engine and renderer never touch the network.
4. **Lifecycle flow:** every status transition → journal. On boot: sweep staging and reservations, revoke leftover Windows ACEs (from the ledger), mark interrupted jobs.

---

## Platform Sandbox Designs

### Windows: `spinarr-sandbox.exe` launcher

**Where it lives:**

- **Source:** `engine/sandbox-win.c`, built by `engine/build.sh` under MSYS2 MinGW, statically linked like the other engine binaries.
- **Shipped:** `resources/engine/spinarr-sandbox.exe`, already covered by the existing `*.exe` filter in `extraResources`.
- **Signing:** signed together with the other exes.

**How `platform.wrap()` calls it:** `wrap` returns `[launcher, argv]`.

```
spinarr-sandbox.exe --ac Spinarr.Engine.v1
  --ledger %APPDATA%\Spinarr\sandbox-grants.json
  --read  <source ISO | folder>  --read <engineDir>  --read <userLib(libdvdcss/libaacs)>  --read <aacsConf>
  --write <stagingDir>  --write <cssCache>  --write <aacsCache>
  [--device D:]            # only if the spike says it's grantable/usable
  -- <engineDir>\ffmpeg.exe <args...>
```

**What the launcher does, in order:**

1. `CreateAppContainerProfile` (idempotent; on `ERROR_ALREADY_EXISTS`, `DeriveAppContainerSidFromAppContainerName`).
2. Append each path to the ledger, then add an explicit ACE for the AppContainer SID: R+X for `--read`, Modify for `--write`. Directories get inheritable ACEs, applied with `SetEntriesInAcl` + `SetNamedSecurityInfo`.
3. Create the job object:
   - `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
   - `ActiveProcessLimit = 1`
   - `DIE_ON_UNHANDLED_EXCEPTION`
   - UI restrictions (desktop, clipboard, global atoms)
4. `CreateProcessW` with `EXTENDED_STARTUPINFO_PRESENT` and these attributes:
   - `SECURITY_CAPABILITIES` with **zero capabilities** (no `internetClient` means no network)
   - `JOB_LIST` (Windows 10+; assigns atomically, so there's no suspend-then-assign race)
   - `CHILD_PROCESS_POLICY = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED`
   - `HANDLE_LIST` = the three std handles only
   - `MITIGATION_POLICY`: extension-point disable, image-load no-remote / no-low-label / prefer-System32, strict handle checks, prohibit dynamic code. Win32k-disable only if the engine is verified not to touch user32/gdi32 at runtime. `build.sh` currently allows them as imports.
5. Wait on {child, stdin-EOF}. **Stdin is the control channel:** Node gives the launcher a stdin pipe. EOF means either "cancel" or "parent died", and both lead to `TerminateJobObject`.
6. Revoke every ACE added in step 2, clear the ledger entries, and exit with the child's exit code (or a distinct code for "killed").

**Kill semantics:**

- **Cancel:** main closes the launcher's stdin and then, after 2 s, calls `child.kill()` (TerminateProcess). Because the launcher holds the only (non-inheritable) job handle, its death closes the job, and `KILL_ON_JOB_CLOSE` takes down ffmpeg. This gives a real process-tree kill, replacing today's `child.kill()` that leaves no tree guarantee.
- **Electron crash:** the stdin pipe breaks, which triggers the same path.
- **Hard kill of the launcher:** ACEs leak. On the next start, main runs `spinarr-sandbox.exe --revoke-ledger` before anything else.
- **Residual risk of a leaked ACE:** low. It only grants Spinarr's own AppContainer.

**ACL lifecycle rules:**

- Grant only on things Spinarr owns or the user explicitly chose: the staging dir, the ISO file, the picked folder, caches and the engine dir. **Never** grant on the output library root or on `%USERPROFILE%`.
- Expect traversal and canonicalisation problems in sandboxed processes that resolve parent paths. Microsoft's mxc issue #1109 reports that "granted user-profile path fails unless volume root is also granted", so pass already-canonical paths and avoid `GetFinalPathName`-style resolution in the engine.
- The engine dir under `%LOCALAPPDATA%\Programs\spinarr\resources\engine` needs R+X for the AppContainer. Grant once on first run and re-check at startup (an upgrade replaces the files, and with them the ACLs).

**THE spike (do first, before committing the design):** can a no-capability AppContainer process open `\\.\D:` and issue DVD and SCSI pass-through IOCTLs?

- libdvdcss needs this for CSS key exchange.
- libaacs's Win32 backend calls `CreateFile(volume, GENERIC_READ | GENERIC_WRITE)` and `IOCTL_SCSI_PASS_THROUGH_DIRECT`, read in the libaacs 0.11.1 source.
- Device objects typically grant Everyone read/write, but AppContainer access checks need an ACE for the AppContainer SID, ALL APPLICATION PACKAGES, or a matching capability. "Everyone" isn't enough.
- A non-admin user can't re-ACL a device object, and the Codex issue #45871 shows lowbox processes being denied `\GLOBAL??` DOS-device resolution.

**Expect "no". Confidence:** LOW for "yes".

**Decision tree after the spike:**

| Spike result | v1.0 design |
|---|---|
| Device opens in AC | Full AppContainer for everything. |
| Device denied; UDF files on `D:\` readable in AC | **Scan (the zero-click surface) is fully sandboxed:** dvdinfo reads only IFOs and bdinfo reads only BDMV metadata, none of which is encrypted, so both run in folder mode against `D:\`. ISO and folder rips are fully sandboxed. For **physical encrypted rips**, pick one: **(a)** a *sector broker*: the launcher (outside the AC) opens the device with the user's libdvdcss and serves decrypted sectors over a pipe to ffmpeg, which reads via `DVDOpenStream`/`dvdnav_open_stream` (present in the pinned libdvdread; needs an ffmpeg dvdvideodec patch). This is large and DVD-only; AACS needs libaacs in the broker. Or **(b)** ship physical encrypted rips under a weaker restricted-token + low-IL + job sandbox for 1.0, with the UI and docs stating it honestly, and add the broker after 1.0. Recommend (b) for 1.0 with (a) as P3, because scan stays fully sandboxed, which is the auto-scan / zero-click risk. Roadmap owner to confirm. |
| Neither works | Windows auto-scan stays off (SF-1 interim). Physical discs need an explicit click, then rip runs under restricted token + job. |

### macOS: deny-default, per-tool profiles

- `sandbox/macProfile.js` generates SBPL from the capability request:
  - `(version 1) (deny default)`
  - dyld/system allows **inlined**, not `(import "dyld-support.sb")`: that file is an Apple-private interface dated 2022, so it isn't guaranteed on macOS 12.
  - `(allow file-read* (subpath "/usr/lib") (subpath "/System/Library"))`, `file-map-executable` for the same plus BIN and the Homebrew lib dirs (only when `decrypt`)
  - `(allow sysctl-read)` restricted to the names actually used
  - `(allow file-read-metadata)` on path ancestors of granted paths only
  - `process-exec` of BIN only, no fork, `(deny network*)`, `(deny mach-lookup)` except an explicit list
- Chromium's `common.sb` is the reference for this structure.
- **AACS on macOS needs extra allows and an app-level change.** libaacs's darwin backend uses DiskArbitration to **force-unmount** the volume, then `IOCreatePlugInInterfaceForService` with the MMC user client and `ObtainExclusiveAccess`, then remounts (read in libaacs 0.11.1 `mmc_device_darwin.c`). So the bd tools need:
  - `mach-lookup` for `com.apple.DiskArbitration.diskarbitrationd`
  - an `iokit-open` user-client allow
  - **The app-level change:** `/Volumes/<label>` disappears mid-scan or mid-rip. Today `abandonVanishedSource()` would kill the job, and the renderer clears the disc. The watcher must ignore unmount/remount of the **active** AACS source for a grace window, keyed by device rather than mount path.

  Prototype this on the BU40N.
- **Tests:** a small C probe binary (`test/security/probe.c`) runs under each generated profile and attempts each must-deny action, emitting JSON. The must-deny actions are:
  - read `/private/tmp/x` and `/Library/Preferences/...`
  - stat `$HOME/*`
  - `bootstrap_look_up` on pasteboard, launchservicesd and tccd
  - TCP connect and unix-socket connect
  - exec `/bin/sh`
  - write outside staging

  `sandbox.test.js` asserts each one, per tool profile. Real engine runs on fixtures under each profile prove the allows are sufficient. Use `log stream --predicate 'sender=="Sandbox"'` during development to find missing allows.

### Linux: bwrap + seccomp + probe

1. **Functional probe at startup:** run `bwrap <same base args> -- <engineDir>/dvdinfo --selftest` once, cached for the session.
   - The result drives `info().sandbox` (`active`, `missing`, `blocked-by-apparmor`).
   - It gates auto-scan and auto-rip.
   - It replaces "bwrap file exists".
2. **seccomp:**
   - `engine/seccomp-gen.c` is a build-time tool linked against libseccomp. It exports cBPF with `seccomp_export_bpf` for x86_64 and aarch64, shipped as `engine/seccomp-<arch>.bpf`.
   - Main opens the file and passes it as fd 3 via `spawn(..., { stdio: ['ignore','pipe','pipe', fd] })`, then adds `--seccomp 3` to bwrap. This is why `run()` must move from `execFile` to `spawn`.
   - The filter is a Flatpak-style **blocklist** returning EPERM for:
     - ptrace, process_vm_*, keyctl family, bpf, perf_event_open, userfaultfd, io_uring_*
     - mount/umount/pivot_root, unshare/setns, clone with namespace flags, kexec/modules
     - personality changes, TIOCSTI/TIOCLINUX ioctls
     - socket for any family except AF_UNIX
   - `clone3` returns ENOSYS so glibc falls back to an inspectable `clone`.
   - **execve can't be denied here**, because bwrap installs the filter and then execs the target. That job goes to `lockdown.c` (Pattern 1 diagram): the engine's own late seccomp denies execve/execveat/socket after start, mirroring the macOS "exec BIN only" rule.
3. **Ubuntu 24.04+:** `kernel.apparmor_restrict_unprivileged_userns=1` makes stock `/usr/bin/bwrap` fail with "setting up uid map: Permission denied".
   - **.deb:** ship Spinarr's own pinned bwrap in `resources/engine/` plus `/etc/apparmor.d/spinarr-bwrap` granting `userns,` to that exact path. This is the same model Ubuntu uses for Chrome and other userns-dependent apps (MEDIUM confidence).
   - **AppImage:** it can't install a profile. The probe reports `blocked-by-apparmor`, auto-scan stays off, and the UI shows the fix.
   - Add an `ubuntu-24.04` CI job.

---

## Blu-ray and Angle Integration

### Scanner schema v2 (shared enabler: build once, used by four features)

- Add `"schema": 2` and `"discId"` to both scanners.
- **dvdinfo:**
  - per title: `angles`, plus `cells: [{pgcn, cell, first, last, angleBlock}]` (sector ranges)
  - a duration per angle when angle blocks differ
- **bdinfo:**
  - per playlist: `clips: [{id:"00012", in, out, pkts}]`
  - **aggregated streams across all clips**: union by PID, each with `presentIn` / `clipCount`
  - `mainHint`: from `bd_get_main_title()` after `bd_get_titles(TITLES_ALL)`, mapped to the playlist number
  - per-angle clip lists via `bd_get_title_info(bd, i, angle)`
- `lib.validateScan` enforces caps: ≤999 playlists, ≤4096 clips per playlist, numeric ranges.
- **Fuzz:** the new emitters change no parsing (they read libbluray/libdvdread structs), but the corpus replay must cover the new fields.

### Obfuscation-aware main title (in `lib/analyze-bd.js`, pure JS)

What `bd_get_main_title` actually does (read in the pinned libbluray 1.5.0 `navigation.c`):

1. Drop exact duplicates (`_pl_cmp`) and playlists that repeat a segment more than twice (`_filter_repeats`).
2. Among the rest, prefer more chapters, then better video and HD audio, then "known" playlists, then longer, then more streams.

Decoy playlists that use the **same clips in a different order** pass both filters, so libbluray alone does **not** solve obfuscation. HIGH confidence; read in the source.

Recommended v1.0 approach:

1. Use `mainHint` as the baseline.
2. Compute **obfuscation clusters**: playlists with an identical clip *multiset* and duration but a different order. If the winner's cluster has more than one member, set `confidence = 'low'` and `obfuscated = n`.
3. Cheap tie-breakers within a cluster, in order, each marked as a heuristic:
   - a strictly ascending, contiguous clip sequence
   - fewest backward jumps in clip IDs
   - `mainHint`
4. **Low confidence never auto-rips.** Manual mode shows the cluster ("this disc has 48 look-alike versions of the movie; Spinarr picked 00800.mpls") and lets the user choose. AutoRip goes to `needs-user`.
5. **Defer (research flag)** to after 1.0:
   - frame-continuity scoring at segment boundaries (the MakeMKV-forum SSIM approach: needs decode and compare, 3–4 min per disc)
   - `index.bdmv` / `MovieObject.bdmv` title→playlist hints (needs a new untrusted-binary parser in C, which means a new fuzz target)

### Stream aggregation pitfall

ffmpeg's `bluray:` input resolves `-map 0:N` at open time from what it probes at the start of the playlist (clip 0). A stream that first appears in clip 3 may be **unmappable** even once bdinfo reports it.

- Verification step 2 (read vs muxed per stream) detects the partial case.
- The UI must flag `presentIn < clipCount` streams.

MEDIUM confidence. Needs a fixture with differing per-clip streams (tsMuxer is already in `test/tools`).

### Angles

- **DVD:** `ffmpeg -f dvdvideo -angle N` is **1-based**, range 1–9 (`dvdvideodec.c:1859`).
- **Blu-ray:** `bluray:` protocol `-angle N` is **0-based**, range 0–254 (`bluray.c:46`).
- Keep the angle 1-based in the job model and the UI, and convert in `lib/args.js` with a unit test asserting the off-by-one.
- The expected duration for verification comes from the scanner's per-angle data.

---

## Release Pipeline Integration

| Step | Where | Notes |
|---|---|---|
| Engine build | per-OS job, as today | Add `spinarr-sandbox.exe` (Windows), `seccomp-*.bpf` + bundled `bwrap` (Linux) |
| **macOS engine pre-sign** | electron-builder `afterPack` hook | electron-builder gives every non-main Mach-O the **same** `entitlementsInherit` (`MacTargetHelper.getOptionsForFile`: main app gets `entitlements`, LoginItems get `entitlementsLoginHelper`, everything else gets `entitlementsInherit`), so there's no per-file entitlement config. Solution: `mac.signIgnore: ["Contents/Resources/engine/"]`, plus an `afterPack` hook (runs before signing) that runs `codesign --force --options runtime --timestamp --entitlements build/entitlements.engine.plist` (disable-library-validation **only**) on each engine binary. Main app and helpers then get JIT-only entitlements (SF-6). HIGH confidence on electron-builder behaviour (read in the installed 26.15.3). |
| Notarize | electron-builder built-in (`@electron/notarize`, notarytool) | Use the App Store Connect API key env vars (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`), supported by the installed version. Staple. Then verify in CI with `spctl -a -vv` and `codesign --verify --deep --strict` on **each engine binary**. |
| Windows sign | `win.azureSignOptions` (Azure Artifact Signing, formerly Trusted Signing) | Individual-developer public trust is available in the US and Canada. Engine `.exe`s in resources are signed by default (`shouldSignFile`: `.exe` is true). Verify `spinarr-sandbox.exe` and `ffmpeg.exe` with `signtool verify /pa` in CI. |
| Checksums + provenance | release job | `actions/attest` (the successor; `attest-build-provenance` is now a wrapper) over every artifact plus `SHA256SUMS.txt`, and optionally a minisign signature. Users verify with `gh attestation verify`. Needs `id-token: write` and `attestations: write`. |
| Supply chain | all workflows | Pin actions by SHA, including `softprops/action-gh-release` and `msys2/setup-msys2`. Pin meson. Dependabot for actions and npm. |

**Ordering implication:** start signing early, as a parallel track. Notarization is where hardened-runtime + dlopen + sandbox-exec interaction problems surface, and a signed `spinarr-sandbox.exe` reduces Defender/SmartScreen friction when testing the Windows sandbox with beta users.

---

## Build Order (dependency-ordered)

```
0. Interim gate ─────────────────────────────────────────────── (tiny; ship first)
   no auto-scan when sandbox inactive (SF-1 interim)

1. Foundations (no new features; unblock everything)
   1a EngineRunner (spawn, fd passing, ring buffer, caps API)  ──┐
   1b DiscCatalog + discId (scanner: discId only) + SF-9 fix    ├─► everything below
   1c OutputManager (reserve/staging/fsync/rename/sweep)        │
   1d Queue reducer + journal (extract, then persist)          ──┘

2. Sandbox everywhere (P0)            needs 1a (caps), 1c (staging = only writable dir)
   2a macOS deny-default per tool + probe tests
   2b Linux probe + seccomp + lockdown.c + 24.04 CI + deb AppArmor
   2c Windows: SPIKE → launcher → ledger → CI sandbox tests     (longest; start spike in phase 1)

3. Correctness                         needs 1b (truth), 1a (stderr tail), 1d (retry)
   3a Verification redesign (per-stream)
   3b Retries + failed-job retry UI + scratched-disc behaviour (M-4)

4. Scanner schema v2 + Blu-ray         needs 1b; AACS part needs 2a (IOKit/DA allows) + watcher fix
   4a dvdinfo/bdinfo v2 (cells, clips, aggregated streams, angles, mainHint)
   4b analyze-bd obfuscation clusters + confidence ; stream-presence flags
   4c Angles (DVD + BD) end to end
   4d AACS real-disc end to end in sandbox; large BD validation

5. Renderer refactor                   independent of 2-4; must precede 6's UI
   html.js + Trusted Types (CSP header) + views/ split + store regions

6. Collector workflow                  needs 1c (rel paths), 1d (groups), 4a (cells/clips), 5 (UI)
   6a naming.js presets (Plex/Jellyfin) + validateJob relPath
   6b episodes.js (TV detect, play-all skip via cell/clip overlap)
   6c MetadataSvc (TMDB) + match UI          (independent of 6b; after 6a)
   6d AutoRip controller + eject-after-rip   (last: consumes catalog, queue, naming, metadata, probe gate)

7. Release (parallel track from phase 1, finalised last)
   signing/notarization/attestation early; per-binary entitlements once the engine binary set is final (after 2c, 2b)
```

**Why this order:**

- **Phase 0 before everything:** it's one conditional in the renderer plus `info().sandbox`, and it removes the zero-click exposure on Windows and Linux immediately.
- **Phase 1 before phase 2:** every sandbox needs the capability API, and the staging dir is what makes Windows ACL grants cheap and macOS/Linux `OUT` narrow. Doing sandboxes first would mean writing three profiles against today's broad "output folder" grant, then rewriting them.
- **Phase 1d before 3b and 6d:** retries, batch mode, eject-after-rip and Windows crash recovery are all queue transitions. Extract first, then extend, or the same code gets rewritten three times.
- **Phase 4a before 4b, 4c and 6b:** one scanner schema change feeds obfuscation clusters, stream aggregation, angles and episode or play-all detection. The C changes ship in one pass with one corpus update.
- **Phase 2a before 4d:** AACS on macOS needs DiskArbitration and IOKit allows that only make sense inside the deny-default profile. Building AACS against the old allow-default profile hides the real requirements.
- **Phase 5 before phase 6:** the episode, TMDB-match and naming-preview UIs triple the untrusted-text surface. Land safe-by-default templating first.
- **Phase 6d last:** AutoRip is purely a consumer, and it must refuse to run unless the probe gate (phase 2) and high-confidence selection (4b, 6b) exist.
- **Phase 2c spike early:** its outcome can change Windows scope (broker versus restricted-token fallback), and that's the biggest unknown in the milestone.

---

## Scaling Considerations

The "scale" here is disc size, playlist count and queue length, not users.

| Scale | Concern | Approach |
|---|---|---|
| DVD (4–8 GB, ≤99 titles) | none | Current design is fine |
| Blu-ray 25–50 GB | Verification I/O; free space; fsync time | Use ffmpeg's own stats, not `-count_packets`. Free-space check must include staging (same volume as final). fsync of 50 GB takes seconds; show "finalizing" state. |
| Obfuscated BD (hundreds of playlists) | scan output size and time; UI list | Scanner caps at 999 (exists). Cluster in JS. Renderer shows clusters collapsed. `maxBuffer` 32 MB holds about 999 playlists × clips; measure on a real disc. |
| Batch of a shelf (50+ discs) | journal growth; history | Journal holds active and recent jobs only. "Ripped discs" history is a separate small `{discId, when, outputs}` ledger, which AutoRip uses to avoid re-ripping. |
| Queue ≤99 jobs | 250 ms broadcast | Region-scoped renders (Pattern 5). Send queue deltas instead of the full list only if profiling shows a need. |

### Scaling Priorities

1. **First bottleneck:** Blu-ray verification and finalize time on HDD outputs. Design it out with stats-based verification.
2. **Second bottleneck:** obfuscated-disc scan JSON size and analysis time. Measure on a real disc (P0-6 hardware run).

---

## Anti-Patterns

### Anti-Pattern 1: Parsing disc metadata in the main process "because it's just a small file"
**What people do:** Read `index.bdmv`, `MovieObject.bdmv` or IFOs in Node to improve heuristics.
**Why it's wrong:** Main has full user privilege, so this moves untrusted-binary parsing outside the sandbox and breaks the core value.
**Do this instead:** Extend the C scanners, emit JSON, validate it in `lib.validateScan`, and add a fuzz target for any new parser.

### Anti-Pattern 2: Granting the sandbox the user's output library
**What people do:** Pass `settings.outputDir` (or the Plex library root) as the writable path, as v0.1 does.
**Why it's wrong:**
- On Windows, ACE inheritance propagates across thousands of files: slow, and it leaves residue on a crash.
- On every OS, a compromised engine could overwrite or delete the user's existing library.
**Do this instead:** Use a per-job staging dir. Main does the final rename.

### Anti-Pattern 3: Trusting renderer-sent durations, playlists or paths
**What people do:** Accept `duration`, `fileName` or a full output path in the `rip` payload.
**Why it's wrong:** A compromised or buggy renderer then decides verification thresholds and write locations (SF-9).
**Do this instead:** The renderer sends `discId`, title, angle, stream indices and naming *fields*. Main derives everything else from the Catalog and `naming.render`.

### Anti-Pattern 4: Auto-retrying engine crashes
**What people do:** Retry any failed job N times.
**Why it's wrong:** A signal-killed engine on a crafted disc is a potential exploit attempt, and retries give it more chances.
**Do this instead:** Retry only read-error and verify failures. Signal deaths fail permanently, with the "stopped safely" message.

### Anti-Pattern 5: Treating the AACS unmount as "disc removed"
**What people do:** Kill the rip when `/Volumes/<label>` disappears.
**Why it's wrong:** libaacs on macOS force-unmounts and remounts the disc itself.
**Do this instead:** Track the active source by device (`/dev/diskN`) with a grace window. Only abandon the rip if the device itself is gone.

### Anti-Pattern 6: Embedding a project TMDB key in a GPL repo
**What people do:** Hardcode an API key so lookup "just works".
**Why it's wrong:** The key is public the moment it's committed, and revocation breaks every install. TMDB terms forbid concealing app identity, so a shared key ties every user's traffic to the project account.
**Do this instead:** Make lookup opt-in with the user's own read token for 1.0. The service is shaped so a project-owned proxy or key could be swapped in later without touching the renderer.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---|---|---|
| TMDB API v3 | Main-only `session.fromPartition('spinarr-metadata').fetch`; allow-listed endpoints; Bearer read token from `safeStorage` | Attribution and logo required; caching ≤6 months; non-commercial license fits GPL/free. Rate-limit client-side. |
| Apple notary service | electron-builder notarize (notarytool) with an API key | Engine binaries must be hardened-runtime signed (afterPack) or notarization fails |
| Azure Artifact Signing | `win.azureSignOptions` | Requires `AZURE_*` client secret env in CI; individual identity validation (US/Canada) |
| GitHub attestations | `actions/attest` in the release job | Public repo: free; verify with `gh attestation verify` |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| Renderer ↔ Main | `invoke`/`handle` plus 3–5 allow-listed events | New channels: `metadata:search/details/season/set-token/clear`, `queue:retry`, `autorip:get/set`, `rip` payload v2 (discId + naming fields). Each needs a validator plus an e2e hostile-call case. |
| Main ↔ Engine | argv + stdout JSON / `-progress` + stderr; exit code | Engine never gets env beyond `engineEnv`; caps decide every path. Windows adds the launcher stdin control channel. |
| Catalog ↔ Queue | direct calls (same process) | Queue stores only `discId` + title refs; it asks the Catalog for truth at prepare time |
| AutoRip ↔ Queue | Queue events (`groupDone`, `jobFailed`) | AutoRip never mutates jobs directly; it enqueues and reacts |
| MetadataSvc ↔ everything | async API returning DTOs | The only module allowed to import `session.fetch`. Enforce with a unit test that greps `app/` for `fetch(` / `net.` outside `metadata/`. |
| Launcher ↔ Main (Windows) | argv, exit code, ledger file, stdin EOF | Ledger is the crash-recovery contract; `--revoke-ledger` on boot |

---

## Open Questions / Research Flags for Phases

1. **Windows raw device in AppContainer (phase 2c, critical):** spike `CreateFile("\\\\.\\D:")` plus DVD and SCSI pass-through IOCTLs from a no-capability AC, and file reads on `D:\` (UDF). The outcome decides broker versus restricted-token for physical encrypted rips. LOW confidence it works.
2. **macOS AACS under deny-default (phase 4d):** the exact `iokit-open` user-client class and mach services libaacs needs, and the volume-watcher grace behaviour during unmount/remount. Needs the BU40N.
3. **Verbose log volume (phase 3a):** dvdvideo/bluray demuxer chatter at `-v verbose` over a 2-hour title. The ring buffer makes it safe, but confirm the summary lines are always in the tail.
4. **Late-appearing BD streams (phase 4b):** confirm `-map` behaviour when a PID first appears after clip 0. May need `-map 0:i:<pid>` or a documented "unsupported" flag.
5. **Trusted Types via response header on a custom `app://` scheme (phase 5):** verify Electron 44 enforces it from `protocol.handle` responses. Fallback: keep the meta CSP and lint for raw `innerHTML`.
6. **Ubuntu 24.04 deb AppArmor profile for a bundled bwrap (phase 2b):** validate in a 24.04 VM. Also confirm Electron's own sandbox on 24.04 (the deb may already need a profile for the main binary).
7. **Episode heuristics (phase 6b):** thresholds need real TV discs (owned: multi-angle/TV DVDs). Play-all detection via cell-range overlap is HIGH confidence for DVD and MEDIUM for BD (clip overlap).

---

## Sources

- Pinned sources read directly in `engine/deps` (HIGH):
  - libbluray 1.5.0 `bluray.h` (`bd_get_main_title`, `TITLES_FILTER_*`, `bd_select_angle`, `BLURAY_DISC_INFO.disc_id`) and `bdnav/navigation.c` (`_pl_cmp`, `_filter_repeats`, `_pl_guess_main_title`)
  - ffmpeg 8.0.1 `libavformat/dvdvideodec.c:1859` (angle 1–9), `libavformat/bluray.c:46` (angle 0–254), `fftools/ffmpeg_demux.c:846` and `fftools/ffmpeg_mux.c:732` (per-stream packet stats at VERBOSE)
  - libdvdread `dvd_reader.h` (`DVDDiscID`, `DVDOpenStream`)
- libaacs 0.11.1 source, `src/file/mmc_device_darwin.c` (DiskArbitration force unmount, MMC user client, exclusive access) and `mmc_device_win32.c` (`CreateFile` read/write + `IOCTL_SCSI_PASS_THROUGH_DIRECT`), from https://download.videolan.org/pub/videolan/libaacs/0.11.1/ (HIGH)
- electron-builder 26.15.3 installed source, `app-builder-lib/out/mac/MacTargetHelper.js` (`getOptionsForFile`, `signIgnore`, notarize env vars) and `winPackager.js` (`shouldSignFile`) (HIGH)
- Microsoft Learn, UpdateProcThreadAttribute (SECURITY_CAPABILITIES, JOB_LIST, CHILD_PROCESS_POLICY, MITIGATION_POLICY, HANDLE_LIST): https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute (HIGH)
- AppContainer access-check requirements and device ACL defaults: https://learn.microsoft.com/en-us/windows-hardware/drivers/storage/acls-and-the-device-stack, https://scorpiosoftware.net/2019/01/15/fun-with-appcontainers/, https://github.com/microsoft/mxc/issues/1109, https://github.com/openai/codex/issues/45871 (MEDIUM; device access from AC unverified, so LOW)
- bubblewrap `bwrap.xml` (`--seccomp FD`, `--add-seccomp-fd`, `--die-with-parent`), via `gh api repos/containers/bubblewrap` (HIGH)
- Ubuntu 24.04 userns restriction and bwrap: https://etbe.coker.com.au/2024/04/24/ubuntu-24-04-bubblewrap/ and https://github.com/Matoking/protontricks/issues/400 (MEDIUM)
- Chromium seatbelt `common.sb` (deny-default structure) and macOS `/System/Library/Sandbox/Profiles/dyld-support.sb` (inspected locally; Apple-private, 2022) (MEDIUM)
- Blu-ray obfuscation approaches: https://forum.makemkv.com/forum/viewtopic.php?t=15570 (SSIM boundary method), https://github.com/yxbh/bdpl (segment signatures, index/MovieObject hints, play-all decomposition) (MEDIUM/LOW)
- TMDB API terms (attribution, 6-month cache limit, non-commercial): https://www.themoviedb.org/api-terms-of-use (HIGH)
- Azure Artifact Signing eligibility and electron-builder `azureSignOptions`: https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart, https://github.com/Azure/artifact-signing-action/issues/42 (MEDIUM)
- Build provenance: https://github.com/actions/attest-build-provenance (now wraps `actions/attest`) (HIGH)
- Existing code: `app/main.js`, `app/lib.js`, `app/platform.js`, `app/renderer/app.js`, `engine/*.c`, `engine/build.sh`, `.github/workflows/release.yml`, `package.json` (HIGH)

---
*Architecture research for: Spinarr v1.0 (sandboxed lossless disc ripper)*
*Researched: 2026-10-10*
