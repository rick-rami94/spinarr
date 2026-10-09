// Everything that differs between macOS, Linux and Windows: finding and ejecting discs,
// the engine sandbox, where decryption libraries and their caches live, and how to tell
// the user to install libdvdcss. Pure helpers are exported for unit tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

const VIDEOLAN_WIN64 = 'https://download.videolan.org/pub/libdvdcss/1.2.11/win64/';

// ---------- pure helpers ----------

// `lsblk -J -o NAME,PATH,TYPE,RM,LABEL,MOUNTPOINT` -> [{ device, type, label, mount }]
function parseLsblk(json) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return []; }
  const out = [];
  const walk = (list) => {
    for (const d of list || []) {
      const mount = d.mountpoint || (Array.isArray(d.mountpoints) ? d.mountpoints.find(Boolean) : null);
      out.push({ device: d.path || (d.name ? `/dev/${d.name}` : null), type: d.type, label: d.label || null, mount: mount || null });
      walk(d.children);
    }
  };
  walk(data && data.blockdevices);
  return out;
}

// `Get-CimInstance Win32_LogicalDisk | ConvertTo-Json` -> [{ root, optical, label }]
function parseWinDisks(json) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return []; }
  if (!data) return [];
  return (Array.isArray(data) ? data : [data])
    .filter((d) => /^[A-Z]:$/i.test(d.DeviceID || ''))
    .map((d) => ({ root: `${d.DeviceID.toUpperCase()}\\`, optical: d.DriveType === 5, label: d.VolumeName || null }));
}

// Linux distro family from /etc/os-release text, for the right libdvdcss install command.
function distroFamily(osRelease) {
  const get = (k) => (new RegExp(`^${k}=["']?([^"'\\n]*)`, 'm').exec(osRelease || '') || [])[1] || '';
  const ids = `${get('ID')} ${get('ID_LIKE')}`.toLowerCase();
  if (/\b(debian|ubuntu)\b/.test(ids)) return 'debian';
  if (/\b(fedora|rhel|centos)\b/.test(ids)) return 'fedora';
  if (/\barch\b/.test(ids)) return 'arch';
  if (/\b(suse|opensuse)\b/.test(ids)) return 'suse';
  return 'other';
}

const DVDCSS_COMMANDS = {
  darwin: 'brew install libdvdcss',
  debian: 'sudo apt install libdvd-pkg && sudo dpkg-reconfigure libdvd-pkg',
  fedora: 'sudo dnf install libdvdcss   # from RPM Fusion (tainted)',
  arch: 'sudo pacman -S libdvdcss',
  suse: 'sudo zypper install libdvdcss2   # from Packman',
  other: 'Install libdvdcss (libdvdcss.so.2) from your distribution',
};

// Arguments for running `binPath args` inside bubblewrap: no network, no IPC, a fresh PID
// namespace, the system libraries read-only, the engine and source read-only, and write
// access only to the output folder and the decryption caches.
// hostRoots: [{ path, link }] for /lib, /lib64, /bin ... (a symlink on merged-/usr systems).
function bwrapArgs(binPath, args, { engineDir, source, outDir, cssCache, keyDirs = {}, devices = [], hostRoots = [] }) {
  const k = { aacsConf: cssCache, bdplusConf: cssCache, aacsCache: cssCache, bdplusCache: cssCache, ...keyDirs };
  for (const p of [binPath, engineDir, source, outDir, cssCache, k.aacsConf, k.bdplusConf, k.aacsCache, k.bdplusCache, ...devices]) {
    if (typeof p !== 'string' || !path.posix.isAbsolute(p) || /[\0\n]/.test(p)) throw new Error('Invalid sandbox path');
  }
  // No --new-session: the app already starts the engine in its own session with no
  // controlling terminal (so TIOCSTI can't reach one), as its process-group leader.
  const a = ['--die-with-parent', '--unshare-all', '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr'];
  for (const r of hostRoots) {
    if (r.link) a.push('--symlink', r.link, r.path);
    else a.push('--ro-bind-try', r.path, r.path);
  }
  for (const f of ['/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d']) a.push('--ro-bind-try', f, f);
  a.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--symlink', '../proc/self/mounts', '/etc/mtab');
  for (const d of devices) a.push('--dev-bind-try', d, d);
  a.push('--ro-bind', engineDir, engineDir, '--ro-bind', source, source);
  a.push('--bind', outDir, outDir, '--bind', cssCache, cssCache);
  a.push('--ro-bind-try', k.aacsConf, k.aacsConf, '--ro-bind-try', k.bdplusConf, k.bdplusConf);
  a.push('--bind-try', k.aacsCache, k.aacsCache, '--bind-try', k.bdplusCache, k.bdplusCache);
  a.push('--chdir', '/', binPath, ...args);
  return a;
}

// A Windows DLL we will accept as libdvdcss: a 64-bit PE image (machine x64 or arm64).
function isPe64Dll(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 0x100 || buf.readUInt16LE(0) !== 0x5a4d) return false; // "MZ"
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) return false; // "PE\0\0"
  const machine = buf.readUInt16LE(pe + 4);
  const characteristics = buf.readUInt16LE(pe + 22);
  return (machine === 0x8664 || machine === 0xaa64) && (characteristics & 0x2000) !== 0; // IMAGE_FILE_DLL
}

// Does this look like a libaacs KEYDB.cfg? Text (no NUL bytes) with at least one disc entry
// ("0x<40 hex> = ...") or a key section ("| DK |", "| PK |", "| HC |"). Only the first 1 MB is checked.
function looksLikeKeydb(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  const head = buf.subarray(0, 1024 * 1024);
  if (head.includes(0)) return false;
  const text = head.toString('latin1');
  return /^\s*0x[0-9a-f]{40}\s*=/im.test(text) || /^\s*\|\s*(DK|PK|HC)\s*\|/im.test(text);
}

const AACS_COMMANDS = {
  darwin: 'brew install libaacs',
  debian: 'sudo apt install libaacs0',
  fedora: 'sudo dnf install libaacs',
  arch: 'sudo pacman -S libaacs',
  suse: 'sudo zypper install libaacs0',
  other: 'Install libaacs (libaacs.so.0) from your distribution',
};

// ---------- per-platform implementation ----------

function createPlatform({ run, platform = process.platform, home = os.homedir(), env = process.env, dataDir }) {
  const isMac = platform === 'darwin', isWin = platform === 'win32', isLinux = platform === 'linux';
  // Paths follow the target OS's rules (this also lets tests model one OS on another).
  const P = isWin ? path.win32 : path.posix;
  const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
  const realOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

  // Decryption caches and the user's own libaacs/libbdplus key folders.
  let cssCache, keyDirs;
  if (isMac) {
    const L = P.join(home, 'Library');
    cssCache = P.join(L, 'Caches', 'dvdcss');
    keyDirs = { aacsConf: P.join(L, 'Preferences', 'aacs'), bdplusConf: P.join(L, 'Preferences', 'bdplus'),
      aacsCache: P.join(L, 'Caches', 'aacs'), bdplusCache: P.join(L, 'Caches', 'bdplus') };
  } else if (isWin) {
    const roaming = env.APPDATA || P.join(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || P.join(home, 'AppData', 'Local');
    cssCache = P.join(local, 'dvdcss');
    keyDirs = { aacsConf: P.join(roaming, 'aacs'), bdplusConf: P.join(roaming, 'bdplus'),
      aacsCache: P.join(roaming, 'aacs'), bdplusCache: P.join(roaming, 'bdplus') };
  } else {
    const config = env.XDG_CONFIG_HOME || P.join(home, '.config');
    const cache = env.XDG_CACHE_HOME || P.join(home, '.cache');
    cssCache = P.join(cache, 'dvdcss');
    keyDirs = { aacsConf: P.join(config, 'aacs'), bdplusConf: P.join(config, 'bdplus'),
      aacsCache: P.join(cache, 'aacs'), bdplusCache: P.join(cache, 'bdplus') };
  }
  // Windows only: a per-user folder for libdvdcss-2.dll, put on the engine's DLL search path.
  const userLib = isWin ? P.join(dataDir || P.join(env.APPDATA || home, 'Spinarr'), 'lib') : null;

  // Engines get a minimal environment: nothing inherited (no DYLD_*/LD_*, no proxies, no secrets).
  let engineEnv;
  if (isWin) {
    const sys = env.SystemRoot || 'C:\\Windows';
    engineEnv = { SystemRoot: sys, PATH: [userLib, P.join(sys, 'System32'), sys].join(';'), USERPROFILE: home,
      APPDATA: env.APPDATA || '', LOCALAPPDATA: env.LOCALAPPDATA || '', TEMP: os.tmpdir(), TMP: os.tmpdir(), DVDCSS_CACHE: cssCache };
  } else {
    engineEnv = { HOME: home, PATH: '/usr/bin:/bin', LANG: isMac ? 'en_US.UTF-8' : 'C.UTF-8', DVDCSS_CACHE: cssCache };
    if (isLinux) Object.assign(engineEnv, { XDG_CONFIG_HOME: P.dirname(keyDirs.aacsConf), XDG_CACHE_HOME: P.dirname(cssCache) });
  }

  // ----- sandbox -----
  const BWRAP = ['/usr/bin/bwrap', '/bin/bwrap'].find((p) => isLinux && exists(p)) || null;
  const sandboxKind = isMac ? 'macos' : BWRAP ? 'bubblewrap' : 'none';

  function wrap(binPath, args, { engineDir, source, outDir }) {
    if (sandboxKind === 'none') return [binPath, args];
    fs.mkdirSync(cssCache, { recursive: true });
    const real = (p) => fs.realpathSync(p);
    const ctx = {
      engineDir: real(engineDir), source: real(source), outDir: real(outDir || cssCache), cssCache: real(cssCache),
      keyDirs: Object.fromEntries(Object.entries(keyDirs).map(([k, v]) => [k, realOrSelf(v)])),
    };
    if (isMac) return lib.sandboxed(real(binPath), args, ctx);
    let devices = [];
    try { devices = fs.readdirSync('/dev').filter((d) => /^sr\d+$/.test(d)).map((d) => `/dev/${d}`); } catch {}
    const hostRoots = ['/lib', '/lib64', '/lib32', '/bin', '/sbin'].filter(exists).map((p) => {
      try { return fs.lstatSync(p).isSymbolicLink() ? { path: p, link: fs.readlinkSync(p) } : { path: p }; } catch { return { path: p }; }
    });
    return [BWRAP, bwrapArgs(real(binPath), args, { ...ctx, devices, hostRoots })];
  }

  // ----- discs -----
  // A test hook limits detection to named volumes so tests ignore a real disc in the drive.
  const only = env.SPINARR_VOLUMES ? env.SPINARR_VOLUMES.split(',') : null;
  const allowed = (name) => !only || only.includes(name);

  async function listMac() {
    const out = [];
    let vols = [];
    try { vols = fs.readdirSync('/Volumes'); } catch {}
    for (const v of vols) {
      if (!allowed(v)) continue;
      const p = P.join('/Volumes', v);
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

  async function listLinux() {
    let devs = [];
    try { devs = parseLsblk(await run('lsblk', ['-J', '-o', 'NAME,PATH,TYPE,RM,LABEL,MOUNTPOINT'], { timeout: 10000 })); } catch {}
    if (!devs.length) { // no lsblk: fall back to the usual automount folders
      const user = os.userInfo().username;
      for (const base of [`/run/media/${user}`, `/media/${user}`, '/media']) {
        let names = [];
        try { names = fs.readdirSync(base); } catch {}
        for (const n of names) devs.push({ device: null, type: 'other', label: n, mount: P.join(base, n) });
      }
    }
    const out = [];
    const seen = new Set();
    for (const d of devs) {
      if (!d.mount || seen.has(d.mount)) continue;
      seen.add(d.mount);
      const name = d.label || P.basename(d.mount);
      if (!allowed(name)) continue;
      const media = lib.sourceKind(d.mount);
      if (!media) continue;
      out.push({ name, path: d.mount, kind: d.type === 'rom' ? 'optical' : d.type === 'loop' ? 'image' : 'other', media, device: d.device });
    }
    let hasDrive = devs.some((d) => d.type === 'rom');
    if (!hasDrive) { try { hasDrive = fs.readdirSync('/sys/block').some((d) => /^sr\d+$/.test(d)); } catch {} }
    return { discs: out, hasDrive };
  }

  async function listWin() {
    let disks = [];
    try {
      disks = parseWinDisks(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        // UTF-8 output, or labels with accents arrive in the console's legacy code page
        '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName | ConvertTo-Json -Compress'], { timeout: 15000 }));
    } catch {}
    const out = [];
    for (const d of disks) {
      const name = d.label || d.root.slice(0, 2);
      if (!allowed(name)) continue;
      const media = lib.sourceKind(d.root);
      if (media) out.push({ name, path: d.root, kind: d.optical ? 'optical' : 'other', media });
    }
    return { discs: out, hasDrive: disks.some((d) => d.optical) };
  }

  const listDrives = isMac ? listMac : isWin ? listWin : listLinux;

  // Calls onChange when discs may have come or gone. Returns a stop function.
  function watch(onChange) {
    let t;
    const debounced = () => { clearTimeout(t); t = setTimeout(onChange, 800); };
    if (isMac) {
      try { const w = fs.watch('/Volumes', debounced); return () => w.close(); } catch { return () => {}; }
    }
    // Linux: the mount table changes when a disc is (auto)mounted. Windows: drive roots
    // appear or gain a VIDEO_TS/BDMV folder. Both are cheap to poll.
    const signature = isWin
      ? () => 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((r) => lib.sourceKind(r)).join('|')
      : () => { try { return fs.readFileSync('/proc/self/mountinfo', 'utf8'); } catch { return ''; } };
    let last = signature();
    const timer = setInterval(() => { const s = signature(); if (s !== last) { last = s; onChange(); } }, isWin ? 3000 : 2000);
    return () => clearInterval(timer);
  }

  async function eject(drive) {
    if (isMac) {
      try { await run('diskutil', ['eject', drive.path], { timeout: 30000 }); }
      catch { await run('drutil', ['eject'], { timeout: 30000 }); }
    } else if (isWin) {
      if (!/^[A-Z]:\\$/.test(drive.path)) throw new Error('Not a drive');
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${drive.path.slice(0, 2)}').InvokeVerb('Eject')`], { timeout: 30000 });
    } else {
      const errors = [];
      for (const [cmd, args] of [['gio', ['mount', '-e', drive.path]], ['eject', [drive.device || drive.path]],
        ...(drive.device ? [['udisksctl', ['unmount', '-b', drive.device]]] : [])]) {
        try { await run(cmd, args, { timeout: 30000 }); return; } catch (e) { errors.push(e.message); }
      }
      throw new Error(`Could not eject: ${errors.pop()}`);
    }
  }

  // ----- libdvdcss -----
  function dvdcss() {
    if (isMac) {
      const installed = ['/opt/homebrew/lib/libdvdcss.2.dylib', '/usr/local/lib/libdvdcss.2.dylib'].some(exists);
      return { installed, command: DVDCSS_COMMANDS.darwin };
    }
    if (isWin) {
      return { installed: exists(P.join(userLib, 'libdvdcss-2.dll')), url: VIDEOLAN_WIN64, canPick: true };
    }
    const dirs = ['/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu', '/lib/x86_64-linux-gnu', '/lib/aarch64-linux-gnu',
      '/usr/lib64', '/usr/lib', '/usr/local/lib'];
    let family = 'other';
    try { family = distroFamily(fs.readFileSync('/etc/os-release', 'utf8')); } catch {}
    return { installed: dirs.some((d) => exists(P.join(d, 'libdvdcss.so.2'))), command: DVDCSS_COMMANDS[family] };
  }

  // ----- AACS (Blu-ray): the user's own libaacs and KEYDB.cfg; Spinarr ships neither -----
  const keydbPath = P.join(keyDirs.aacsConf, 'KEYDB.cfg');
  function aacs() {
    let installed;
    if (isMac) installed = ['/opt/homebrew/lib/libaacs.0.dylib', '/usr/local/lib/libaacs.0.dylib'].some(exists);
    else if (isWin) installed = exists(P.join(userLib, 'libaacs.dll'));
    else installed = ['/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu', '/usr/lib64', '/usr/lib', '/usr/local/lib']
      .some((d) => exists(P.join(d, 'libaacs.so.0')));
    let family = isMac ? 'darwin' : 'other';
    if (isLinux) { try { family = distroFamily(fs.readFileSync('/etc/os-release', 'utf8')); } catch {} }
    return {
      libaacs: installed, keydb: exists(keydbPath), keydbPath,
      command: isWin ? `Put libaacs.dll in ${userLib}` : AACS_COMMANDS[family],
    };
  }

  // Copy a user-chosen KEYDB.cfg to where libaacs reads it, after a format check.
  function installKeydb(file) {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 512 * 1024 * 1024) throw new Error('That file is not a KEYDB.cfg key file.');
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(Math.min(st.size, 1024 * 1024));
    try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
    if (!looksLikeKeydb(head)) throw new Error('That file is not a KEYDB.cfg key file.');
    fs.mkdirSync(keyDirs.aacsConf, { recursive: true });
    const tmp = `${keydbPath}.part`;
    fs.copyFileSync(file, tmp);
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, keydbPath);
  }

  // Windows: copy a user-chosen libdvdcss-2.dll into the engine's DLL folder after checking it.
  function installDvdcss(file) {
    if (!isWin) throw new Error('Only needed on Windows');
    const buf = fs.readFileSync(file);
    if (buf.length > 8 * 1024 * 1024 || !isPe64Dll(buf)) throw new Error('That is not a 64-bit libdvdcss DLL.');
    fs.mkdirSync(userLib, { recursive: true });
    fs.writeFileSync(P.join(userLib, 'libdvdcss-2.dll'), buf);
  }

  return {
    platform, isMac, isWin, isLinux, cssCache, keyDirs, engineEnv, sandboxKind,
    exe: (name) => (isWin ? `${name}.exe` : name),
    wrap, listDrives, watch, eject, dvdcss, installDvdcss, aacs, installKeydb,
    // what the UI needs to show setup status
    info: () => ({ platform, sandbox: sandboxKind, dvdcss: dvdcss(), aacs: aacs(), bwrapHelp: isLinux && !BWRAP ? 'sudo apt install bubblewrap   # or dnf / pacman' : null }),
  };
}

module.exports = { createPlatform, parseLsblk, parseWinDisks, distroFamily, bwrapArgs, isPe64Dll, looksLikeKeydb, DVDCSS_COMMANDS, VIDEOLAN_WIN64 };
