# Phase 1: Safety Gate & CI Baseline - Pattern Map

**Mapped:** 2026-10-10
**Files analyzed:** 33 (new + modified, from 01-CONTEXT.md and the 01-RESEARCH.md "Recommended file touch map")
**Analogs found:** 26 / 33 (7 config/doc files have no in-repo analog; use RESEARCH.md shapes)

All line numbers are from the `milestone/v1.0` working tree as of 2026-10-10.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `app/lib.js` (+ `validateScanOptions`, `scanGate`, `SANDBOX_OFF`) | utility (pure validation) | transform | `app/lib.js` `validateTitle` / `validateJob` / `sanitizeSettingsPatch` (259-302) | exact |
| `app/main.js` (`sandboxTrusted()`, gated `scan`/`probe`/`rip`, `system`, `SPINARR_TEST_HOME`, remove `open-dvdcss-page`) | controller (IPC handlers) | request-response | `app/main.js` `handle()` + existing handlers (408-486); test-hook pattern (30, 99, 138) | exact |
| `app/platform.js` (remove `VIDEOLAN_WIN64`) | service (platform adapter) | config | itself (9, 289-291, 348) | exact (removal) |
| `app/preload.js` (remove `openDvdcssPage`) | bridge / config | request-response | itself (6-32) | exact (removal) |
| `app/renderer/app.js` (`requestScan`/`confirmScan`, `state.pendingScan`, prompt banner, neutral DLL copy, all entry points funnelled) | component (renderer UI) | event-driven | `loadSource` (425-446), KEYDB banner (187-188), click switch (552-600), `drives-changed` (724-733), boot (736-757) | exact |
| `test/unit/lib.test.js` (+ gate cases) | test (unit) | transform | `validateTitle` / `validateJob` / `sanitizeSettingsPatch` tests (131-178) | exact |
| `test/unit/gate-static.test.js` (new) | test (static source check) | file-I/O | `test/unit/lib.test.js` "every skin has styles..." (156-165) | role-match |
| `test/unit/neutrality.test.js` (new) | test (repo grep) | file-I/O | same skin test (156-165) + RESEARCH sketch | role-match |
| `test/unit/platform.test.js` (drop `url`/`VIDEOLAN` asserts if any; add `home` hermetic case) | test (unit) | transform | `createPlatform` per-OS test (73-93) | exact |
| `test/e2e/harness.js` (prompt-aware `h.load`, `fakeInsert`, `dropFile`, `stubDialog`, `platform` in ctx) | test harness | event-driven | `load`/`waitFor`/`click` helpers (20-48) | exact |
| `test/e2e/run.js` (`SPINARR_TEST_HOME`, scrub XDG/APPDATA, CI sentinel) | test runner | batch | its own env block (21-36) + settings write (69-71) | exact |
| `test/e2e/scenarios.js` (`gate_*`, `sec_gate_ipc`, `sec_hermetic_keydirs`, `us_default_chapters`, update `sec_renderer_isolation`, `sec_ipc_validation`) | test (e2e) | event-driven | `us_mounted_image_and_eject` (330-350), `sec_ipc_validation` (61-103), `us_settings_persist` (290-308), `us_bluray_encrypted` (444-461) | exact |
| `test/engine/engine.test.js` (`.exe` existence, `accurateChapters:false` variant) | test (integration) | batch | itself (17-22, 24-35) + `test/security/sandbox.test.js` `platform.exe` (15, 19) | exact |
| `test/engine/bluray.test.js` (`.exe` existence) | test (integration) | batch | same | exact |
| `test/security/corpus.test.js` (tool paths on Windows, if needed) | test (corpus replay) | batch | itself (10-13) | exact |
| `.github/workflows/ci.yml` (SHA pins, toolchain pins, c8 on Linux, Windows full suite, zizmor + Electron audit in `audit`) | config (CI) | batch | itself (current structure 1-187) | exact |
| `.github/workflows/release.yml` (SHA pins, remove caches, pin meson, pin softprops v3.0.3) | config (CI) | batch | itself (1-119) | exact |
| `package.json` (`c8` devDep, `test:coverage` script) | config | n/a | `scripts` block (9-23), `devDependencies` (24-27) | exact |
| `.gitignore` (+ `coverage/`) | config | n/a | itself ("generated test media and reports" block) | exact |
| `SECURITY.md` (fallback email, truthful gate wording) | docs | n/a | itself ("Reporting" and "How Spinarr is hardened") | exact |
| `README.md` (line 69 Windows row; line 75 auto-detect claim) | docs | n/a | itself (57-70) | exact |
| `docs/ENCRYPTED_DISCS.md` (line 37) | docs | n/a | itself (25-39) | exact |
| `docs/SECURITY_TESTING.md` (lines 38, 94) | docs | n/a | itself | exact |
| `.github/ISSUE_TEMPLATE/config.yml` (+ `contact_links`) | config | n/a | itself (1 line today) | partial |
| `.c8rc.json` (new) | config | n/a | none | no analog |
| `.nvmrc` (new) | config | n/a | none | no analog |
| `.github/requirements-build.txt` (new) | config | n/a | none | no analog |
| `.github/dependabot.yml` (new) | config | n/a | none | no analog |
| `.gitattributes` (new) | config | n/a | none | no analog |
| GitHub repo settings (private reporting, alerts, security fixes) | ops (API) | request-response | none in repo | no analog |
| Branch protection on `main` (last step) | ops (API) | request-response | none in repo | no analog |

---

## Pattern Assignments

### `app/lib.js` — add `validateScanOptions`, `scanGate`, `SANDBOX_OFF` (utility, transform)

**Analog:** `app/lib.js` itself. Header comment (line 1) says "Pure logic shared by the main process and the test suite. No Electron imports." Keep the new gate there so c8 counts it (main.js is excluded from coverage).

**Section placement:** under `// ---------- input validation (everything from the renderer is untrusted) ----------` (line 182), next to `validateTitle` (259).

**Strict-boolean validation pattern** (lines 259-262, 277, 287):
```js
function validateTitle(n) {
  if (!isInt(n, 1, MAX_TITLE)) throw new Error('Invalid title number');
  return n;
}
// inside validateJob:
    accurateChapters: j.accurateChapters === true,
// SETTINGS_SCHEMA:
  accurateChapters: (v) => (typeof v === 'boolean' ? v : undefined),
```
`validateScanOptions` copies the `=== true` rule from line 277 (anything non-`true` is `false`) and the object-shape guard from `validateJob` line 265:
```js
  if (!j || typeof j !== 'object') throw new Error('Invalid job');
```

**Error message style:** plain sentence, no codes, except the new `SANDBOX_OFF:` prefix (RESEARCH Pattern 1), which the renderer matches with `startsWith`. Existing human messages to mirror tone: `blurayBlocker` (211-226).

**Export pattern** (lines 304-309): add the new names to the `module.exports` object, grouped with `validateSource, validateTitle, validateJob`:
```js
module.exports = {
  prettyName, safeFile, uniquePath, blurayBlocker, analyzeTitles, ripArgs, progressParser, ripVerdict,
  sourceKind, chaptersMetadata, blurayRipArgs, outputVideoSeconds,
  SANDBOX_PROFILE, sandboxed, volumeKind,
  validateSource, validateTitle, validateJob, sanitizeSettingsPatch, SKINS,
};
```

---

### `app/main.js` — gate + hermetic hook + removals (controller, request-response)

**Analog:** `app/main.js` itself.

**Imports** (lines 1-8) stay unchanged. `shell` is still needed for `reveal` (line 432) after `open-dvdcss-page` is removed, so do not drop it from the destructure.

**IPC wrapper** (lines 408-415). All args pass through, so `scan(source, opts)` needs no wrapper change:
```js
// Only our own page may call in; arguments are validated in each handler.
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (e.senderFrame?.url !== INDEX_URL || e.sender !== win?.webContents) throw new Error('Unauthorized');
    return fn(...args);
  });
}
```

**Current handlers to replace** (lines 425-427, 440):
```js
handle('scan', (source) => scan(lib.validateSource(source)));
handle('probe', (source, title) => probeTitle(lib.validateSource(source), lib.validateTitle(title)));
handle('rip', (jobs) => enqueue(jobs));
...
handle('system', () => platform.info());
```
Replace with the RESEARCH Pattern 1 shapes: validate first (`lib.validateSource`, then `lib.validateScanOptions`), then `lib.scanGate(...)`, then throw `new Error(refusal)`.

**Where `sandboxTrusted()` goes:** right after `NO_SANDBOX` (line 138), which it depends on:
```js
const NO_SANDBOX = process.env.SPINARR_NO_SANDBOX === '1' && !app.isPackaged;
const ENGINE_ENV = platform.engineEnv;
```

**Scan-results map used by the probe/rip piggyback** (lines 169-171, 196-197):
```js
// Scan results stay in the main process: Blu-ray rips are built from them, never from
// renderer-supplied stream or playlist data.
const scans = new Map();
...
  if (scans.size > 50) scans.delete(scans.keys().next().value);
  scans.set(source, result);
```

**Rip gate insertion point:** `enqueue()` per-job map (lines 259-269), right after `lib.validateJob(j)`. Copy the error wording from `scannedTitle` (line 204): `'Scan the disc again before ripping'`. The map is all-or-nothing (comment at 269), so a throw there enqueues nothing:
```js
  const clean = jobs.map((j) => {
    const job = lib.validateJob(j);
    const disc = scans.get(job.source);
    ...
  }); // all-or-nothing
```

**Test-hook pattern for `SPINARR_TEST_HOME`** (lines 30, 32-36, 99). Every hook is guarded by `!app.isPackaged`:
```js
if (process.env.SPINARR_USER_DATA && !app.isPackaged) app.setPath('userData', process.env.SPINARR_USER_DATA);
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
// Platform specifics (drives, sandbox, decryption libraries). Test hooks are ignored when packaged.
const platform = createPlatform({
  run, dataDir: app.getPath('userData'),
  env: app.isPackaged ? { ...process.env, SPINARR_VOLUMES: '' } : process.env,
});
```
Extend this exact `createPlatform` call with `home:` and a scrubbed `env:` (RESEARCH Pattern 3). `createPlatform` already takes `home` (platform.js line 117), so no platform change is needed for the hook.

**Removal:** line 457, `handle('open-dvdcss-page', () => { const u = platform.dvdcss().url; if (u) shell.openExternal(u); });`. Keep `install-dvdcss` (442-448). Its comment "we never download or ship it" is neutral.

**Picker handler** (lines 459-471): leave it unchanged. It only returns a path and never scans, so the gate lives in `scan`. If the `dialog` monkey-patch (RESEARCH A1) fails, the fallback `SPINARR_TEST_PICK` hook goes at the top of this handler, guarded like line 30.

---

### `app/platform.js` — neutrality removal (service, config)

**Analog:** itself. Three edits:
- Line 9: `const VIDEOLAN_WIN64 = 'https://download.videolan.org/pub/libdvdcss/1.2.11/win64/';` → delete.
- Lines 289-291:
  ```js
      if (isWin) {
        return { installed: exists(P.join(userLib, 'libdvdcss-2.dll')), url: VIDEOLAN_WIN64, canPick: true };
      }
  ```
  → drop the `url` field. Keep `canPick: true`, which `test/unit/platform.test.js:91` asserts.
- Line 348: drop `VIDEOLAN_WIN64` from `module.exports`.
- Header comment lines 1-3 ("how to tell the user to install libdvdcss") stays accurate.

`info()` (line 344) is the existing sandbox signal. Don't add the trusted flag here. Main overrides `sandbox` and adds `sandboxTrusted` (RESEARCH Pattern 1), so that later probe phases replace one function in main.

---

### `app/preload.js` — remove the `openDvdcssPage` bridge (bridge, request-response)

**Analog:** itself (lines 4, 10, 23). `invoke` forwards `...a`, so `scan: invoke('scan')` already carries `(source, opts)`:
```js
const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
...
  scan: invoke('scan'),
...
  openDvdcssPage: invoke('open-dvdcss-page'),   // <- delete this line
```
**Coupled test:** `test/e2e/scenarios.js:42-43` bridge-key list must drop `'openDvdcssPage'`.

---

### `app/renderer/app.js` — scan chokepoint + prompt + neutral copy (component, event-driven)

**Analog:** itself.

**State object** (lines 23-42): add `pendingScan: null` next to `scanning`/`error`. Update the comment on line 40 (`dvdcss: { installed, command?, url?, canPick? }`) to drop `url?` and to add `sandboxTrusted`.

**Existing scan function to wrap** (lines 425-446). This is the only `spinarr.scan(` call today (line 433). It becomes `loadSource(src, opts)` → `spinarr.scan(src, opts)`, and the `catch` maps `SANDBOX_OFF` back to the prompt:
```js
async function loadSource(src) {
  state.source = src;
  state.scanning = true;
  state.error = null;
  state.disc = null;
  Object.assign(state, { selected: new Set(), open: new Set(), probes: new Map(), tracks: new Map(), fileNames: new Map() });
  renderSources(); renderMain();
  try {
    const disc = await spinarr.scan(src);
    if (state.source !== src) return;
    ...
  } catch (e) {
    state.error = cleanErr(e);
  }
  state.scanning = false;
  ...
}
```
`cleanErr` (line 50) strips the Electron "Error invoking remote method" prefix. Match `SANDBOX_OFF` on `cleanErr(e)`, not on the raw message.

**Prompt markup: copy the KEYDB banner** (lines 187-188):
```js
      ${d.blocked ? `<div class="error-box banner" role="alert">${ICON.alert}<div><b>This disc can't be ripped</b><span>${esc(d.blocked)}</span>
        ${d.keydbFixable ? `<div class="row-btns"><button class="ghost-btn" data-action="keydb-pick">Choose KEYDB.cfg…</button></div>` : ''}</div></div>` : ''}
```
**Placement:** inside the `!state.disc` empty state (lines 126-147), where `state.error` already renders an `.error-box` at line 132. Render the prompt there when `state.pendingScan` is set. Use `.primary-btn` for "Scan anyway" (`data-action="scan-anyway"`) and `.ghost-btn` for "Not now" (`data-action="scan-cancel"`). Styles already exist: `styles.css:349-357` (`.error-box`, `.error-box.banner`), `:691-693` (`.row-btns`), `:170-195` (`.ghost-btn`, `.primary-btn`). No new CSS is required, but check each skin override (`[data-skin=...] .primary-btn`, e.g. styles.css:847-849). Wrap the name in `esc(baseName(src))` (`baseName` is at line 52).

**Click dispatch: add cases here** (lines 573-599):
```js
  switch (t.dataset.action) {
    case 'open': openPicker(); break;
    case 'open-folder': openPicker('folder'); break;
    case 'dvdcss-page': spinarr.openDvdcssPage(); break;   // <- delete
    case 'dvdcss-pick': ...
```
Add `case 'scan-anyway': confirmScan(); break;` and `case 'scan-cancel': ...`. `confirmScan` must be reachable **only** from this case (gate-static test).

**Entry points to reroute to `requestScan(src)`** (each one currently calls `loadSource` directly):
| Line | Entry point | Current code |
|---|---|---|
| 536 | picker | `async function openPicker(kind = ...) { const p = await spinarr.pickSource(kind); if (p) loadSource(p); }` |
| 564 | sidebar `[data-src]` click | `if (t.dataset.src) { if (t.dataset.src !== state.source \|\| !state.disc) loadSource(t.dataset.src); return; }` |
| 588 | KEYDB installed re-scan | `if (state.disc?.blocked && state.source) loadSource(state.source);` |
| 701 | drag-drop | `if (p) loadSource(p);` |
| 731 | `drives-changed` insert | `if (inserted && !state.scanning && !state.queue.some((j) => j.state === 'ripping')) loadSource(inserted.path);` |
| 755-756 | boot | `const optical = state.drives.discs.find((d) => d.kind === 'optical'); if (optical) loadSource(optical.path);` |

The comment at line 727 ("Only physical discs scan automatically; images and other volumes wait for a click.") must be updated to describe the gate.

**Sandbox-dependent copy already keyed on `state.system.sandbox`:** lines 142-144 (empty-state feature list), 381-386 (`sandboxText`, `sandboxNote`) and 405 (status dot). If main reports `sandbox: 'none'` under `NO_SANDBOX`, these stay consistent with no further edits.

**Neutral DLL copy** (lines 391-394). Replace it with D-19 wording and keep only the `dvdcss-pick` button:
```js
    : d.canPick
      ? `Needed for most commercial DVDs. Download <b>libdvdcss-2.dll</b> (64-bit) from VideoLAN, then choose it here.
         <div class="row-btns"><button type="button" class="ghost-btn" data-action="dvdcss-page">Open VideoLAN download</button>
         <button type="button" class="ghost-btn" data-action="dvdcss-pick">Choose DLL…</button></div>`
```

**Synchronous-render rule (Pitfall 4):** follow the `if (state.scanning) {...}` early-return style in `renderMain` (115-125). `requestScan`'s untrusted branch sets state and calls `renderSources(); renderMain();` with no `await` before it.

---

### `test/unit/lib.test.js` — gate truth-table cases (test, transform)

**Analog:** lines 131-135 and 167-178. The file imports at lines 1-6 (`const { test } = require('node:test'); const assert = require('node:assert/strict'); ... const lib = require('../../app/lib');`).

Truth-table style to copy (line 134):
```js
test('validateTitle', () => {
  assert.equal(lib.validateTitle(1), 1);
  assert.equal(lib.validateTitle(999), 999);
  for (const bad of [0, 1000, -1, 1.5, '1', NaN, null, '1; rm -rf /']) assert.throws(() => lib.validateTitle(bad));
});
```
Non-boolean coercion check to copy (lines 141, 145, 176): `accurateChapters: 'yes'` → `false`, `accurateChapters: 1` rejected. Apply the same to `userConfirmed: 'true' | 1 | {}`.

---

### `test/unit/gate-static.test.js` and `test/unit/neutrality.test.js` (test, file-I/O)

**Analog:** the source-reading unit test in `test/unit/lib.test.js` lines 156-165:
```js
test('every skin has styles and a picker option, and nothing else does', () => {
  const root = path.join(__dirname, '..', '..', 'app', 'renderer');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const picker = [...html.matchAll(/name="skin" value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(picker, lib.SKINS);
  ...
});
```
- **gate-static:** read `app/renderer/app.js`, count `spinarr.scan(` matches (expect exactly the chokepoint sites), and assert `userConfirmed: true` appears only inside `confirmScan`.
- **neutrality:** use the RESEARCH "Neutrality guard" sketch (`git ls-files README.md docs app SECURITY.md`). Scope it so `engine/build.sh:38-40` (libdvdread/libbluray source URLs), `docs/SECURITY_TESTING.md:128` ("send ... to VideoLAN and FFmpeg") and `CLAUDE.md` don't trip it. Check line 128 against the regex: it contains "VideoLAN" but no `dll|download`, so the sketch regex passes.
- Header style: one-line purpose comment like `test/security/corpus.test.js:1-2`.

---

### `test/unit/platform.test.js` (test, transform)

**Analog:** lines 73-93. Model per-OS platforms with explicit `home` and `env`:
```js
  const linux = createPlatform({ run, platform: 'linux', home: '/home/me', env: { XDG_CACHE_HOME: '/home/me/.c' } });
  assert.equal(linux.cssCache, '/home/me/.c/dvdcss');
  assert.equal(linux.keyDirs.aacsConf, '/home/me/.config/aacs');
```
Add a case showing that `env: { XDG_CONFIG_HOME: '', XDG_CACHE_HOME: '' }` falls through to `home` (platform.js 138-139 use `||`). This unit-proves the hermetic-home scrub. Line 91 `win.info().dvdcss.canPick` stays. Assert `!('url' in win.info().dvdcss)`.

---

### `test/e2e/harness.js` — prompt-aware load + drivers (test harness, event-driven)

**Analog:** itself, lines 20-48.

**Current `load`, to rewrite** (lines 40-43):
```js
  const load = async (src) => {
    await js(`loadSource(${JSON.stringify(src)})`);
    await waitFor('!state.scanning', { what: 'scan to finish' });
  };
```
Rewrite it per RESEARCH Pattern 2: `js('requestScan(...)')` → `waitFor('state.pendingScan || state.scanning || state.disc || state.error')` → if `pendingScan`, `click('[data-action="scan-anyway"]')` → `waitFor('!state.scanning && !state.pendingScan')`. Reuse the existing `click` (line 39) and `waitFor` (21-29). Don't add a bypass.

**Helper object to extend** (line 48). Add `fakeInsert`, `dropFile` and `stubDialog` here, plus `platform` via `ctx` (main.js line 100 passes `{ queue }`; add `platform`):
```js
  const h = { win, app, ctx, js, waitFor, shot, click, load, idle, probe, note, sleep, assert, fx: (n) => path.join(FX, n), outDir, launch };
```
**`fakeInsert` channel:** `win.webContents.send('drives-changed', ...)` is what main does (main.js line 103 `send`, line 154). The renderer listener is app.js 724.

**Oracle path portability** (line 45) already handles `.exe`:
```js
  const probe = (file) => JSON.parse(execFileSync(path.join(process.env.ORACLE_FFMPEG_DIR || '/usr/local/bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'), [...]));
```

---

### `test/e2e/run.js` — hermetic home (test runner, batch)

**Analog:** itself. Add `SPINARR_TEST_HOME` to the child env block (lines 21-36), next to `SPINARR_USER_DATA`. Per-scenario `env` is spread last (line 33), so scenarios can still override:
```js
      env: {
        ...process.env,
        SPINARR_TEST: path.join(__dirname, 'harness.js'),
        ...
        SPINARR_USER_DATA: env.userData,
        ...
        // Hermetic: only the test images count as drives, never a real disc in the user's drive.
        SPINARR_VOLUMES: 'NTSC_BASIC,THE_TEST_MOVIE_DISC_1',
        ...(scenarios[name].env || {}),
      },
```
The tmp dir is created per scenario at line 62-64 (`env.tmp`, `env.userData`). Add `home: path.join(tmp, 'home')` there. Settings default (lines 69-71) keeps `accurateChapters: true`. `us_default_chapters` overrides it via `env.settings` in `setup()`, like `us_low_disk_space` line 319.

**CI sentinel** (guarded by `process.env.CI === 'true'`): runs in the runner process before the scenario loop (line 53 area, beside `detachFixtureImages()`).

---

### `test/e2e/scenarios.js` — gate and hermetic scenarios (test, e2e)

**Scenario object shape** (from `us_mounted_image_and_eject`, lines 330-350, the closest analog for "not auto-scanned → click → scans"):
```js
  us_mounted_image_and_eject: {
    platforms: ['darwin'], // builds and mounts disk images with hdiutil
    stories: ['US-01', 'US-18', 'SEC-10'],
    title: 'A mounted image appears in Sources but is not auto-scanned; click scans; eject removes it',
    after() { detach('/Volumes/NTSC_BASIC'); },
    async run(h) {
      ...
      await h.sleep(2000);
      h.assert.equal(await h.js('state.disc'), null, 'disk images are not scanned automatically');
      ...
      await h.click('[data-src="/Volumes/NTSC_BASIC"]');
      await h.waitFor('state.disc && state.disc.titles.length === 2');
```
New `gate_insert`, `gate_drop`, `gate_pick_iso` and `gate_pick_folder` follow this exactly. They need no `platforms` key (they run everywhere) and they add `env: { SPINARR_NO_SANDBOX: '1' }` (env-key style from `us_queue_progress_cancel`, line 237). Note: this scenario clicks `[data-src]` and runs under the macOS sandbox, so it's unaffected unless NO_SANDBOX is set (Pitfall 2).

**IPC rejection helper** (line 27), for `sec_gate_ipc` (direct `spinarr.scan(src)` → `SANDBOX_OFF`; probe/rip of an unscanned source refused):
```js
const call = (h, expr) => h.js(`(${expr}).then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e && e.message) }))`);
```
Use it the same way `sec_ipc_validation` does (lines 80-83).

**`sec_ipc_validation` update** (lines 96-101). The traversal rip calls `spinarr.rip` on a never-scanned source. When this runs untrusted (Windows), add `await h.load(src)` before it.

**Banner assertion pattern** (lines 450, 453-454):
```js
      h.assert.match(await h.js(`document.querySelector('.error-box.banner').textContent`), /encrypted \(AACS\).*(libaacs|KEYDB\.cfg|AACS files|handshake)/);
      h.assert.equal(await h.js(`!!document.querySelector('.error-box.banner [data-action="keydb-pick"]')`), false, ...);
```
**Multi-launch/settings pattern** for `us_default_chapters`: `us_settings_persist` (290-308), and the `setup(env){ env.settings = {...} }` pattern from line 319.

**Bridge-key list** (lines 42-43): remove `'openDvdcssPage'`.

---

### `test/engine/engine.test.js`, `test/engine/bluray.test.js`, `test/security/corpus.test.js` — Windows portability (test, batch)

**Analog for portable exe names:** `test/security/sandbox.test.js` lines 15, 19:
```js
const platform = createPlatform({ run: async () => '', env: {} });
...
  const [cmd, a] = platform.wrap(path.join(ENGINE, platform.exe('ffmpeg')), args, { engineDir: ENGINE, source: SOURCE, outDir });
```
**Lines that break on Windows (`existsSync` without `.exe`):**
- `engine.test.js:19`: `for (const b of ['dvdinfo', 'ffmpeg', 'ffprobe']) assert.ok(fs.existsSync(path.join(BIN, b)), ...)`
- `bluray.test.js:21`: `assert.ok(fs.existsSync(path.join(BIN, 'bdinfo')), ...)`

**Spawn sites** that rely on libuv's `.exe` lookup (A3): `engine.test.js:25, 33, 37, 40-43`, `bluray.test.js:25`, and `corpus.test.js:10-12` (tool paths). The oracle sites use `path.join(ORACLE, 'ffprobe')` with no suffix, unlike harness.js line 45. Apply the same `exe()` helper to be safe.

**`accurateChapters:false` variant:** `engine.test.js:31` hardcodes `accurateChapters: true` in `rip()`. Parameterize it and add one LOSSLESS case with `false` (the LOSSLESS table at 108-114).

---

### `.github/workflows/ci.yml` (config, batch)

**Analog:** itself. Keep the structure, job ids `macos` / `linux` / `windows` / `audit` (no `name:` keys: these are the required-check contexts), `permissions: contents: read` (lines 8-9) and `persist-credentials: false` on every checkout.

**Steps to change, by line:**
| Lines | Today | Change |
|---|---|---|
| 18, 22, 31, 50, 61, 65, 78, 97, 106, 117, 121, 130, 136, 155, 167, 178, 181 | `@v4` / `@v2` tags | SHA pin + `# vX.Y.Z` (RESEARCH SHA table) |
| 24, 67, 132, 183 | `node-version: 22` | `node-version-file: .nvmrc` |
| 28 | `brew install ... libdvdcss ...` | keep; add the D-21 comment above |
| 75 | `pip3 install --user 'meson>=1.3'` | `pip3 install --user --require-hashes -r .github/requirements-build.txt` |
| 89-91 (linux) | three `test:*` steps | `npm run test:coverage` + step summary + upload `coverage/` |
| 105 | `tar czf ... --exclude=src --exclude=bdsrc .` | drop `--exclude=src` |
| 114 | `runs-on: windows-latest` | `windows-2025` |
| 148-154 | unit + smoke only | add oracle download step (RESEARCH "Windows oracle step"), `test:security`, `test:engine` |
| 161-164 | `ORACLE_FFMPEG_DIR: ${{ github.workspace }}\engine\bin` | the pinned oracle dir from `$GITHUB_ENV` |
| 176 | `runs-on: ubuntu-latest` | `ubuntu-24.04` |
| 184-187 | `--omit=dev` audit + high audit | Electron-targeted check + `--audit-level=high` + `npm audit signatures` + zizmor step (Pitfall 6) |

**Existing comment style to follow** (lines 102-103):
```yaml
      # Windows can't author DVDs, so its end-to-end run uses these discs. Names with
      # characters Windows forbids (the XSS fixtures) are left out.
```

**Upload-artifact pattern for coverage** (lines 95-100):
```yaml
      - name: Upload e2e report and screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-report-linux
          path: test/reports/
```

**Cache step to reuse for the Windows oracle** (lines 135-139, key style `engine-src-win-${{ hashFiles(...) }}`). Key on the oracle SHA-256 literal instead.

---

### `.github/workflows/release.yml` (config, batch)

**Analog:** itself.
- Lines 35-38: `setup-node` with `cache: npm` → remove `cache` (Pitfall 8, zizmor `cache-poisoning` at :35).
- Lines 40-44: `actions/cache@v4` engine-deps block → delete (zizmor :41).
- Line 55: `pip3 install --user 'meson>=1.3'` → hashed requirements file, same as ci.yml.
- Line 26: `os: windows-latest` → `windows-2025`; line 105 `ubuntu-latest` → `ubuntu-24.04`.
- Line 115: `softprops/action-gh-release@v2` → `efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3`.
- Keep `permissions: contents: write` scoped to the `release` job only (lines 106-107). The top level stays `contents: read` (13-14).
- **Check-name note:** the `build` job has `name: ${{ matrix.name }}` (line 27), and it runs on PRs that touch the paths at line 11. Its check runs are named `macos-arm64`, `linux-x64` and so on. These don't collide with the four required contexts. Keep them out of branch protection, since they are path-filtered (anti-pattern: path-filtered required checks).

---

### `package.json` (config)

**Analog:** scripts block, lines 9-23. Add next to the existing `test:*` entries:
```json
    "test:unit": "node --test \"test/unit/*.test.js\"",
    "test:engine": "node --test \"test/engine/*.test.js\"",
    "test:security": "node --test \"test/security/*.test.js\"",
```
→ `"test:coverage": "c8 node --test \"test/unit/*.test.js\" \"test/security/*.test.js\" \"test/engine/*.test.js\""`. devDependencies (24-27) use caret ranges today. Add c8 with `--save-exact` (`"c8": "12.0.0"`) per D-16's pinning intent. Leave `"engines": { "node": ">=20" }` (28-30) as is. c8 12 needs `^20.19 || ^22.12 || >=23`, and CI uses `.nvmrc`.

### `.gitignore`

**Analog:** the "generated test media and reports" block (`test/reports/` etc.). Add `coverage/` there.

### `SECURITY.md`, `README.md`, `docs/ENCRYPTED_DISCS.md`, `docs/SECURITY_TESTING.md` (docs)

**Exact lines to change:**
- `SECURITY.md` "Reporting a vulnerability" paragraph: add the fallback email `rickramirez94@gmail.com` after the "Security → Report a vulnerability" sentence.
- `SECURITY.md` last bullet, `- **No auto-scan of downloaded images.** Only physical optical discs scan automatically.` → the three-point truthful statement in RESEARCH § Security Domain. Note the residual renderer-compromise risk without overclaiming. Keep the bold-lead bullet style of the surrounding list.
- `README.md:69`: Windows table row → neutral ("Choose your own 64-bit `libdvdcss-2.dll` in **Settings → System**"). No link, no VideoLAN. Keep rows 65-68 (D-20).
- `README.md:75`: "Inserted discs are detected automatically" stays true (detection, not scan). Check that the wording doesn't imply an unsandboxed auto-scan.
- `docs/ENCRYPTED_DISCS.md:37`: drop the VideoLAN link sentence. Keep "Settings → System → Choose DLL…" and the validity-check sentence.
- `docs/SECURITY_TESTING.md:38` (F-8 "Fixed" column) and `:94` (SEC-10 row): add the gate. Keep `:128` and `:130` as they are.

### `.github/ISSUE_TEMPLATE/config.yml`

**Analog:** itself (`blank_issues_enabled: false`). Add standard `contact_links:` pointing to `https://github.com/rick-rami94/spinarr/security/advisories/new` (RESEARCH threat table, "Lost vulnerability reports").

---

## Shared Patterns

### Unpackaged-only test hooks
**Source:** `app/main.js` lines 30, 99, 138, 341
**Apply to:** `SPINARR_TEST_HOME` (main.js), any `SPINARR_TEST_PICK` fallback
```js
if (process.env.SPINARR_USER_DATA && !app.isPackaged) app.setPath('userData', process.env.SPINARR_USER_DATA);
const NO_SANDBOX = process.env.SPINARR_NO_SANDBOX === '1' && !app.isPackaged;
if (!app.isPackaged && +process.env.SPINARR_READRATE > 0) args.unshift(...);
```
No hook may skip or auto-confirm the gate (RESEARCH anti-pattern).

### Renderer input is untrusted: validate in main, strict booleans
**Source:** `app/lib.js` 182-199, 259-280; `app/main.js` 409-415
**Apply to:** `scan` opts, `probe`/`rip` gating
`=== true` for flags. Throw `new Error('<human sentence>')`. Validation functions live in `lib.js` (unit-tested, c8-counted). Handlers in `main.js` only compose them.

### HTML escaping of disc-controlled text
**Source:** `app/renderer/app.js` (`esc(...)` at 121, 132, 187, 387, 400, 532, 710-711)
**Apply to:** the "Scan anyway" prompt body (disc or folder name). XSS scenarios (`sec_xss_volume_label` 105-124, `sec_xss_folder_name` 126-137) should also run once with `SPINARR_NO_SANDBOX=1` so the prompt path is covered.

### Banner + action-button UI
**Source:** `app/renderer/app.js` 187-188; `app/renderer/styles.css` 349-357, 691-693
**Apply to:** the consent prompt. Markup: `.error-box.banner` + `role="alert"` + `${ICON.alert}` + `<b>title</b><span>body</span>` + `.row-btns` with `data-action` buttons dispatched by the global click switch (app.js 552-600).

### e2e scenario contract
**Source:** `test/e2e/scenarios.js` header (1-3), `run.js` 55-89, `harness.js` 49-61
**Apply to:** all new scenarios. `{ stories, title, platforms?, env?, setup?(env), after?(env), run(h) | launches: [...] }`. `run` executes in Electron main through `h.js`. `setup` and `after` run in the runner process. Assert with `h.assert` (node:assert/strict).

### Windows-safe executable paths
**Source:** `app/platform.js` 341 (`exe: (name) => (isWin ? `${name}.exe` : name)`), `test/security/sandbox.test.js` 19, `test/e2e/harness.js` 45
**Apply to:** engine/bluray/corpus tests and any new oracle path.

### CI workflow hygiene (already present; preserve)
**Source:** `.github/workflows/ci.yml` 8-9, 19-20
**Apply to:** every job in both workflows. `permissions: contents: read` at the top level, `persist-credentials: false` on checkout, `timeout-minutes: 60`, and no new job ids (zizmor goes in as a step inside `audit` so the required contexts stay at four).

---

## No Analog Found

| File | Role | Data Flow | Reason / Source to use |
|---|---|---|---|
| `.c8rc.json` | config | n/a | No coverage tooling yet. Use RESEARCH Pattern 4. Set all four thresholds explicitly (Pitfall 7: `lines` defaults to 90). |
| `.nvmrc` | config | n/a | None. Single line `22.23.3`. |
| `.github/requirements-build.txt` | config | n/a | None. `meson==1.12.1 --hash=sha256:930bc7542cbd9f57009e182fd014eba48cf1a0180a7b9006d2d32d8f168d8b02` (RESEARCH Toolchain pins). |
| `.github/dependabot.yml` | config | n/a | None. RESEARCH Pattern 5 YAML (npm + github-actions, weekly, grouped, 7-day cooldown). |
| `.gitattributes` | config | n/a | None. `test/fixtures/** -text` (Windows checkout safety). |
| GitHub security settings | ops | API | `gh api -X PUT` calls in RESEARCH Pattern 5. Verify through the GETs listed there. |
| Branch protection | ops | API | RESEARCH Pattern 6 payload. Apply last (D-11), after a green PR run shows exactly `macos`, `linux`, `windows`, `audit`. |

## Metadata

**Analog search scope:** `app/`, `app/renderer/`, `test/unit`, `test/e2e`, `test/engine`, `test/security`, `.github/`, root docs and config
**Files scanned:** 22
**Pattern extraction date:** 2026-10-10
