// End-to-end scenarios. Each maps to user stories (docs/USER_STORIES.md) or security
// requirements (docs/SECURITY_TESTING.md). `run(h)` executes inside the app (see harness.js);
// optional `setup(env)` / `after(env)` run in the test runner process.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const FX = path.join(__dirname, '..', 'fixtures', 'out');
const MAL = path.join(__dirname, '..', 'fixtures', 'malicious');
const fx = (n) => path.join(FX, n);
const visibleTitles = 'Array.from(document.querySelectorAll(".title-row")).map(e => +e.dataset.title)';
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort() : []);
const hdiutil = (...a) => execFileSync('hdiutil', a, { encoding: 'utf8', timeout: 120000 });
const detach = (vol) => { try { hdiutil('detach', '-force', vol); } catch {} };
// Detach every device backed by a fixture image, mounted or not (a detached volume can
// leave its image attached, which later makes hdiutil hang).
function detachFixtureImages() {
  let info = '';
  try { info = hdiutil('info'); } catch { return; }
  for (const block of info.split(/^=+$/m)) {
    const img = block.match(/^image-path\s*:\s*(.+)$/m);
    const dev = block.match(/^(\/dev\/disk\d+)\s/m);
    if (img && dev && img[1].startsWith(FX)) { try { hdiutil('detach', '-force', dev[1]); } catch {} }
  }
}
module.exports.detachFixtureImages = detachFixtureImages;
const call = (h, expr) => h.js(`(${expr}).then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e && e.message) }))`);
// SAFE-01: a scan entry point fired with the sandbox off shows the prompt and reads nothing.
async function expectPrompt(h, src) {
  await h.waitFor('state.pendingScan', { what: 'the Scan this disc? prompt' });
  await h.sleep(1500); // long enough for a scan that wrongly started to show up
  const st = await h.js(`({ disc: state.disc, scanning: state.scanning, pending: state.pendingScan,
    btn: !!document.querySelector('.error-box.banner[role="alertdialog"] [data-action="scan-anyway"]'),
    text: (document.querySelector('.error-box.banner[role="alertdialog"]') || {}).textContent || '' })`);
  h.assert.equal(st.disc, null, 'nothing is scanned before the click');
  h.assert.equal(st.scanning, false, 'no scan is running before the click');
  h.assert.equal(st.pending, src);
  h.assert.ok(st.btn, 'the prompt has a Scan anyway button');
  h.assert.match(st.text, /sandbox is off/);
  h.assert.ok(st.text.includes(path.basename(src)), `the prompt names ${path.basename(src)}`);
}
async function expectScanAfterClick(h) {
  await h.click('[data-action="scan-anyway"]');
  await h.waitFor('state.disc && state.disc.titles.length > 0', { timeout: 60000, what: 'scan after Scan anyway' });
  h.assert.equal(await h.js('state.pendingScan'), null, 'consent is single use');
}

Object.assign(module.exports, {
  // ------------------------------------------------------------------ security
  sec_renderer_isolation: {
    stories: ['SEC-01', 'SEC-02', 'SEC-03'],
    title: 'Renderer has no Node access, a minimal bridge, and cannot navigate or open windows',
    async run(h) {
      const r = await h.js(`({ req: typeof require, proc: typeof process, mod: typeof module, ipc: typeof ipcRenderer,
        bridge: Object.keys(spinarr).sort(), frozen: Object.isFrozen(spinarr), href: location.href })`);
      h.assert.equal(r.req, 'undefined');
      h.assert.equal(r.proc, 'undefined');
      h.assert.equal(r.ipc, 'undefined');
      h.assert.equal(r.href, 'app://spinarr/index.html');
      h.assert.ok(r.frozen, 'bridge object is frozen');
      h.assert.deepEqual(r.bridge, ['cancel', 'clearFinished', 'drives', 'eject', 'freeSpace', 'getSettings', 'installDvdcss', 'installKeydb', 'on',
        'pathForFile', 'pickOutput', 'pickSource', 'platform', 'probe', 'reveal', 'rip', 'scan', 'setSettings', 'system'].sort());
      h.assert.equal(await h.js(`window.open('https://example.com') === null`), true, 'window.open is denied');
      for (const target of ['https://example.com', 'file:///etc/hosts', 'app://spinarr/../../etc/hosts']) {
        await h.js(`location.href = ${JSON.stringify(target)}; 1`).catch(() => {});
        await h.sleep(700);
        h.assert.equal(h.win.webContents.getURL(), 'app://spinarr/index.html', `navigation to ${target} was blocked`);
      }
      h.assert.equal(await h.js(`fetch('https://example.com').then(() => 'ok', () => 'blocked')`), 'blocked', 'CSP connect-src');
      h.assert.equal(await h.js(`fetch('app://spinarr/../main.js').then(r => r.status, () => 'blocked')`), 'blocked', 'CSP blocks reading app files');
      await h.js(`document.body.insertAdjacentHTML('beforeend', '<img src="x" onerror="window.__inj = 1">'); 1`);
      await h.sleep(500);
      h.assert.equal(await h.js('window.__inj'), undefined, 'CSP blocks inline event handlers');
      h.assert.equal(await h.js(`(() => { try { spinarr.on('settings:set', () => {}); return 'ok'; } catch { return 'blocked'; } })()`), 'blocked');
      const perm = await h.js(`navigator.permissions.query({ name: 'geolocation' }).then(p => p.state, () => 'denied')`);
      h.assert.notEqual(perm, 'granted', 'non-notification permissions are not granted');
    },
  },

  sec_ipc_validation: {
    stories: ['SEC-04', 'SEC-05', 'SEC-06', 'SEC-07'],
    title: 'Every IPC handler rejects malformed or hostile arguments',
    async run(h) {
      const src = fx('ntsc_basic.iso');
      const rejects = [
        `spinarr.scan('relative.iso')`, `spinarr.scan('/etc/passwd')`, `spinarr.scan('/Users')`, `spinarr.scan('-i')`,
        `spinarr.scan(null)`, `spinarr.scan({ toString() { return '/etc/passwd'; } })`,
        `spinarr.probe(${JSON.stringify(src)}, 0)`, `spinarr.probe(${JSON.stringify(src)}, '1')`, `spinarr.probe(${JSON.stringify(src)}, 1000)`,
        `spinarr.probe('/etc/passwd', 1)`,
        `spinarr.rip('not-an-array')`, `spinarr.rip([{ source: '/etc/passwd', title: 1 }])`,
        `spinarr.rip([{ source: ${JSON.stringify(src)}, title: 1, streams: ['0;id'] }])`,
        `spinarr.rip([{ source: ${JSON.stringify(src)}, title: 1, streams: [9999] }])`,
        `spinarr.rip(Array(200).fill({ source: ${JSON.stringify(src)}, title: 1 }))`,
        `spinarr.eject('/')`, `spinarr.eject('/Volumes/Macintosh HD')`,
        `spinarr.pickSource('evil')`, `spinarr.pickSource({})`,
        // Only Windows takes a user-chosen DLL (behind a file dialog); elsewhere it refuses outright.
        ...(process.platform === 'win32' ? [] : [`spinarr.installDvdcss()`]),
      ];
      for (const expr of rejects) {
        const r = await call(h, expr);
        h.assert.equal(r.ok, false, `should reject: ${expr}`);
      }
      h.assert.equal(await h.js('state.queue.length'), 0, 'rejected rips enqueue nothing (all-or-nothing)');

      const before = (await call(h, 'spinarr.getSettings()')).v;
      const after = (await call(h, `spinarr.setSettings({ outputDir: '/tmp/evil', minMinutes: 'x', accurateChapters: 'yes', __proto__: { polluted: 1 }, foo: 1 })`)).v;
      h.assert.equal(after.outputDir, before.outputDir, 'outputDir cannot be set from the renderer');
      h.assert.equal(after.minMinutes, before.minMinutes);
      h.assert.equal(after.accurateChapters, before.accurateChapters);
      h.assert.equal(after.foo, undefined);
      h.assert.equal(({}).polluted, undefined);

      h.assert.equal((await call(h, `spinarr.reveal('/Applications/Calculator.app')`)).ok, true, 'reveal of unknown id is a no-op');

      // Path traversal in file name + attempt to choose the output directory. Scan first (through
      // the prompt when the sandbox is off) so the rip isn't refused as unscanned.
      await h.load(src);
      const r = await call(h, `spinarr.rip([{ source: ${JSON.stringify(src)}, title: 2, duration: 12, fileName: '../../../../tmp/spinarr-pwned', displayName: 'x', outputDir: '/tmp' }])`);
      h.assert.equal(r.ok, true, r.e);
      await h.idle();
      h.assert.deepEqual(files(h.outDir), ['tmp-spinarr-pwned.mkv']);
      h.assert.equal(fs.existsSync('/tmp/spinarr-pwned.mkv'), false);
    },
  },

  sec_xss_volume_label: {
    stories: ['SEC-08'],
    title: 'HTML in a disc volume label is shown as text, never executed',
    async run(h) {
      await h.load(h.fx('xss_label.iso'));
      h.assert.equal(await h.js('state.disc.label'), '<img src=x onerror=__xss=1>');
      await h.js(`document.querySelector('[data-expand="1"]').click(); 1`);
      await h.waitFor('state.probes.get(1) && state.probes.get(1).data');
      await h.sleep(300);
      h.assert.equal(await h.js('window.__xss'), undefined);
      h.assert.equal(await h.js(`document.querySelectorAll('#main img, #sources img, #queueList img').length`), 0);
      h.assert.match(await h.js(`document.getElementById('discName').value`), /<img/i, 'label displayed literally');
      await h.click('[data-action="rip"]');
      await h.idle();
      const out = files(h.outDir);
      h.assert.equal(out.length, 1);
      h.assert.doesNotMatch(out[0], /[<>/\\:]/);
      await h.shot('label');
    },
  },

  sec_xss_folder_name: {
    platforms: ['darwin', 'linux'], // Windows doesn't allow < > " in file names, so the attack can't exist there
    stories: ['SEC-08'],
    title: 'HTML in a folder name is shown as text, never executed',
    async run(h) {
      await h.load(h.fx(`<svg onload=window.__xss=2>&"quote'`));
      await h.sleep(300);
      h.assert.equal(await h.js('window.__xss'), undefined);
      h.assert.equal(await h.js(`document.querySelectorAll('svg[onload]').length`), 0);
      h.assert.equal(await h.js('state.disc.titles.length'), 2);
    },
  },

  sec_malicious_discs: {
    stories: ['SEC-09'],
    title: 'Discs that crashed the original libdvdread are handled without crashing the app',
    async run(h) {
      const cases = fs.readdirSync(MAL).filter((d) => /^repro_|^crash_(972f|cd69|ec8b)/.test(d));
      h.assert.ok(cases.length >= 8);
      for (const c of cases) {
        await h.load(path.join(MAL, c));
        const st = await h.js('({ disc: !!state.disc, error: state.error })');
        h.assert.ok(st.disc || st.error, `${c}: either scanned or showed an error`);
        h.note(`${c}: ${st.disc ? 'scanned' : 'error: ' + st.error}`);
      }
      h.assert.equal(await h.js('1 + 1'), 2, 'renderer still responsive');
    },
  },

  // ------------------------------------------------------------------ SAFE-01 scan gate
  // Every scan entry point, with the engine sandbox off (D-05: runs on every OS). Each one must
  // prompt, read nothing until "Scan anyway", and prompt again for the same source (D-03).
  // Boot shares onDrives with insertion; gate-static.test.js pins that call site.
  gate_insert: {
    stories: ['SAFE-01'],
    title: 'Sandbox off: an inserted disc prompts, scans only after Scan anyway, and prompts again',
    env: { SPINARR_NO_SANDBOX: '1' },
    async run(h) {
      const src = h.fx('ntsc_basic');
      h.fakeInsert('NTSC_BASIC', src);
      await expectPrompt(h, src);
      await h.shot('prompt');
      await expectScanAfterClick(h);
      h.fakeEject();
      await h.waitFor('state.drives.discs.length === 0', { what: 'fake eject' });
      h.fakeInsert('NTSC_BASIC', src);
      await expectPrompt(h, src);
    },
  },

  gate_drop: {
    stories: ['SAFE-01'],
    title: 'Sandbox off: a dropped disc image prompts, scans only after Scan anyway, and prompts again',
    env: { SPINARR_NO_SANDBOX: '1' },
    async run(h) {
      const src = h.fx('ntsc_basic.iso');
      await h.dropFile(src);
      await expectPrompt(h, src);
      await expectScanAfterClick(h);
      await h.dropFile(src);
      await expectPrompt(h, src);
    },
  },

  gate_pick_iso: {
    stories: ['SAFE-01'],
    title: 'Sandbox off: an image chosen in the picker prompts, scans only after Scan anyway, and prompts again',
    env: { SPINARR_NO_SANDBOX: '1' },
    async run(h) {
      const src = h.fx('ntsc_basic.iso');
      h.stubDialog([src]);
      await h.click('#openBtn');
      await expectPrompt(h, src);
      await expectScanAfterClick(h);
      await h.click('#openBtn');
      await expectPrompt(h, src);
    },
  },

  gate_pick_folder: {
    stories: ['SAFE-01'],
    title: 'Sandbox off: a folder chosen in the picker prompts, scans only after Scan anyway; Not now clears it',
    env: { SPINARR_NO_SANDBOX: '1' },
    async run(h) {
      const src = h.fx('ntsc_basic');
      h.stubDialog([src]);
      await h.js("openPicker('folder'); 1"); // #openFolderBtn is hidden on macOS
      await expectPrompt(h, src);
      await expectScanAfterClick(h);
      await h.js("openPicker('folder'); 1");
      await expectPrompt(h, src);
      await h.click('[data-action="scan-cancel"]');
      h.assert.deepEqual(await h.js('({ p: state.pendingScan, s: state.source })'), { p: null, s: null }, 'Not now clears the prompt and the source');
      await h.sleep(1000);
      h.assert.equal(await h.js('state.disc'), null, 'Not now scans nothing');
    },
  },

  sec_gate_ipc: {
    stories: ['SAFE-01', 'SEC-04'],
    title: 'Sandbox off: main refuses a scan without consent, probe/rip of an unscanned source, and probe of a changed medium',
    env: { SPINARR_NO_SANDBOX: '1' },
    async run(h) {
      const src = JSON.stringify(h.fx('ntsc_basic.iso'));
      const sys = (await call(h, 'spinarr.system()')).v;
      h.assert.equal(sys.sandboxTrusted, false);
      h.assert.equal(sys.sandbox, 'none');
      for (const expr of [`spinarr.scan(${src})`, `spinarr.scan(${src}, { userConfirmed: 'true' })`, `spinarr.scan(${src}, { userConfirmed: 1 })`, `spinarr.scan(${src}, {})`]) {
        const r = await call(h, expr);
        h.assert.equal(r.ok, false, `should refuse: ${expr}`);
        h.assert.match(r.e, /SANDBOX_OFF/, expr);
      }
      const bad = await call(h, `spinarr.scan(${src}, 'x')`);
      h.assert.equal(bad.ok, false);
      h.assert.match(bad.e, /Invalid scan options/);
      const probe = await call(h, `spinarr.probe(${src}, 1)`);
      h.assert.equal(probe.ok, false, 'probe of an unscanned source is refused');
      h.assert.match(probe.e, /Scan the disc again/, 'probe is refused because the source was not scanned');
      const rip = await call(h, `spinarr.rip([{ source: ${src}, title: 1 }])`);
      h.assert.equal(rip.ok, false, 'rip of an unscanned source is refused');
      h.assert.match(rip.e, /Scan the disc again/, 'rip is refused because the source was not scanned');
      h.assert.equal(await h.js('state.queue.length'), 0);
      // Consent covers the medium as scanned, not its path: a changed copy must be scanned again.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-gate-'));
      try {
        const copy = path.join(tmp, 'copy.iso');
        fs.copyFileSync(h.fx('ntsc_basic.iso'), copy);
        await h.load(copy); // the real prompt and button
        h.assert.equal(await h.js('state.disc.titles.length'), 2);
        h.assert.equal((await call(h, `spinarr.probe(${JSON.stringify(copy)}, 1)`)).ok, true, 'probe works for the unchanged medium scanned with consent');
        fs.appendFileSync(copy, Buffer.from([0]));
        const changed = await call(h, `spinarr.probe(${JSON.stringify(copy)}, 1)`);
        h.assert.equal(changed.ok, false, 'consent does not survive a change to the image');
        h.assert.match(changed.e, /Scan the disc again/, 'consent does not survive a change to the image');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },

  sec_gate_swap: {
    stories: ['SAFE-01'],
    title: 'Sandbox off: consent covers only the medium that was scanned; a swapped disc or image at the same path must be scanned again',
    env: { SPINARR_NO_SANDBOX: '1', SPINARR_READRATE: '6' },
    async run(h) {
      // fakeEject reaches only the renderer, so the refusals here come from main's identity
      // check (plan 01-11). That check is also what protects a real eject and reinsert.
      // Every swap works on copies in a temp folder; the committed fixtures are only read.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-swap-'));
      const q = (v) => JSON.stringify(v);
      const refused = async (expr, what) => {
        const r = await call(h, expr);
        h.assert.equal(r.ok, false, `${what} must be refused`);
        h.assert.match(r.e, /Scan the disc again/, `${what} is refused with a rescan message`);
      };
      try {
        // 1. Disc folder: consent, eject, swap another disc in at the same path.
        const disc = path.join(tmp, 'DISC');
        fs.cpSync(h.fx('ntsc_basic'), disc, { recursive: true });
        h.fakeInsert('NTSC_BASIC', disc);
        await expectPrompt(h, disc);
        await expectScanAfterClick(h);
        const ok1 = await call(h, `spinarr.probe(${q(disc)}, 1)`);
        h.assert.equal(ok1.ok, true, `probe works for the disc scanned with consent: ${ok1.e}`);
        h.fakeEject();
        await h.waitFor('state.drives.discs.length === 0', { what: 'fake eject' });
        fs.rmSync(disc, { recursive: true, force: true });
        fs.cpSync(h.fx('pal_subs'), disc, { recursive: true });
        await refused(`spinarr.probe(${q(disc)}, 1)`, 'probe of a swapped disc folder');
        await refused(`spinarr.rip([{ source: ${q(disc)}, title: 1, duration: 12, fileName: 'swap-folder', displayName: 'x' }])`, 'rip of a swapped disc folder');
        h.assert.equal(await h.js('state.queue.length'), 0, 'a refused rip of a swapped disc enqueues nothing');
        // Scanning again through the real prompt restores probe for the new disc.
        h.fakeInsert('PAL_SUBS', disc);
        await expectPrompt(h, disc);
        await expectScanAfterClick(h);
        const ok2 = await call(h, `spinarr.probe(${q(disc)}, 1)`);
        h.assert.equal(ok2.ok, true, `probe works again after a consented rescan: ${ok2.e}`);

        // 2. Disc image overwritten in place (same path, same inode, different size).
        const iso = path.join(tmp, 'disc.iso');
        fs.copyFileSync(h.fx('ntsc_basic.iso'), iso);
        await h.load(iso);
        h.assert.ok(await h.js('!!state.disc'), 'the image copy was scanned');
        const ok3 = await call(h, `spinarr.probe(${q(iso)}, 1)`);
        h.assert.equal(ok3.ok, true, `probe works for the image scanned with consent: ${ok3.e}`);
        fs.writeFileSync(iso, fs.readFileSync(h.fx('pal_subs.iso')));
        const isoProbe = await call(h, `spinarr.probe(${q(iso)}, 1)`);
        h.assert.equal(isoProbe.ok, false, 'probe of an overwritten image must be refused');
        h.assert.match(isoProbe.e, /Scan the disc again/, 'probe of an overwritten image is refused with a rescan message');
        const isoRip = await call(h, `spinarr.rip([{ source: ${q(iso)}, title: 2, duration: 12, fileName: 'swap-iso', displayName: 'x' }])`);
        h.assert.equal(isoRip.ok, false, 'rip of an overwritten image must be refused');
        h.assert.match(isoRip.e, /Scan the disc again/, 'rip of an overwritten image is refused with a rescan message');
        h.assert.equal(await h.js('state.queue.length'), 0, 'a refused rip of an overwritten image enqueues nothing');

        // 3. WR-08: a queued job whose source is overwritten while an earlier job rips.
        const queued = path.join(tmp, 'queued.iso');
        fs.copyFileSync(h.fx('ntsc_basic.iso'), queued);
        await h.load(queued);
        h.assert.ok(await h.js('!!state.disc'), 'the queued image was scanned');
        const feature = h.fx('feature_disc.iso');
        await h.load(feature);
        const long = await h.js('(state.disc.titles.find(t => t.title === 4) || {}).duration');
        h.assert.ok(long > 0, 'feature_disc title 4 has a duration');
        const r = await call(h, `spinarr.rip([
          { source: ${q(feature)}, title: 4, duration: ${long}, fileName: 'swap-long', displayName: 'a' },
          { source: ${q(queued)}, title: 2, duration: 12, fileName: 'swap-queued', displayName: 'b' }])`);
        h.assert.equal(r.ok, true, `both scanned, unchanged sources enqueue: ${r.e}`);
        await h.waitFor('state.queue.length === 2 && state.queue[0].state === "ripping" && state.queue[1].state === "queued"', { timeout: 30000, what: 'job A ripping, job B queued' });
        fs.writeFileSync(queued, fs.readFileSync(h.fx('pal_subs.iso')));
        // Job A's outcome doesn't matter here; cancel it so the queue reaches job B quickly.
        await h.click(`[data-cancel="${await h.js('state.queue[0].id')}"]`);
        await h.idle(120000);
        const jobs = await h.js('state.queue.map(j => ({ state: j.state, error: j.error || "" }))');
        h.assert.notEqual(jobs[0].state, 'queued', 'job A left the queue');
        h.assert.equal(jobs[1].state, 'failed', 'the queued job against a changed source fails');
        h.assert.match(jobs[1].error, /Scan the disc again/, 'the queued job fails with a rescan message');
        h.assert.ok(!files(h.outDir).some((f) => f.startsWith('swap-queued')), 'no output is written for the changed source');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },

  sec_xss_prompt: {
    platforms: ['darwin', 'linux'], // Windows doesn't allow < > " in file names
    stories: ['SEC-08', 'SAFE-01'],
    title: 'Sandbox off: HTML in a disc or folder name is shown as text in the scan prompt',
    env: { SPINARR_NO_SANDBOX: '1' },
    async run(h) {
      for (const src of [h.fx(`<svg onload=window.__xss=2>&"quote'`), h.fx('xss_label.iso')]) {
        await h.js(`requestScan(${JSON.stringify(src)}); 1`);
        await expectPrompt(h, src);
        h.assert.equal(await h.js('window.__xss'), undefined);
        h.assert.equal(await h.js(`document.querySelectorAll('#main svg[onload], #main img').length`), 0);
      }
      await h.js(`requestScan(${JSON.stringify(h.fx(`<svg onload=window.__xss=2>&"quote'`))}); 1`);
      await h.waitFor('state.pendingScan');
      h.assert.match(await h.js(`document.querySelector('.error-box.banner[role="alertdialog"]').textContent`), /<svg onload/, 'name shown literally');
      await h.shot('xss-prompt');
    },
  },

  // ------------------------------------------------------------------ user stories
  us_scan_and_filter: {
    stories: ['US-03', 'US-04', 'US-05'],
    title: 'Scan finds the main feature, hides short and duplicate titles, toggles reveal them',
    async run(h) {
      await h.load(h.fx('feature_disc.iso'));
      h.assert.equal(await h.js('state.discName'), 'The Test Movie Disc 1');
      h.assert.deepEqual(await h.js(visibleTitles), [2]);
      h.assert.deepEqual(await h.js('[...state.selected]'), [2], 'main feature preselected');
      h.assert.match(await h.js(`document.querySelector('.toolbar').textContent`), /1 shown · 3 hidden/);
      h.assert.match(await h.js(`document.querySelector('[data-title="2"]').textContent`), /Main feature/);
      h.assert.match(await h.js(`document.querySelector('[data-title="2"] .chips').textContent`), /EN AC3 5\.1.*JA AC3 Stereo/);
      await h.click('[data-toggle="showShort"]');
      h.assert.deepEqual(await h.js(visibleTitles), [1, 2, 4]);
      await h.click('[data-toggle="showDups"]');
      h.assert.deepEqual(await h.js(visibleTitles), [1, 2, 3, 4]);
      h.assert.match(await h.js(`document.querySelector('[data-title="3"]').textContent`), /Same as 2/);
      h.assert.equal(await h.js(`document.querySelectorAll('[data-title="2"] .timeline .tick').length`), 4, 'chapter ticks');
      await h.shot('all-titles');
    },
  },

  us_track_selection: {
    stories: ['US-06', 'US-07', 'US-13', 'US-14'],
    title: 'Track list shows languages/codecs; unticked tracks are left out of the MKV',
    async run(h) {
      await h.load(h.fx('pal_subs.iso'));
      await h.click('[data-expand="1"]');
      await h.waitFor('state.probes.get(1) && state.probes.get(1).data');
      const text = await h.js(`Array.from(document.querySelectorAll('[data-title="1"] .track')).map(e => e.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`);
      h.assert.match(text, /English\s*AC3 5\.1/);
      h.assert.match(text, /English\s*AC3 Stereo/);
      h.assert.match(text, /English\s*VobSub.*French\s*VobSub.*German\s*VobSub/);
      await h.click('[data-track="1:1"]'); // 5.1 main audio off -> keep commentary only
      await h.click('[data-track="1:5"]'); // German subs off
      await h.shot('tracks');
      await h.click('[data-action="rip"]');
      await h.idle();
      h.assert.deepEqual(files(h.outDir), ['Pal Subs.mkv']);
      const p = h.probe(path.join(h.outDir, 'Pal Subs.mkv'));
      h.assert.deepEqual(p.streams.map((s) => s.codec_type), ['video', 'audio', 'subtitle', 'subtitle']);
      h.assert.deepEqual(p.streams.slice(1).map((s) => s.tags.language), ['eng', 'eng', 'fre']);
      h.assert.equal(p.streams.find((s) => s.codec_type === 'audio').channels, 2);
      h.assert.equal(p.chapters.length, 2);
      h.assert.equal(p.format.tags.title, 'Pal Subs');
    },
  },

  us_naming: {
    stories: ['US-08'],
    title: 'Disc and per-title names drive file names; unsafe characters are sanitised',
    async run(h) {
      await h.load(h.fx('ntsc_basic.iso'));
      await h.js(`(() => { const i = document.getElementById('discName'); i.value = 'My Movie: Part 2/3'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
      await h.click('[data-toggle="showShort"]');
      await h.click('[data-select="2"]');
      await h.click('[data-expand="2"]');
      await h.waitFor(`document.querySelector('[data-filename="2"]')`);
      await h.js(`(() => { const i = document.querySelector('[data-filename="2"]'); i.value = '  .Bonus <Clip>  '; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue.length === 2 && state.queue.every(j => j.state === "done")', { timeout: 60000 });
      h.assert.deepEqual(files(h.outDir), ['Bonus -Clip-.mkv', 'My Movie- Part 2-3 - Title 1.mkv']);
      h.assert.equal(h.probe(path.join(h.outDir, 'My Movie- Part 2-3 - Title 1.mkv')).format.tags.title, 'My Movie: Part 2/3');
    },
  },

  us_no_overwrite: {
    stories: ['US-11'],
    title: 'Ripping the same title twice never overwrites the first file',
    async run(h) {
      await h.load(h.fx('ntsc_basic.iso'));
      await h.click('[data-action="rip"]');
      await h.idle();
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue.length === 2 && state.queue.every(j => j.state === "done")', { timeout: 60000 });
      h.assert.deepEqual(files(h.outDir), ['Ntsc Basic (2).mkv', 'Ntsc Basic.mkv']);
    },
  },

  us_queue_progress_cancel: {
    stories: ['US-09', 'US-10'],
    title: 'Queue shows progress/speed/ETA; cancelling removes the partial file and the queue moves on',
    env: { SPINARR_READRATE: '6' },
    async run(h) {
      await h.load(h.fx('feature_disc.iso'));
      await h.click('[data-toggle="showShort"]');
      await h.click('[data-select="4"]');
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue[0] && state.queue[0].state === "ripping" && state.queue[0].progress > 0.03', { timeout: 60000 });
      const q = await h.js(`document.querySelector('.job').textContent.replace(/\\s+/g, ' ')`);
      h.assert.match(q, /\d+%/);
      h.assert.match(q, /left/);
      h.assert.equal(await h.js('state.queue[1].state'), 'queued');
      await h.shot('ripping');
      h.assert.ok(files(h.outDir).some((f) => f.endsWith('.mkv.part')), 'writes to a .part file while ripping');
      await h.click(`[data-cancel="${await h.js('state.queue[0].id')}"]`);
      await h.waitFor('state.queue[0].state === "cancelled"');
      await h.waitFor('state.queue[1].state === "done"', { timeout: 90000 });
      h.assert.deepEqual(files(h.outDir), ['The Test Movie Disc 1 - Title 4.mkv']);
      // cancel a job that is still waiting
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue.length === 4');
      await h.click(`[data-cancel="${await h.js('state.queue[3].id')}"]`);
      await h.click(`[data-cancel="${await h.js('state.queue[2].id')}"]`);
      await h.waitFor('state.queue[2].state === "cancelled" && state.queue[3].state === "cancelled"');
      await h.sleep(500);
      h.assert.deepEqual(files(h.outDir), ['The Test Movie Disc 1 - Title 4.mkv']);
      await h.click('#clearBtn');
      await h.waitFor('state.queue.length === 0');
    },
  },

  us_errors: {
    stories: ['US-17'],
    title: 'Bad sources and unreadable discs produce clear errors and no output',
    async run(h) {
      await h.load(h.fx('random.iso'));
      h.assert.match(await h.js('state.error'), /Not a DVD or Blu-ray disc/);
      h.assert.ok(await h.js(`!!document.querySelector('.error-box')`));
      await h.shot('not-a-dvd');
      await h.load('/nonexistent/disc.iso');
      h.assert.match(await h.js('state.error'), /not found/i);
      await h.load(h.fx('no_videots'));
      h.assert.match(await h.js('state.error'), /VIDEO_TS/);
      await h.load(h.fx('truncated.iso'));
      h.assert.equal(await h.js('state.disc.titles.length'), 2, 'IFO is readable');
      await h.click('[data-action="rip"]');
      await h.idle();
      h.assert.equal(await h.js('state.queue[0].state'), 'failed');
      h.assert.match(await h.js('state.queue[0].error'), /scratched|damaged/);
      h.assert.deepEqual(files(h.outDir), [], 'no partial or corrupt file left behind');
      await h.shot('rip-failed');
    },
  },

  us_settings_persist: {
    stories: ['US-16'],
    title: 'Settings changed in the dialog survive a restart',
    launches: [
      async (h) => {
        await h.click('#settingsBtn');
        await h.js(`document.getElementById('setMin').value = '0'; document.getElementById('setChapters').checked = false; 1`);
        await h.shot('dialog');
        await h.click('#settingsDlg button[value="ok"]');
        await h.waitFor('state.settings.minMinutes === 0 && state.settings.accurateChapters === false');
      },
      async (h) => {
        h.assert.equal(await h.js('state.settings.minMinutes'), 0);
        h.assert.equal(await h.js('state.settings.accurateChapters'), false);
        await h.load(h.fx('feature_disc.iso'));
        h.assert.deepEqual(await h.js(visibleTitles), [1, 2, 4], 'short titles shown with 0-minute threshold');
      },
    ],
  },

  us_low_disk_space: {
    platforms: ['darwin'], // builds and mounts disk images with hdiutil
    stories: ['US-15'],
    title: 'Rip button is disabled with a clear message when the output drive is too small',
    setup(env) {
      env.dmg = path.join(env.tmp, 'tiny.dmg');
      hdiutil('create', '-quiet', '-size', '2m', '-fs', 'HFS+', '-volname', 'SpinarrTiny', '-ov', env.dmg);
      const out = hdiutil('attach', '-nobrowse', env.dmg);
      env.vol = out.trim().split('\n').pop().split('\t').pop().trim();
      env.settings = { outputDir: path.join(env.vol, 'rips') };
    },
    after(env) { detach(env.vol); },
    async run(h) {
      await h.load(h.fx('feature_disc.iso'));
      await h.waitFor(`/not enough space/.test(document.querySelector('.actionbar').textContent)`);
      h.assert.equal(await h.js(`document.querySelector('[data-action="rip"]').disabled`), true);
      await h.shot('low-space');
    },
  },

  us_mounted_image_and_eject: {
    platforms: ['darwin'], // builds and mounts disk images with hdiutil
    stories: ['US-01', 'US-18', 'SEC-10'],
    title: 'A mounted image appears in Sources but is not auto-scanned; click scans; eject removes it',
    after() { detach('/Volumes/NTSC_BASIC'); },
    async run(h) {
      detach('/Volumes/NTSC_BASIC');
      hdiutil('attach', '-nobrowse', '-readonly', fx('ntsc_basic.iso'));
      await h.waitFor(`state.drives.discs.some(d => d.path === '/Volumes/NTSC_BASIC')`, { what: 'volume to appear' });
      h.assert.equal(await h.js(`state.drives.discs.find(d => d.path === '/Volumes/NTSC_BASIC').kind`), 'image');
      await h.sleep(2000);
      h.assert.equal(await h.js('state.disc'), null, 'disk images are not scanned automatically');
      h.assert.match(await h.js(`document.querySelector('[data-src="/Volumes/NTSC_BASIC"]').textContent`), /Disk image · click to scan/);
      await h.click('[data-src="/Volumes/NTSC_BASIC"]');
      await h.consent();
      await h.waitFor('state.disc && state.disc.titles.length === 2');
      await h.shot('mounted');
      await h.click('[data-eject="/Volumes/NTSC_BASIC"]');
      await h.waitFor(`!state.drives.discs.some(d => d.path === '/Volumes/NTSC_BASIC')`, { timeout: 30000, what: 'volume to go away' });
      h.assert.equal(await h.js('state.disc'), null);
    },
  },

  us_disc_removed_midrip: {
    platforms: ['darwin'], // builds and mounts disk images with hdiutil
    stories: ['US-21'],
    title: 'Pulling the disc mid-rip fails the job cleanly with no partial file',
    env: { SPINARR_READRATE: '4' },
    after() { detach('/Volumes/THE_TEST_MOVIE_DISC_1'); },
    async run(h) {
      detach('/Volumes/THE_TEST_MOVIE_DISC_1');
      hdiutil('attach', '-nobrowse', '-readonly', fx('feature_disc.iso'));
      await h.waitFor(`state.drives.discs.some(d => d.path === '/Volumes/THE_TEST_MOVIE_DISC_1')`);
      await h.click('[data-src="/Volumes/THE_TEST_MOVIE_DISC_1"]');
      await h.consent();
      await h.waitFor('state.disc');
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue[0] && state.queue[0].progress > 0.03', { timeout: 60000 });
      detach('/Volumes/THE_TEST_MOVIE_DISC_1');
      // A detached disk image can keep serving an already-open read, so either outcome is
      // acceptable, but only if it's honest: failed with nothing left, or done and complete.
      await h.waitFor('["failed", "done"].includes(state.queue[0].state)', { timeout: 90000 });
      const job = await h.js('state.queue[0]');
      if (job.state === 'failed') {
        h.note(`failed cleanly: ${job.error}`);
        h.assert.deepEqual(files(h.outDir), []);
      } else {
        const dur = +h.probe(path.join(h.outDir, 'The Test Movie Disc 1.mkv')).format.duration;
        h.note(`image kept serving the open read; finished complete (${dur.toFixed(1)}s)`);
        h.assert.ok(dur > 149, `a 'done' rip must be complete, got ${dur}s`);
      }
      await h.waitFor('state.disc === null', { what: 'view to clear after the disc vanished' });
    },
  },

  us_quit_midrip: {
    stories: ['US-22'],
    title: 'Quitting mid-rip leaves no partial files behind',
    env: { SPINARR_READRATE: '4' },
    async run(h) {
      await h.load(h.fx('feature_disc.iso'));
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue[0] && state.queue[0].progress > 0.03', { timeout: 60000 });
      h.assert.ok(files(h.outDir).some((f) => f.endsWith('.part')));
      // harness quits the app after this returns
    },
    after(env) {
      const left = files(env.outDir);
      if (left.length) throw new Error(`files left after quit: ${left.join(', ')}`);
    },
  },

  us_unicode_and_videots_paths: {
    stories: ['US-02', 'US-23'],
    title: 'Unicode folder names and a selected VIDEO_TS folder both work end to end',
    async run(h) {
      await h.load(h.fx('ntsc_basic/VIDEO_TS'));
      h.assert.equal(await h.js('state.disc.titles.length'), 2);
      await h.load(h.fx('Amélie – Ünïcødé 日本語'));
      h.assert.equal(await h.js('state.discName'), 'Amélie – Ünïcødé 日本語');
      await h.click('[data-action="rip"]');
      await h.idle();
      h.assert.deepEqual(files(h.outDir).map((f) => f.normalize('NFC')), ['Amélie – Ünïcødé 日本語.mkv'.normalize('NFC')]);
    },
  },

  us_bluray_rip: {
    stories: ['US-25', 'US-26'],
    title: 'Blu-ray: scan playlists, show tracks, rip losslessly with chapters, languages and LPCM->FLAC',
    async run(h) {
      await h.load(h.fx('bd_movie.iso'));
      h.assert.equal(await h.js('state.disc.type'), 'bluray');
      h.assert.equal(await h.js('state.discName'), 'My Test Movie');
      h.assert.match(await h.js(`document.querySelector('.disc-meta').textContent`), /Blu-ray[\s\S]*1080p · H\.264 · 16:9/);
      h.assert.deepEqual(await h.js(visibleTitles), [1], 'duplicate playlist and short extras hidden');
      await h.click('[data-expand="1"]');
      await h.waitFor('state.probes.get(1) && state.probes.get(1).data', { timeout: 60000 });
      const text = await h.js(`Array.from(document.querySelectorAll('[data-title="1"] .track')).map(e => e.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`);
      h.assert.match(text, /English\s*AC3 5\.1/);
      h.assert.match(text, /French\s*AC3 Stereo/);
      h.assert.match(text, /English\s*LPCM → FLAC Stereo/);
      h.assert.match(text, /English\s*PGS.*French\s*PGS/);
      await h.shot('tracks');
      await h.click('[data-track="1:2"]'); // drop French audio
      await h.click('[data-action="rip"]');
      await h.idle(120000);
      h.assert.equal(await h.js('state.queue[0].state'), 'done', await h.js('state.queue[0].error || ""'));
      h.assert.deepEqual(files(h.outDir), ['My Test Movie.mkv'], 'chapters temp file removed');
      const p = h.probe(path.join(h.outDir, 'My Test Movie.mkv'));
      h.assert.deepEqual(p.streams.map((s) => [s.codec_name, s.tags?.language]),
        [['h264', undefined], ['ac3', 'eng'], ['flac', 'eng'], ['hdmv_pgs_subtitle', 'eng'], ['hdmv_pgs_subtitle', 'fre']]);
      h.assert.equal(p.chapters.length, 5);
      h.assert.equal(p.format.tags.title, 'My Test Movie');
    },
  },

  sec_hermetic_keydirs: {
    stories: ['QUAL-02'],
    title: 'Hermetic e2e: every key and cache folder lives under the test home, never the real one',
    async run(h) {
      const home = process.env.SPINARR_TEST_HOME;
      const inside = (base, p) => { const r = path.relative(base, p); return !!p && r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
      h.assert.ok(home, 'SPINARR_TEST_HOME is set for every launch');
      h.assert.ok(inside(fs.realpathSync(os.tmpdir()), fs.realpathSync(home)), `test home ${home} is under the temp dir`);
      h.assert.ok(!inside(home, os.homedir()) && path.resolve(home) !== path.resolve(os.homedir()), 'test home is not the real home');
      const pl = h.ctx.platform;
      h.assert.ok(inside(home, pl.cssCache), `cssCache ${pl.cssCache} is under the test home`);
      for (const [k, v] of Object.entries(pl.keyDirs)) h.assert.ok(inside(home, v), `keyDirs.${k} ${v} is under the test home`);
      const sys = await h.js('spinarr.system()');
      h.assert.ok(inside(home, sys.aacs.keydbPath), `keydbPath ${sys.aacs.keydbPath} is under the test home`);
      h.assert.equal(sys.aacs.keydb, false, 'no KEYDB.cfg in the fresh test home');
      if (process.env.SPINARR_SENTINEL) {
        // CI only: run.js planted a valid-looking KEYDB.cfg in the runner's REAL aacs folder
        // (SPINARR_SENTINEL is its path). The app must not see it.
        h.assert.ok(fs.existsSync(process.env.SPINARR_SENTINEL), 'the real-home sentinel is in place');
        h.assert.ok(!inside(home, process.env.SPINARR_SENTINEL), 'the sentinel is outside the test home');
        await h.load(h.fx('bd_aacs'));
        const reason = await h.js(`document.querySelector('.error-box.banner').textContent`);
        h.assert.match(reason, /encrypted \(AACS\)/);
        // Never a reason that implies a key file was read (no key / no host cert / revoked).
        h.assert.doesNotMatch(reason, /has no key that opens it|has no host certificate|revokes the host certificates/, 'the planted real-home KEYDB.cfg was read');
        // Allowed: no libaacs, no KEYDB.cfg (naming the test-home path), or libaacs giving up on
        // the fixture's random AACS files before it looks for a key file (-1).
        h.assert.match(reason, /Install libaacs|found no KEYDB\.cfg|AACS files couldn't be read/);
        if (/found no KEYDB\.cfg/.test(reason)) h.assert.ok(reason.includes(sys.aacs.keydbPath), 'the no-KEYDB reason names the test-home path');
        const which = /Install libaacs/.test(reason) ? 'libaacs not installed' : /found no KEYDB/.test(reason) ? 'no KEYDB.cfg (test home)' : 'AACS files unreadable (-1, before key lookup)';
        h.note(`sentinel active at ${process.env.SPINARR_SENTINEL}; bd_aacs reason: ${which}`);
      } else {
        h.note('sentinel inactive (CI !== "true"); path assertions only');
      }
    },
  },

  us_default_chapters: {
    stories: ['QUAL-02', 'US-16'],
    title: 'Shipped default accurateChapters=false: a playable MKV with all 4 chapters',
    setup(env) { env.settings = { accurateChapters: false }; },
    async run(h) {
      h.assert.equal(await h.js('state.settings.accurateChapters'), false, 'the shipped default is in effect');
      await h.load(h.fx('ntsc_basic.iso'));
      if (!(await h.js(`!!document.querySelector('[data-select="1"]')`))) await h.click('[data-toggle="showShort"]');
      for (const t of await h.js('[...state.selected]')) if (t !== 1) await h.click(`[data-select="${t}"]`);
      if (!(await h.js('state.selected.has(1)'))) await h.click('[data-select="1"]');
      h.assert.deepEqual(await h.js('[...state.selected]'), [1], 'only title 1 is selected');
      await h.click('[data-action="rip"]');
      await h.idle();
      h.assert.deepEqual(await h.js('state.queue.map(j => j.state)'), ['done']);
      const out = files(h.outDir).filter((f) => f.endsWith('.mkv'));
      h.assert.equal(out.length, 1, `one MKV (${files(h.outDir).join(', ')})`);
      const p = h.probe(path.join(h.outDir, out[0]));
      h.assert.equal(p.streams.filter((s) => s.codec_type === 'video').length, 1);
      const audio = p.streams.filter((s) => s.codec_type === 'audio');
      h.assert.deepEqual(audio.map((s) => s.tags && s.tags.language), ['eng', 'spa']);
      h.assert.equal(p.chapters.length, 4, '4 chapters');
      // Same tolerance as the engine accurateChapters=false test (plan 01-04).
      p.chapters.forEach((c, i) => h.assert.ok(Math.abs(+c.start_time - i * 10) <= 0.6, `chapter ${i + 1} starts at ${c.start_time}s, expected ${i * 10}s`));
      h.note(`chapters at ${p.chapters.map((c) => (+c.start_time).toFixed(2)).join(', ')} s`);
    },
  },

  us_bluray_encrypted: {
    stories: ['US-27', 'SEC-11'],
    title: 'Encrypted Blu-ray without libaacs: clear message, Rip disabled, and the backend refuses it too',
    async run(h) {
      await h.load(h.fx('bd_aacs'));
      // The reason depends on whether libaacs/KEYDB.cfg are installed here; it must always be specific.
      h.assert.match(await h.js(`document.querySelector('.error-box.banner').textContent`), /encrypted \(AACS\).*(libaacs|KEYDB\.cfg|AACS files|handshake)/);
      h.assert.equal(await h.js(`document.querySelector('[data-action="rip"]').disabled`), true);
      // A missing or non-matching key file gets a one-click fix right in the banner.
      h.assert.equal(await h.js(`!!document.querySelector('.error-box.banner [data-action="keydb-pick"]')`), false, 'no key-file button for a damaged-AACS disc');
      h.assert.equal(await h.js(`state.disc.keydbFixable = true; renderMain(); !!document.querySelector('.error-box.banner [data-action="keydb-pick"]')`), true);
      await h.shot('encrypted');
      const r = await call(h, `spinarr.rip([{ source: state.source, title: 1, duration: 90, fileName: 'x', displayName: 'x' }])`);
      h.assert.equal(r.ok, false);
      h.assert.match(r.e, /encrypted/);
      h.assert.deepEqual(files(h.outDir), []);
    },
  },

  sec_bluray_hostile: {
    stories: ['SEC-08', 'SEC-09'],
    title: 'Hostile Blu-ray label and broken playlists: shown as text, no crash',
    async run(h) {
      await h.load(h.fx('bd_xss_label.iso'));
      h.assert.equal(await h.js('state.disc.label'), '<img src=x onerror=__xss=3>');
      await h.sleep(300);
      h.assert.equal(await h.js('window.__xss'), undefined);
      h.assert.equal(await h.js(`document.querySelectorAll('#main img').length`), 0);
      for (const bad of ['bd_truncated_mpls', 'bd_empty']) {
        await h.load(h.fx(bad));
        const st = await h.js('({ disc: !!state.disc, error: state.error, main: state.disc && state.disc.titles.some(t => t.main) })');
        h.assert.ok(st.error || (st.disc && !st.main), `${bad}: error or no playable main title`);
        h.note(`${bad}: ${st.error || 'scanned, no playable titles'}`);
      }
    },
  },

  ux_keyboard: {
    stories: ['US-28'],
    title: 'Keyboard: move, select, expand, select all, rip and settings; title cards show rip status',
    async run(h) {
      const wc = h.win.webContents;
      const key = async (keyCode, modifiers = []) => {
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        await h.sleep(120);
      };
      const focused = () => h.js('document.activeElement.dataset.expand || null');
      const selected = () => h.js('[...state.selected].sort((a, b) => a - b)');
      await h.load(h.fx('feature_disc.iso'));
      await h.click('[data-toggle="showShort"]'); // titles 1, 2, 4 visible; 2 (main) selected
      await h.js('document.activeElement.blur(); 1');

      await key('Down');
      h.assert.equal(await focused(), '1', 'first arrow focuses the first title');
      await key('Space');
      h.assert.deepEqual(await selected(), [1, 2]);
      await key('Down'); await key('Down');
      h.assert.equal(await focused(), '4');
      await key('Right');
      h.assert.equal(await h.js('state.open.has(4)'), true, '→ expands');
      await key('Left');
      h.assert.equal(await h.js('state.open.has(4)'), false, '← collapses');

      await key('A', ['meta']);
      h.assert.deepEqual(await selected(), [1, 2, 4], '⌘A selects every visible title');
      await key('A', ['meta']);
      h.assert.deepEqual(await selected(), [], '⌘A again clears');
      h.assert.equal(await h.js(`document.querySelector('[data-action="rip"]').disabled`), true);

      await key('Space'); // focus is still on title 4
      await key('Return', ['meta']);
      await h.waitFor('state.queue.length === 1', { what: '⌘↩ to queue a rip' });
      h.assert.equal(await h.js('state.queue[0].title'), 4);
      await h.idle();
      await h.waitFor(`document.querySelector('[data-title="4"] .rip-state').textContent === 'Ripped'`, { what: 'card shows Ripped' });
      h.assert.equal(await h.js(`document.querySelector('[data-title="4"]').classList.contains('ripped')`), true);
      h.assert.equal(await h.js(`document.querySelector('[data-title="2"] .rip-state').textContent`), '', 'only the ripped title is marked');
      await h.shot('ripped');

      await key(',', ['meta']);
      h.assert.equal(await h.js(`document.getElementById('settingsDlg').open`), true, '⌘, opens Settings');
      await key('Escape');
      await h.waitFor(`!document.getElementById('settingsDlg').open`, { what: 'Escape closes Settings' });
    },
  },

  // Not a test: renders the README screenshots into docs/screenshots at 2x. `npm run screenshots`
  docs_screenshots: {
    docs: true,
    stories: [],
    env: { SPINARR_READRATE: '4' }, // slow enough to catch a rip mid-way
    title: 'README screenshots',
    async run(h) {
      const fs = require('fs');
      const { nativeTheme } = require('electron');
      const dir = path.join(__dirname, '..', '..', 'docs', 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const wc = h.win.webContents;
      // 2x without a Retina display: a double-size window rendered at 200% zoom.
      const disp = require('electron').screen.getPrimaryDisplay();
      const scale = disp.scaleFactor >= 2 ? 1 : Math.min(2, Math.floor(((disp.workArea.height - 40) / 820) * 10) / 10);
      h.win.setContentSize(1280 * scale, 820 * scale);
      wc.setZoomFactor(scale);
      wc.setBackgroundThrottling(false);
      // Show a tidy output folder instead of the test's temp directory (display only).
      const tidy = () => h.js(`state.settings = { ...state.settings, outputDir: '/Users/you/Movies/Spinarr' }; rerenderActionBar(); document.getElementById('toasts').innerHTML = ''; document.activeElement.blur(); 1`);
      const snap = async (name) => {
        await tidy();
        await h.sleep(700);
        wc.invalidate();
        await h.sleep(300);
        const img = await wc.capturePage();
        h.note(`${name}: ${img.getSize().width}x${img.getSize().height}`);
        fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
      };
      const rename = (n) => h.js(`(() => { const i = document.getElementById('discName'); i.value = ${JSON.stringify(n)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);

      nativeTheme.themeSource = 'dark';
      await h.js(`state.disc = null; state.error = null; renderMain(); 1`);
      await snap('empty');

      await h.load(h.fx('bd_movie.iso'));
      await rename('Northern Lights');
      await h.click('[data-expand="1"]');
      await h.waitFor('state.probes.get(1) && state.probes.get(1).data');
      await snap('disc');

      nativeTheme.themeSource = 'light';
      await snap('disc-light');
      nativeTheme.themeSource = 'dark';

      await h.load(h.fx('feature_disc.iso'));
      await rename('Northern Lights — Bonus Disc');
      await h.click('[data-toggle="showShort"]');
      await h.click('[data-select="1"]');
      await h.click('[data-select="4"]');
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue[1] && state.queue[1].state === "ripping" && state.queue[1].progress > 0.45', { timeout: 120000 });
      await snap('ripping');
      await h.js('Promise.all(state.queue.map(j => spinarr.cancel(j.id))).then(() => 1)');
    },
  },

  ux_pinstripe_skin: {
    stories: ['US-30'],
    title: 'Appearance: the Pinstripe skin applies at once, persists, and stays readable mid-rip',
    env: { SPINARR_READRATE: '4' },
    async run(h) {
      await h.load(h.fx('feature_disc.iso'));
      await h.click('#settingsBtn');
      await h.click('#skinPinstripe');
      h.assert.equal(await h.js('document.documentElement.dataset.skin'), 'pinstripe', 'previews at once');
      await h.shot('settings');
      await h.click('#settingsDlg button[value="ok"]');
      await h.waitFor('state.settings.skin === "pinstripe"', { what: 'skin saved' });
      h.assert.equal((await h.js(`getComputedStyle(document.documentElement).getPropertyValue('--accent')`)).trim(), '#3d84e0');
      await h.click('[data-toggle="showShort"]');
      await h.click('[data-select="4"]');
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue[0] && state.queue[0].state === "ripping" && state.queue[0].progress > 0.3', { timeout: 180000 });
      h.assert.equal(await h.js(`document.querySelector('.disc-head').classList.contains('ripping')`), true);
      await h.js(`document.getElementById('toasts').innerHTML = ''; 1`);
      await h.shot('ripping');
      await h.js('Promise.all(state.queue.map(j => spinarr.cancel(j.id))).then(() => 1)');
    },
  },

  ux_skins: {
    stories: ['US-30'],
    title: 'Appearance: every look applies at once mid-rip, is saved, and keeps the disc readout',
    env: { SPINARR_READRATE: '4' },
    async run(h) {
      const looks = { studio: null, paper: null, pinstripe: '#3d84e0', millennium: '#3b6cff', neon: '#f5e400', blossom: '#ff7fae' };
      await h.load(h.fx('feature_disc.iso'));
      await h.click('[data-toggle="showShort"]');
      await h.click('[data-select="4"]');
      await h.click('[data-action="rip"]');
      await h.waitFor('state.queue[0] && state.queue[0].state === "ripping" && state.queue[0].progress > 0.2', { timeout: 180000 });
      for (const [skin, accent] of Object.entries(looks)) {
        const id = `#skin${skin[0].toUpperCase()}${skin.slice(1)}`;
        await h.click('#settingsBtn');
        await h.click(id);
        h.assert.equal(await h.js('document.documentElement.dataset.skin'), skin, `${skin} previews at once`);
        if (skin === 'neon' || skin === 'blossom') { await h.sleep(600); await h.shot(`picker-${skin}`); }
        await h.click('#settingsDlg button[value="ok"]');
        await h.waitFor(`state.settings.skin === "${skin}"`, { what: `${skin} saved` });
        if (accent) h.assert.equal((await h.js(`getComputedStyle(document.documentElement).getPropertyValue('--accent')`)).trim(), accent);
        h.assert.equal(await h.js(`document.querySelector('.disc-head').classList.contains('ripping')`), true);
        await h.js(`document.getElementById('toasts').innerHTML = ''; 1`);
        await h.sleep(400);
        await h.shot(`ripping-${skin}`);
      }
      await h.js('Promise.all(state.queue.map(j => spinarr.cancel(j.id))).then(() => 1)');
    },
  },

  ux_light_theme: {
    stories: ['US-24'],
    title: 'Light appearance renders correctly (visual check)',
    async run(h) {
      require('electron').nativeTheme.themeSource = 'light';
      await h.load(h.fx('pal_subs.iso'));
      await h.click('[data-expand="1"]');
      await h.waitFor('state.probes.get(1) && state.probes.get(1).data');
      await h.sleep(300);
      await h.shot('light');
      const bg = await h.js('getComputedStyle(document.body).backgroundColor');
      h.assert.equal(bg, 'rgb(246, 246, 244)');
    },
  },
});
