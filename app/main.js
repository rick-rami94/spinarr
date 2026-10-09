const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, net } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const lib = require('./lib');

const ENGINE = app.isPackaged
  ? path.join(process.resourcesPath, 'engine')
  : process.env.SPINARR_ENGINE_DIR || path.join(__dirname, '..', 'engine', 'bin');
const bin = (name) => path.join(ENGINE, name);
// The UI is served from its own origin (app://spinarr/) instead of file://, so CSP 'self'
// means "Spinarr's renderer files" rather than "any file on disk" (e.g. on a hostile disc).
const RENDERER_DIR = path.join(__dirname, 'renderer');
const INDEX_URL = 'app://spinarr/index.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

function serveRenderer(request) {
  const url = new URL(request.url);
  const file = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(url.pathname)));
  if (url.host !== 'spinarr' || !file.startsWith(RENDERER_DIR + path.sep) || !/\.(html|js|css|svg|png)$/.test(file)) {
    return new Response('Not found', { status: 404 });
  }
  return net.fetch(pathToFileURL(file).href);
}

// ---------- settings ----------
if (process.env.SPINARR_USER_DATA && !app.isPackaged) app.setPath('userData', process.env.SPINARR_USER_DATA);
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  outputDir: path.join(os.homedir(), 'Movies', 'Spinarr'),
  minMinutes: 2,
  accurateChapters: false, // a second full read of the title: doubles rip time on a real drive
};
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
  const s = { ...DEFAULTS, ...lib.sanitizeSettingsPatch(saved) };
  if (typeof saved.outputDir === 'string' && path.isAbsolute(saved.outputDir)) s.outputDir = saved.outputDir;
  return s;
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}
let settings = loadSettings();

// ---------- window ----------
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 900, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0e0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  // The UI is a single local page: never navigate away or open new windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.loadURL(INDEX_URL);
  // Dev/test hook: SPINARR_TEST=/path/to/script.js drives the window after load. Ignored in packaged builds.
  if (process.env.SPINARR_TEST && !app.isPackaged) {
    win.webContents.once('did-finish-load', () => require(process.env.SPINARR_TEST)(win, app, { queue }));
  }
}
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

// ---------- helpers ----------
function run(cmd, args, { timeout = 120000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, env, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (!stdout || err.signal)) {
        const msg = err.killed && !err.signal ? 'Timed out reading the disc'
          : err.signal ? 'The disc data is damaged or not supported, so the engine stopped safely.'
          : (stderr || err.message).trim().split('\n').pop();
        return reject(new Error(msg));
      }
      resolve(stdout);
    });
  });
}

// ---------- engine processes (sandboxed) ----------
const CSS_CACHE = path.join(os.homedir(), 'Library', 'Caches', 'dvdcss');
const NO_SANDBOX = process.env.SPINARR_NO_SANDBOX === '1' && !app.isPackaged;
// Engines get a minimal environment: nothing inherited (no DYLD_*, no proxies, no secrets).
const ENGINE_ENV = { HOME: os.homedir(), PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', DVDCSS_CACHE: CSS_CACHE };

// Where the user's own libaacs/libbdplus look for keys (KEYDB.cfg) and keep caches on macOS.
const LIB = path.join(os.homedir(), 'Library');
const KEY_DIRS = {
  aacsConf: path.join(LIB, 'Preferences', 'aacs'), bdplusConf: path.join(LIB, 'Preferences', 'bdplus'),
  aacsCache: path.join(LIB, 'Caches', 'aacs'), bdplusCache: path.join(LIB, 'Caches', 'bdplus'),
};

function engine(name, args, { source, outDir }) {
  const binPath = bin(name);
  if (NO_SANDBOX) return [binPath, args];
  fs.mkdirSync(CSS_CACHE, { recursive: true });
  const real = (p) => fs.realpathSync(p);
  const realOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  return lib.sandboxed(real(binPath), args, {
    engineDir: real(ENGINE),
    source: real(source),
    outDir: real(outDir || CSS_CACHE),
    cssCache: real(CSS_CACHE),
    keyDirs: Object.fromEntries(Object.entries(KEY_DIRS).map(([k, v]) => [k, realOrSelf(v)])),
  });
}
const runEngine = (name, args, ctx, opts = {}) => run(...engine(name, args, ctx), { ...opts, env: ENGINE_ENV });

// ---------- drives ----------
async function listDrives() {
  const out = [];
  let vols = [];
  try { vols = fs.readdirSync('/Volumes'); } catch {}
  // Dev/test only: limit detection to named volumes so tests ignore real discs in the drive.
  const only = !app.isPackaged && process.env.SPINARR_VOLUMES ? process.env.SPINARR_VOLUMES.split(',') : null;
  for (const v of vols) {
    if (only && !only.includes(v)) continue;
    const p = path.join('/Volumes', v);
    const media = lib.sourceKind(p);
    if (!media) continue;
    let kind = 'other';
    try { kind = lib.volumeKind(await run('diskutil', ['info', '-plist', p], { timeout: 10000 })); } catch {}
    out.push({ name: v, path: p, kind, media });
  }
  let hasDrive = false;
  try { hasDrive = /Vendor/.test(await run('drutil', ['status'], { timeout: 5000 })); } catch {}
  return { discs: out, hasDrive };
}

let volWatch;
function watchVolumes() {
  try {
    let t;
    volWatch = fs.watch('/Volumes', () => {
      clearTimeout(t);
      t = setTimeout(async () => send('drives-changed', await listDrives()), 800);
    });
  } catch {}
}

// ---------- scanning ----------
// Scan results stay in the main process: Blu-ray rips are built from them, never from
// renderer-supplied stream or playlist data.
const scans = new Map();

async function readInfo(tool, source) {
  try { return JSON.parse(await runEngine(tool, [source], { source }, { timeout: 180000 })); }
  catch (e) { throw new Error(e instanceof SyntaxError ? 'Could not read the disc structure' : e.message); }
}

async function scan(source) {
  const kind = lib.sourceKind(source);
  let json;
  if (kind === 'bluray') json = await readInfo('bdinfo', source);
  else if (kind === 'dvd') json = await readInfo('dvdinfo', source);
  else { // disc image: DVD first, then Blu-ray
    json = await readInfo('dvdinfo', source);
    if (json.error) {
      const bd = await readInfo('bdinfo', source);
      json = bd.error ? { error: 'Not a DVD or Blu-ray disc' } : bd;
    }
  }
  if (json.error) throw new Error(String(json.error));
  const result = { ...lib.analyzeTitles(json, source), type: json.type === 'bluray' ? 'bluray' : 'dvd', encryption: json.encryption || null };
  result.blocked = result.type === 'bluray' ? blurayBlocker(result.encryption) : null;
  if (scans.size > 50) scans.delete(scans.keys().next().value);
  scans.set(source, result);
  return result;
}

function scannedTitle(source, title) {
  const disc = scans.get(source);
  const t = disc?.titles.find((x) => x.title === title);
  if (!disc || !t) throw new Error('Scan the disc again before ripping');
  return { disc, t };
}

// Why an encrypted Blu-ray can't be ripped, or null if it can.
function blurayBlocker(enc) {
  if (!enc) return null;
  if (enc.aacs && !enc.aacsHandled) {
    return enc.libaacs
      ? 'This Blu-ray is encrypted (AACS) and no key for it was found in your KEYDB.cfg.'
      : 'This Blu-ray is encrypted (AACS). Install libaacs (brew install libaacs) and a KEYDB.cfg key file to rip it.';
  }
  if (enc.bdplus && !enc.bdplusHandled) return 'This Blu-ray uses BD+ protection, which Spinarr can\'t remove.';
  return null;
}

async function probeStreams(source, title) {
  const disc = scans.get(source);
  if (disc?.type === 'bluray') {
    const { t } = scannedTitle(source, title);
    const j = JSON.parse(await runEngine('ffprobe', [
      '-v', 'error', '-playlist', String(t.playlist), '-i', `bluray:${source}`, '-show_streams', '-of', 'json',
    ], { source }, { timeout: 90000 }));
    // The transport stream has no language tags; take them from the playlist, by PID.
    const langs = new Map([...t.audio, ...t.subtitles].filter((x) => x.pid).map((x) => [x.pid, x.lang]));
    for (const st of j.streams || []) {
      const pid = parseInt(st.id, 16);
      if (langs.has(pid)) st.tags = { ...st.tags, language: langs.get(pid) };
    }
    return { j, t };
  }
  const j = JSON.parse(await runEngine('ffprobe', [
    '-v', 'error', '-f', 'dvdvideo', '-title', String(title), '-i', source,
    '-show_streams', '-show_chapters', '-of', 'json',
  ], { source }, { timeout: 90000 }));
  return { j };
}

async function probeTitle(source, title) {
  const { j, t } = await probeStreams(source, title);
  return {
    streams: (j.streams || []).map((s) => ({
      index: s.index,
      type: s.codec_type,
      codec: s.codec_name,
      lang: typeof s.tags?.language === 'string' ? s.tags.language.slice(0, 8) : '',
      channels: s.channels,
      width: s.width, height: s.height,
      // DVDs carry per-viewport copies of each subtitle language; ffmpeg tags which is which.
      viewport: typeof s.tags?.VIEWPORT === 'string' ? s.tags.VIEWPORT.slice(0, 20) : '',
      forced: s.disposition?.forced === 1,
      commentary: s.disposition?.comment === 1,
      impaired: s.disposition?.visual_impaired === 1,
    })),
    chapters: t ? t.chapters.length : (j.chapters || []).length,
  };
}

// ---------- ripping queue ----------
const queue = [];
let active = null;

function enqueue(jobs) {
  if (!Array.isArray(jobs) || jobs.length > 99) throw new Error('Invalid job list');
  const clean = jobs.map((j) => {
    const job = lib.validateJob(j);
    const disc = scans.get(job.source);
    if (disc?.type === 'bluray') {
      const blocked = blurayBlocker(disc.encryption);
      if (blocked) throw new Error(blocked);
      const { t } = scannedTitle(job.source, job.title);
      Object.assign(job, { kind: 'bluray', playlist: t.playlist, chapterDurations: t.chapters, duration: t.duration || job.duration });
    }
    return job;
  }); // all-or-nothing
  for (const j of clean) {
    queue.push({
      ...j,
      outputDir: settings.outputDir,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      state: 'queued',
      progress: 0,
    });
  }
  broadcastQueue();
  pump();
}

const publicJob = ({ proc, source, ...j }) => j;
function broadcastQueue() { send('queue', queue.map(publicJob)); }

function pump() {
  if (active) return;
  const job = queue.find((j) => j.state === 'queued');
  if (!job) return;
  active = job;
  job.state = 'ripping';
  job.startedAt = Date.now();

  let final;
  try {
    fs.mkdirSync(job.outputDir, { recursive: true });
    final = lib.uniquePath(path.join(job.outputDir, job.fileName + '.mkv'));
  } catch (e) {
    return finish(job, 'failed', e.message);
  }
  const part = final + '.part';
  job.output = final;

  if (job.kind === 'bluray') {
    prepareBluray(job, part).then((args) => start(job, args, part, final), (e) => {
      if (job.chaptersFile) fs.rmSync(job.chaptersFile, { force: true });
      finish(job, job.state === 'cancelled' ? 'cancelled' : 'failed', e.message);
    });
    return;
  }
  start(job, lib.ripArgs(job, part), part, final);
}

async function prepareBluray(job, part) {
  const { j } = await probeStreams(job.source, job.title);
  const all = (j.streams || []).filter((s) => ['video', 'audio', 'subtitle'].includes(s.codec_type));
  const chosen = job.streams ? all.filter((s) => job.streams.includes(s.index)) : all;
  if (!chosen.length) throw new Error('No streams selected');
  if (job.state !== 'ripping') throw new Error('Cancelled');
  // Chapters go next to the output (inside the sandbox's writable folder) and are removed after.
  job.chaptersFile = part.replace(/\.mkv\.part$/, '.chapters.txt');
  fs.writeFileSync(job.chaptersFile, lib.chaptersMetadata(job.chapterDurations || []));
  return lib.blurayRipArgs(job, chosen.map((s) => ({ index: s.index, codec: s.codec_name, lang: s.tags?.language })), job.chaptersFile, part);
}

function start(job, args, part, final) {
  if (job.state !== 'ripping') {
    if (job.chaptersFile) fs.rmSync(job.chaptersFile, { force: true });
    return finish(job, 'cancelled');
  }
  let proc;
  try {
    // Dev/test only: throttle reads so tests can observe progress and cancel mid-rip.
    if (!app.isPackaged && +process.env.SPINARR_READRATE > 0) args.unshift('-readrate', String(+process.env.SPINARR_READRATE));
    proc = spawn(...engine('ffmpeg', args, { source: job.source, outDir: job.outputDir }),
      { stdio: ['ignore', 'pipe', 'pipe'], env: ENGINE_ENV });
  } catch (e) {
    return finish(job, 'failed', e.message);
  }
  job.proc = proc;
  let stderr = '';
  let lastSend = 0;
  const feed = lib.progressParser(job.duration, (st) => {
    Object.assign(job, st);
    if (Date.now() - lastSend > 250) { lastSend = Date.now(); broadcastQueue(); }
  }, job.fps);
  proc.stdout.on('data', feed);
  proc.stderr.on('data', (d) => { if (stderr.length < 64 * 1024) stderr += d; });
  proc.on('error', (e) => { stderr += e.message; });
  proc.on('close', async (code, signal) => {
    delete job.proc;
    if (job.chaptersFile) fs.rmSync(job.chaptersFile, { force: true });
    if (job.state === 'cancelled') { fs.rmSync(part, { force: true }); return finish(job, 'cancelled'); }
    // Verify the finished file itself: how much video did it actually get?
    let videoSeconds = null;
    if (code === 0 && !signal) {
      try {
        const out = await runEngine('ffprobe', ['-v', 'error', '-f', 'matroska', '-show_entries', 'stream=codec_type:stream_tags=DURATION', '-of', 'json', part],
          { source: job.outputDir, outDir: job.outputDir }, { timeout: 60000 });
        videoSeconds = lib.outputVideoSeconds(JSON.parse(out));
      } catch {}
    }
    if (job.state === 'cancelled') { fs.rmSync(part, { force: true }); return finish(job, 'cancelled'); }
    const verdict = lib.ripVerdict({ code, signal, stderr, videoSeconds, duration: job.duration });
    if (verdict.ok) {
      try {
        fs.renameSync(part, final);
        job.bytes = fs.statSync(final).size;
        job.progress = 1;
        return finish(job, 'done');
      } catch (e) { fs.rmSync(part, { force: true }); return finish(job, 'failed', e.message); }
    }
    fs.rmSync(part, { force: true });
    finish(job, 'failed', verdict.error);
  });
}

function finish(job, state, error) {
  job.state = state;
  if (error) job.error = error;
  job.finishedAt = Date.now();
  if (active === job) active = null;
  broadcastQueue();
  if (!queue.some((j) => j.state === 'queued')) send('queue-idle', null);
  setImmediate(pump);
}

function cancel(id) {
  const job = queue.find((j) => j.id === id);
  if (!job) return;
  if (job.state === 'queued') { job.state = 'cancelled'; broadcastQueue(); }
  else if (job.state === 'ripping') { job.state = 'cancelled'; job.proc?.kill('SIGTERM'); broadcastQueue(); }
}

function clearFinished() {
  for (let i = queue.length - 1; i >= 0; i--) if (!['queued', 'ripping'].includes(queue[i].state)) queue.splice(i, 1);
  broadcastQueue();
}

// ---------- IPC ----------
// Only our own page may call in; arguments are validated in each handler.
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (e.senderFrame?.url !== INDEX_URL || e.sender !== win?.webContents) throw new Error('Unauthorized');
    return fn(...args);
  });
}

handle('settings:get', () => settings);
handle('settings:set', (patch) => {
  settings = { ...settings, ...lib.sanitizeSettingsPatch(patch) };
  saveSettings(settings);
  return settings;
});
handle('drives', () => listDrives());
handle('scan', (source) => scan(lib.validateSource(source)));
handle('probe', (source, title) => probeTitle(lib.validateSource(source), lib.validateTitle(title)));
handle('rip', (jobs) => enqueue(jobs));
handle('cancel', (id) => cancel(String(id)));
handle('clear-finished', () => clearFinished());
handle('reveal', (id) => {
  const job = queue.find((j) => j.id === id && j.state === 'done');
  if (job) shell.showItemInFolder(job.output);
});
handle('eject', async (p) => {
  const { discs } = await listDrives();
  if (!discs.some((d) => d.path === p)) throw new Error('Not a mounted disc');
  try { await run('diskutil', ['eject', p], { timeout: 30000 }); }
  catch { await run('drutil', ['eject'], { timeout: 30000 }); }
});
handle('pick-source', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open DVD image or VIDEO_TS folder',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'DVD image', extensions: ['iso', 'img'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  let p = r.filePaths[0];
  if (path.basename(p).toUpperCase() === 'VIDEO_TS') p = path.dirname(p);
  return p;
});
handle('pick-output', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outputDir });
  if (r.canceled || !r.filePaths[0]) return settings;
  settings = { ...settings, outputDir: r.filePaths[0] };
  saveSettings(settings);
  return settings;
});
handle('free-space', () => {
  try {
    let d = settings.outputDir;
    while (!fs.existsSync(d)) d = path.dirname(d);
    const s = fs.statfsSync(d);
    return s.bavail * s.bsize;
  } catch { return null; }
});

app.whenReady().then(() => {
  protocol.handle('app', serveRenderer);
  // Deny every permission except desktop notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'notifications');
  createWindow();
  watchVolumes();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('web-contents-created', (_e, wc) => wc.setWindowOpenHandler(() => ({ action: 'deny' })));
// Stop engines and delete partial files on every quit path. Electron skips
// 'window-all-closed' for Cmd+Q / app.quit(), so cleanup lives in 'will-quit'.
function stopAll() {
  for (const j of queue) {
    if (!j.proc) continue;
    j.state = 'cancelled';
    j.proc.kill('SIGTERM');
    fs.rmSync(j.output + '.part', { force: true });
    if (j.chaptersFile) fs.rmSync(j.chaptersFile, { force: true });
  }
  volWatch?.close();
}
app.on('will-quit', stopAll);
app.on('window-all-closed', () => app.quit());
