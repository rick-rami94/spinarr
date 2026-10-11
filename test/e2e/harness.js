// Loaded inside the Electron main process via SPINARR_TEST. Runs one scenario from
// scenarios.js against the live window and writes a JSON result for run.js.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const scenarios = require('./scenarios');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (win, app, ctx) => {
  const name = process.env.SPINARR_SCENARIO;
  const launch = +(process.env.SPINARR_LAUNCH || 0);
  const resultFile = process.env.SPINARR_RESULT;
  const outDir = process.env.E2E_OUT;
  const shotsDir = process.env.E2E_SHOTS;
  const FX = path.join(__dirname, '..', 'fixtures', 'out');
  const result = { name, launch, pass: false, notes: [] };

  const js = (code) => win.webContents.executeJavaScript(code);
  const waitFor = async (code, { timeout = 20000, interval = 100, what = code } = {}) => {
    const end = Date.now() + timeout;
    for (;;) {
      const v = await js(code).catch(() => undefined);
      if (v) return v;
      if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
      await sleep(interval);
    }
  };
  const shot = async (label) => {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    // Background windows aren't repainted, so force a fresh frame before capturing.
    win.webContents.setBackgroundThrottling(false);
    win.webContents.invalidate();
    await sleep(250);
    fs.writeFileSync(path.join(shotsDir, `${name}-${label}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element ${sel.replace(/'/g, '')}'); el.click(); return true; })()`);
  // When the engine sandbox is off every scan asks first. Click the real "Scan anyway" button
  // (no test bypass of the gate), then wait for the scan to finish. A no-op when trusted.
  const consent = async () => {
    if (await js('!!state.pendingScan')) await click('[data-action="scan-anyway"]');
    await waitFor('!state.scanning && !state.pendingScan', { what: 'scan to finish' });
  };
  const load = async (src) => {
    await js(`requestScan(${JSON.stringify(src)})`);
    await waitFor('state.pendingScan || state.scanning || state.disc || state.error', { what: 'scan or prompt' });
    await consent();
  };
  // Scan entry-point drivers for the SAFE-01 gate scenarios.
  const fakeInsert = (name, p, media = 'dvd') => win.webContents.send('drives-changed', { discs: [{ name, path: p, kind: 'optical', media }], hasDrive: true });
  const fakeEject = () => win.webContents.send('drives-changed', { discs: [], hasDrive: true });
  // A real OS-level drop through CDP, so the renderer's drop listener and pathForFile run as-is.
  const dropFile = async (p) => {
    const dbg = win.webContents.debugger;
    const attached = dbg.isAttached();
    if (!attached) dbg.attach('1.3');
    try {
      const [w, hgt] = win.getContentSize();
      const at = { x: Math.round(w / 2), y: Math.round(hgt / 2), modifiers: 0 };
      const data = { items: [], files: [p], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await dbg.sendCommand('Input.dispatchDragEvent', { type, ...at, data });
    } finally {
      if (!attached) dbg.detach();
    }
  };
  // The next native open dialog returns these paths (main process; dialog is a shared object).
  const stubDialog = (paths) => {
    const { dialog } = require('electron');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  };
  const idle = (timeout = 60000) => waitFor(`state.queue.length > 0 && state.queue.every(j => !['queued','ripping'].includes(j.state))`, { timeout, what: 'queue idle' });
  const probe = (file) => JSON.parse(execFileSync(path.join(process.env.ORACLE_FFMPEG_DIR || '/usr/local/bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'), ['-v', 'error', '-show_streams', '-show_chapters', '-show_format', '-of', 'json', file]));
  const note = (s) => result.notes.push(s);

  const h = { win, app, ctx, js, waitFor, shot, click, load, consent, fakeInsert, fakeEject, dropFile, stubDialog, idle, probe, note, sleep, assert, fx: (n) => path.join(FX, n), outDir, launch };
  try {
    await waitFor('typeof state !== "undefined" && state.settings', { what: 'app boot' });
    const sc = scenarios[name];
    if (!sc) throw new Error(`unknown scenario ${name}`);
    const fn = Array.isArray(sc.launches) ? sc.launches[launch] : sc.run;
    await fn(h);
    result.pass = true;
  } catch (e) {
    result.error = e && (e.stack || e.message || String(e));
    await shot('FAILED').catch(() => {});
  }
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  if (!(scenarios[name] && scenarios[name].keepOpen)) app.quit();
};
