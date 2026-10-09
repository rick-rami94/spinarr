const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLsblk, parseWinDisks, distroFamily, bwrapArgs, isPe64Dll, createPlatform } = require('../../app/platform');

test('parseLsblk: flattens children and keeps mount, type and label', () => {
  const json = JSON.stringify({ blockdevices: [
    { name: 'sr0', path: '/dev/sr0', type: 'rom', rm: true, label: 'MY_MOVIE', mountpoint: '/media/me/MY_MOVIE' },
    { name: 'nvme0n1', path: '/dev/nvme0n1', type: 'disk', rm: false, label: null, mountpoint: null, children: [
      { name: 'nvme0n1p2', path: '/dev/nvme0n1p2', type: 'part', label: null, mountpoint: '/' },
    ] },
    { name: 'loop3', type: 'loop', label: 'IMG', mountpoints: [null, '/mnt/iso'] }, // util-linux >= 2.37 style
  ] });
  assert.deepEqual(parseLsblk(json), [
    { device: '/dev/sr0', type: 'rom', label: 'MY_MOVIE', mount: '/media/me/MY_MOVIE' },
    { device: '/dev/nvme0n1', type: 'disk', label: null, mount: null },
    { device: '/dev/nvme0n1p2', type: 'part', label: null, mount: '/' },
    { device: '/dev/loop3', type: 'loop', label: 'IMG', mount: '/mnt/iso' },
  ]);
  assert.deepEqual(parseLsblk('not json'), []);
  assert.deepEqual(parseLsblk('{}'), []);
});

test('parseWinDisks: one object or an array; optical is DriveType 5', () => {
  assert.deepEqual(parseWinDisks('{"DeviceID":"D:","DriveType":5,"VolumeName":"MOVIE"}'), [{ root: 'D:\\', optical: true, label: 'MOVIE' }]);
  assert.deepEqual(parseWinDisks('[{"DeviceID":"C:","DriveType":3,"VolumeName":""},{"DeviceID":"e:","DriveType":5,"VolumeName":null},{"DeviceID":"\\\\\\\\x","DriveType":4}]'),
    [{ root: 'C:\\', optical: false, label: null }, { root: 'E:\\', optical: true, label: null }]);
  assert.deepEqual(parseWinDisks(''), []);
});

test('distroFamily picks the right package manager', () => {
  assert.equal(distroFamily('ID=ubuntu\nID_LIKE=debian\n'), 'debian');
  assert.equal(distroFamily('ID="linuxmint"\nID_LIKE="ubuntu debian"'), 'debian');
  assert.equal(distroFamily('ID=fedora'), 'fedora');
  assert.equal(distroFamily('ID=endeavouros\nID_LIKE=arch'), 'arch');
  assert.equal(distroFamily('ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"'), 'suse');
  assert.equal(distroFamily('ID=nixos'), 'other');
});

test('bwrapArgs: no network, read-only system and source, writes only to output and caches', () => {
  const a = bwrapArgs('/app/engine/ffmpeg', ['-i', '/media/me/DISC'], {
    engineDir: '/app/engine', source: '/media/me/DISC', outDir: '/home/me/Videos', cssCache: '/home/me/.cache/dvdcss',
    devices: ['/dev/sr0'], hostRoots: [{ path: '/lib', link: 'usr/lib' }, { path: '/lib64' }],
  });
  const s = a.join(' ');
  assert.ok(s.startsWith('--die-with-parent --unshare-all --cap-drop ALL --ro-bind /usr /usr'));
  assert.match(s, /--symlink usr\/lib \/lib /);
  assert.match(s, /--ro-bind-try \/lib64 \/lib64/);
  assert.match(s, /--dev-bind-try \/dev\/sr0 \/dev\/sr0/);
  assert.match(s, /--ro-bind \/media\/me\/DISC \/media\/me\/DISC/);
  assert.match(s, /--bind \/home\/me\/Videos \/home\/me\/Videos/);
  assert.doesNotMatch(s, /--bind \/home\/me /, 'home is never writable');
  assert.doesNotMatch(s, /--share-net/);
  assert.deepEqual(a.slice(-4), ['/', '/app/engine/ffmpeg', '-i', '/media/me/DISC']);
  assert.throws(() => bwrapArgs('ffmpeg', [], { engineDir: '/e', source: '/s', outDir: '/o', cssCache: '/c' }), /Invalid sandbox path/);
  assert.throws(() => bwrapArgs('/e/ffmpeg', [], { engineDir: '/e', source: '/s\n--bind / /', outDir: '/o', cssCache: '/c' }), /Invalid sandbox path/);
});

test('isPe64Dll accepts only 64-bit DLLs', () => {
  const pe = (machine, flags) => {
    const b = Buffer.alloc(0x200);
    b.writeUInt16LE(0x5a4d, 0); b.writeUInt32LE(0x80, 0x3c);
    b.writeUInt32LE(0x00004550, 0x80); b.writeUInt16LE(machine, 0x84); b.writeUInt16LE(flags, 0x96);
    return b;
  };
  assert.equal(isPe64Dll(pe(0x8664, 0x2022)), true);
  assert.equal(isPe64Dll(pe(0xaa64, 0x2022)), true);
  assert.equal(isPe64Dll(pe(0x14c, 0x2102)), false, '32-bit');
  assert.equal(isPe64Dll(pe(0x8664, 0x0022)), false, 'an .exe, not a DLL');
  assert.equal(isPe64Dll(Buffer.from('#!/bin/sh\necho hi\n'.padEnd(300))), false);
  assert.equal(isPe64Dll('MZ'), false);
});

test('createPlatform: per-OS folders, engine environment and executable names', () => {
  const run = async () => '';
  const mac = createPlatform({ run, platform: 'darwin', home: '/Users/me', env: {} });
  assert.equal(mac.cssCache, '/Users/me/Library/Caches/dvdcss');
  assert.equal(mac.exe('ffmpeg'), 'ffmpeg');
  assert.equal(mac.sandboxKind, 'macos');
  assert.equal(mac.engineEnv.PATH, '/usr/bin:/bin');

  const linux = createPlatform({ run, platform: 'linux', home: '/home/me', env: { XDG_CACHE_HOME: '/home/me/.c' } });
  assert.equal(linux.cssCache, '/home/me/.c/dvdcss');
  assert.equal(linux.keyDirs.aacsConf, '/home/me/.config/aacs');
  assert.equal(linux.engineEnv.XDG_CACHE_HOME, '/home/me/.c');
  assert.ok(!('LD_LIBRARY_PATH' in linux.engineEnv));

  const win = createPlatform({ run, platform: 'win32', home: 'C:\\Users\\me', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', SystemRoot: 'C:\\Windows' }, dataDir: 'C:\\Users\\me\\AppData\\Roaming\\Spinarr' });
  assert.equal(win.exe('ffmpeg'), 'ffmpeg.exe');
  assert.equal(win.sandboxKind, 'none');
  assert.match(win.engineEnv.PATH, /^C:\\Users\\me\\AppData\\Roaming\\Spinarr[\\/]lib;/, 'libdvdcss folder is searched first');
  assert.equal(win.info().dvdcss.canPick, true);
  assert.deepEqual(win.wrap('C:\\e\\ffmpeg.exe', ['-v'], {}), ['C:\\e\\ffmpeg.exe', ['-v']]);
});

test('looksLikeKeydb accepts the KEYDB.cfg format and rejects anything else', () => {
  const { looksLikeKeydb } = require('../../app/platform');
  // Synthetic entries in the KEYDB.cfg layout: made-up values, not real keys.
  const disc = `; comment\n0x${'ab'.repeat(20)} = SAMPLE DISC | D | 2020-01-01 | V | 0x${'00'.repeat(16)}\n`;
  const section = '| DK | DEVICE_KEY 0x00000000000000000000000000000000 | DEVICE_NODE 0x0\n';
  assert.equal(looksLikeKeydb(Buffer.from(disc)), true);
  assert.equal(looksLikeKeydb(Buffer.from(section)), true);
  assert.equal(looksLikeKeydb(Buffer.from('just some notes\nnothing to see\n')), false);
  assert.equal(looksLikeKeydb(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0])), false, 'a zip, not the file inside it');
  assert.equal(looksLikeKeydb(Buffer.from(disc + '\0')), false, 'binary');
});

test('installKeydb copies the user\'s own key file to where libaacs reads it, privately', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-home-'));
  try {
    const src = path.join(home, 'Downloads-keydb.cfg');
    fs.writeFileSync(src, `0x${'cd'.repeat(20)} = SAMPLE | D | 2020-01-01 | V | 0x${'11'.repeat(16)}\n`);
    const linux = createPlatform({ run: async () => '', platform: process.platform === 'win32' ? 'win32' : 'linux', home, env: { APPDATA: path.join(home, 'AppData') }, dataDir: path.join(home, 'AppData', 'Spinarr') });
    assert.equal(linux.aacs().keydb, false);
    linux.installKeydb(src);
    const a = linux.aacs();
    assert.equal(a.keydb, true);
    assert.equal(fs.readFileSync(a.keydbPath, 'utf8'), fs.readFileSync(src, 'utf8'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(a.keydbPath).mode & 0o777, 0o600);
    const bogus = path.join(home, 'notes.txt');
    fs.writeFileSync(bogus, 'hello');
    assert.throws(() => linux.installKeydb(bogus), /not a KEYDB\.cfg/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
