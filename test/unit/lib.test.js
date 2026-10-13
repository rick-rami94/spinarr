const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../../app/lib');

test('prettyName turns volume labels into titles', () => {
  assert.equal(lib.prettyName('THE_MATRIX'), 'The Matrix');
  assert.equal(lib.prettyName('THE_TEST_MOVIE_DISC_1'), 'The Test Movie Disc 1');
  assert.equal(lib.prettyName('LOTR_FOTR_D2'), 'Lotr Fotr Disc 2');
  assert.equal(lib.prettyName('ALIEN_WS'), 'Alien');
  assert.equal(lib.prettyName('PAL_SUBS_WS'), 'Pal Subs');
  assert.equal(lib.prettyName('AMÉLIE'), 'Amélie');
  assert.equal(lib.prettyName(''), 'Untitled Disc');
  assert.equal(lib.prettyName('   '), 'Untitled Disc');
  assert.equal(lib.prettyName(null), 'Untitled Disc');
  assert.equal(lib.prettyName(42), 'Untitled Disc');
});

test('safeFile produces a single safe path component', () => {
  assert.equal(lib.safeFile('Movie: The "Sequel"?'), 'Movie- The -Sequel-');
  assert.equal(lib.safeFile('../../etc/passwd'), 'etc-passwd');
  // Windows rules, applied everywhere so files can move between systems
  assert.equal(lib.safeFile('CON'), 'CON_');
  assert.equal(lib.safeFile('lpt1.mkv'), 'lpt1.mkv_');
  assert.equal(lib.safeFile('Console'), 'Console');
  assert.equal(lib.safeFile('Movie. . '), 'Movie');
  assert.equal(lib.safeFile('..'), 'Untitled');
  assert.equal(lib.safeFile('.hidden'), 'hidden');
  assert.equal(lib.safeFile('-rf'), 'rf');
  assert.equal(lib.safeFile('a\\b/c'), 'a-b-c');
  assert.equal(lib.safeFile('tab\there\nnew\u0000line'), 'tabherenewline');
  assert.equal(lib.safeFile(''), 'Untitled');
  assert.equal(lib.safeFile(undefined), 'Untitled');
  assert.equal(lib.safeFile('Amélie – 日本語'), 'Amélie – 日本語');
  assert.ok(lib.safeFile('x'.repeat(1000)).length <= 180);
  for (const evil of ['/', '\\', '..', '../x', 'a/../../b', '\0']) {
    const out = lib.safeFile(evil);
    assert.ok(!out.includes('/') && !out.includes('\\') && !out.startsWith('.'), `${evil} -> ${out}`);
  }
});

test('uniquePath never returns an existing file or an in-progress .part', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-'));
  const p = path.join(dir, 'Movie.mkv');
  assert.equal(lib.uniquePath(p), p);
  fs.writeFileSync(p, '');
  assert.equal(lib.uniquePath(p), path.join(dir, 'Movie (2).mkv'));
  fs.writeFileSync(path.join(dir, 'Movie (2).mkv.part'), '');
  assert.equal(lib.uniquePath(p), path.join(dir, 'Movie (3).mkv'));
  fs.rmSync(dir, { recursive: true });
});

const title = (n, duration, chapters, bytes, extra = {}) => ({
  title: n, duration, chapters: Array(chapters).fill(duration / chapters), bytes, audio: [], subtitles: [], ...extra,
});

test('analyzeTitles picks the longest unique title as the main feature and flags duplicates', () => {
  const r = lib.analyzeTitles({
    volume: 'MOVIE',
    titles: [title(1, 5, 1, 1e6), title(2, 7200, 24, 6e9), title(3, 7200, 24, 6e9), title(4, 120, 1, 1e8), title(5, 7201, 24, 6.1e9)],
  }, '/x/MOVIE.iso');
  assert.equal(r.name, 'Movie');
  assert.equal(r.titles.find((t) => t.main).title, 5);
  assert.equal(r.titles[2].duplicateOf, 2);
  assert.equal(r.titles.filter((t) => t.main).length, 1);
});

test('analyzeTitles falls back to file name when the disc has no label', () => {
  assert.equal(lib.analyzeTitles({ volume: '', titles: [] }, '/x/MY_MOVIE.iso').label, 'MY_MOVIE');
  assert.equal(lib.analyzeTitles({ volume: '', titles: [] }, '/x/MY_MOVIE').label, 'MY_MOVIE');
  assert.throws(() => lib.analyzeTitles({}, '/x'));
});

test('analyzeTitles does not crown zero-length titles', () => {
  const r = lib.analyzeTitles({ volume: 'X', titles: [title(1, 0, 1, 0), title(2, 0, 1, 0)] }, '/x');
  assert.equal(r.titles.some((t) => t.main), false);
  assert.equal(r.titles.some((t) => t.duplicateOf), false);
});

test('ripArgs maps chosen streams and stream-copies everything', () => {
  const a = lib.ripArgs({ source: '/d.iso', title: 3, streams: [0, 2, 5], displayName: 'X', accurateChapters: true }, '/o/x.mkv.part');
  assert.deepEqual(a.slice(a.indexOf('-title'), a.indexOf('-title') + 2), ['-title', '3']);
  assert.ok(a.includes('-preindex'));
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '-map'), ['0:0', '0:2', '0:5']);
  assert.deepEqual(a.slice(a.indexOf('-c'), a.indexOf('-c') + 2), ['-c', 'copy']);
  assert.equal(a.at(-1), '/o/x.mkv.part');
  assert.equal(a[a.indexOf('-i') + 1], '/d.iso');
  const b = lib.ripArgs({ source: '/d.iso', title: 1, streams: null, displayName: 'X', accurateChapters: false }, '/o.part');
  assert.ok(!b.includes('-preindex'));
  assert.deepEqual(b.filter((x, i) => b[i - 1] === '-map'), ['0:v:0', '0:a?', '0:s?']);
});

test('progressParser handles chunked key=value output', () => {
  const seen = [];
  const feed = lib.progressParser(100, (s) => seen.push({ ...s }));
  feed('out_time_us=25000');
  feed('000\nspeed=12.5x\ntotal_');
  feed('size=1000\nprogress=continue\n');
  const last = seen.at(-1);
  assert.equal(last.progress, 0.25);
  assert.equal(last.speed, 12.5);
  assert.equal(last.bytes, 1000);
  feed('out_time_us=999000000\n');
  assert.equal(seen.at(-1).progress, 0.999, 'never reports 100% before the process exits');
  feed('speed=N/A\nout_time_us=N/A\n');
  assert.equal(seen.at(-1).speed, 12.5);
});

test('progressParser tolerates zero duration', () => {
  const feed = lib.progressParser(0, () => {});
  assert.equal(feed('out_time_us=5000000\n').progress, 0);
});

test('validateSource accepts only absolute DVD images or folders containing VIDEO_TS', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-'));
  fs.mkdirSync(path.join(dir, 'disc', 'VIDEO_TS'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.iso'), '');
  fs.writeFileSync(path.join(dir, 'a.txt'), '');
  fs.mkdirSync(path.join(dir, 'plain'));
  assert.equal(lib.validateSource(path.join(dir, 'disc')), path.join(dir, 'disc'));
  assert.equal(lib.validateSource(path.join(dir, 'a.iso')), path.join(dir, 'a.iso'));
  for (const bad of ['relative.iso', '', null, 42, {}, '-i', path.join(dir, 'a.txt'), path.join(dir, 'plain'),
    path.join(dir, 'missing.iso'), '/etc/passwd', `${dir}/a.iso\0x`, 'x'.repeat(5000)]) {
    assert.throws(() => lib.validateSource(bad), undefined, String(bad).slice(0, 40));
  }
  fs.rmSync(dir, { recursive: true });
});

test('validateTitle', () => {
  assert.equal(lib.validateTitle(1), 1);
  assert.equal(lib.validateTitle(999), 999);
  for (const bad of [0, 1000, -1, 1.5, '1', NaN, null, '1; rm -rf /']) assert.throws(() => lib.validateTitle(bad));
});

test('validateScanOptions', () => {
  assert.deepEqual(lib.validateScanOptions(undefined), { userConfirmed: false });
  assert.deepEqual(lib.validateScanOptions(null), { userConfirmed: false });
  assert.deepEqual(lib.validateScanOptions({ userConfirmed: true }), { userConfirmed: true });
  assert.deepEqual(lib.validateScanOptions({ userConfirmed: true, extra: 1 }), { userConfirmed: true });
  for (const loose of [{ userConfirmed: 'true' }, { userConfirmed: 1 }, { userConfirmed: {} }, {}]) {
    assert.deepEqual(lib.validateScanOptions(loose), { userConfirmed: false });
  }
  for (const bad of ['x', 1, true, []]) assert.throws(() => lib.validateScanOptions(bad), /Invalid scan options/);
});

test('scanGate', () => {
  assert.equal(lib.SANDBOX_OFF, 'SANDBOX_OFF');
  assert.equal(lib.scanGate({ trusted: true, userConfirmed: false }), null);
  assert.equal(lib.scanGate({ trusted: false, userConfirmed: true }), null);
  for (const closed of [{ trusted: false, userConfirmed: false }, { trusted: 'yes', userConfirmed: 1 }, {}, undefined]) {
    const r = lib.scanGate(closed);
    assert.equal(typeof r, 'string');
    assert.ok(r.startsWith(`${lib.SANDBOX_OFF}:`));
    assert.match(r, /sandbox is off/);
    assert.match(r, /Scan anyway/);
  }
});

test('validateJob sanitizes names and rejects malformed input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-'));
  fs.writeFileSync(path.join(dir, 'd.iso'), '');
  const src = path.join(dir, 'd.iso');
  const j = lib.validateJob({ source: src, title: 2, streams: [3, 0, 3], fileName: '../../x', displayName: 'A\nB', duration: 10, accurateChapters: 'yes', outputDir: '/etc' });
  assert.deepEqual(j.streams, [0, 3]);
  assert.equal(j.fileName, 'x');
  assert.equal(j.displayName, 'AB');
  assert.equal(j.accurateChapters, false);
  assert.equal('outputDir' in j, false, 'renderer cannot choose the output directory');
  assert.equal(lib.validateJob({ source: src, title: 1, duration: -5 }).duration, 1);
  for (const bad of [
    null, 'x', { source: src, title: 0 }, { source: 'rel', title: 1 },
    { source: src, title: 1, streams: ['0;x'] }, { source: src, title: 1, streams: [999] },
    { source: src, title: 1, streams: 'all' }, { source: src, title: 1, streams: Array(300).fill(0) },
  ]) assert.throws(() => lib.validateJob(bad));
  fs.rmSync(dir, { recursive: true });
});

test('every skin has styles and a picker option, and nothing else does', () => {
  const root = path.join(__dirname, '..', '..', 'app', 'renderer');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const picker = [...html.matchAll(/name="skin" value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(picker, lib.SKINS);
  for (const skin of lib.SKINS.filter((k) => k !== 'studio')) assert.match(css, new RegExp(`:root\\[data-skin="${skin}"\\] \\{`));
  const styled = new Set([...css.matchAll(/data-skin="([a-z]+)"/g)].map((m) => m[1]));
  for (const skin of styled) assert.ok(lib.SKINS.includes(skin), `${skin} is styled but not selectable`);
});

test('sanitizeSettingsPatch only lets known, typed keys through', () => {
  assert.deepEqual(lib.sanitizeSettingsPatch({ minMinutes: 5, accurateChapters: false }), { minMinutes: 5, accurateChapters: false });
  assert.deepEqual(lib.sanitizeSettingsPatch({ outputDir: '/etc', __proto__: { x: 1 }, evil: 1 }), {});
  assert.deepEqual(lib.sanitizeSettingsPatch({ skin: 'pinstripe' }), { skin: 'pinstripe' });
  assert.deepEqual(lib.sanitizeSettingsPatch({ skin: '../../evil' }), {});
  for (const skin of lib.SKINS) assert.deepEqual(lib.sanitizeSettingsPatch({ skin }), { skin });
  assert.deepEqual(lib.sanitizeSettingsPatch({ skin: 'Neon' }), {});
  assert.deepEqual(lib.sanitizeSettingsPatch({ minMinutes: 9999 }), { minMinutes: 60 });
  assert.deepEqual(lib.sanitizeSettingsPatch({ minMinutes: -3 }), { minMinutes: 0 });
  assert.deepEqual(lib.sanitizeSettingsPatch({ minMinutes: '5', accurateChapters: 1 }), {});
  assert.deepEqual(lib.sanitizeSettingsPatch(null), {});
});


test('ripArgs always asks ffmpeg to exit on read errors', () => {
  assert.ok(lib.ripArgs({ source: '/d.iso', title: 1, displayName: '' }, '/o').includes('-xerror'));
});

test('validateSource accepts the VIDEO_TS folder itself and normalises to the disc root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-'));
  fs.mkdirSync(path.join(dir, 'disc', 'VIDEO_TS'), { recursive: true });
  assert.equal(lib.validateSource(path.join(dir, 'disc', 'VIDEO_TS')), path.join(dir, 'disc'));
  assert.equal(lib.validateSource(path.join(dir, 'disc', 'VIDEO_TS') + '/'), path.join(dir, 'disc'));
  assert.equal(lib.validateSource(path.join(dir, 'disc', 'x', '..')), path.join(dir, 'disc'));
  fs.rmSync(dir, { recursive: true });
});


test('sandboxed() passes paths as parameters, never inside the profile text', () => {
  const evil = '/Users/x/a") (allow file-write* (subpath "/';
  const [cmd, args] = lib.sandboxed('/e/bin/ffmpeg', ['-i', evil], { engineDir: '/e/bin', source: evil, outDir: '/o', cssCache: '/c' });
  assert.equal(cmd, '/usr/bin/sandbox-exec');
  const profile = args[args.indexOf('-p') + 1];
  assert.equal(profile, lib.SANDBOX_PROFILE, 'profile is a constant');
  assert.ok(args.includes(`SOURCE=${evil}`));
  assert.deepEqual(args.slice(args.indexOf('-p') + 2), ['/e/bin/ffmpeg', '-i', evil]);
  assert.throws(() => lib.sandboxed('/e/bin/ffmpeg', [], { engineDir: 'relative', source: '/s', outDir: '/o', cssCache: '/c' }));
  assert.throws(() => lib.sandboxed('/e/bin/ffmpeg', [], { engineDir: '/e', source: '/s\n', outDir: '/o', cssCache: '/c' }));
});

test('sandbox profile denies network, fork/exec and writes outside the output folder', () => {
  const p = lib.SANDBOX_PROFILE;
  assert.match(p, /\(deny network\*\)/);
  assert.match(p, /\(deny process-fork\)/);
  assert.match(p, /\(deny process-exec\*\)/);
  assert.match(p, /\(deny file-write\* \(subpath "\/"\)\)/);
  assert.doesNotMatch(p, /\(allow file-write\* \(subpath "\//, 'no hard-coded writable paths');
});

test('volumeKind distinguishes optical discs from disk images', () => {
  assert.equal(lib.volumeKind('<key>OpticalMediaType</key><string>DVD-ROM</string>'), 'optical');
  assert.equal(lib.volumeKind('<key>BusProtocol</key>\n\t<string>Disk Image</string>'), 'image');
  assert.equal(lib.volumeKind('<key>BusProtocol</key><string>USB</string>'), 'other');
  assert.equal(lib.volumeKind(undefined), 'other');
});

test('analyzeTitles never crowns an implausibly long (corrupt) title', () => {
  const r = lib.analyzeTitles({ volume: 'X', titles: [title(1, 779216, 3, 1e9), title(2, 5400, 20, 5e9)] }, '/x');
  assert.equal(r.titles.find((t) => t.main).title, 2);
});

test('progressParser falls back to video frames when out_time is N/A (empty declared stream)', () => {
  const feed = lib.progressParser(20, () => {}, 29.97);
  const st = feed('frame=300\nout_time_us=N/A\nprogress=continue\nframe=600\nout_time_us=N/A\nprogress=end\n');
  assert.ok(st.progress > 0.99, `progress ${st.progress}`);
  const pal = lib.progressParser(10, () => {}, 25);
  assert.equal(pal('frame=125\n').progress, 0.5);
});

test('validateJob only accepts PAL or NTSC frame rates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-'));
  fs.writeFileSync(path.join(dir, 'd.iso'), '');
  const src = path.join(dir, 'd.iso');
  assert.equal(lib.validateJob({ source: src, title: 1, fps: 25 }).fps, 25);
  assert.equal(lib.validateJob({ source: src, title: 1, fps: 1e9 }).fps, 29.97);
  fs.rmSync(dir, { recursive: true });
});

test('prettyName keeps edition abbreviations and Roman numerals uppercase', () => {
  assert.equal(lib.prettyName('SPACE_JAM_SE_DISC_1'), 'Space Jam SE Disc 1');
  assert.equal(lib.prettyName('ROCKY_III'), 'Rocky III');
  assert.equal(lib.prettyName('ALIENS_DC'), 'Aliens DC');
  assert.equal(lib.prettyName('SEVEN'), 'Seven', 'only whole words');
});


test('sourceKind and validateSource recognise Blu-ray folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-'));
  fs.mkdirSync(path.join(dir, 'bd', 'BDMV'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dvd', 'VIDEO_TS'), { recursive: true });
  assert.equal(lib.sourceKind(path.join(dir, 'bd')), 'bluray');
  assert.equal(lib.sourceKind(path.join(dir, 'dvd')), 'dvd');
  assert.equal(lib.sourceKind(dir), null);
  assert.equal(lib.validateSource(path.join(dir, 'bd', 'BDMV')), path.join(dir, 'bd'));
  assert.throws(() => lib.validateSource(dir), /VIDEO_TS or BDMV/);
  fs.rmSync(dir, { recursive: true });
});

test('chaptersMetadata builds contiguous ffmetadata chapters', () => {
  const m = lib.chaptersMetadata([20, 20.5, -3, 'x']);
  assert.match(m, /^;FFMETADATA1\n/);
  assert.deepEqual([...m.matchAll(/START=(\d+)\nEND=(\d+)/g)].map((x) => [+x[1], +x[2]]), [[0, 20000], [20000, 40500], [40500, 40500], [40500, 40500]]);
  assert.equal(lib.chaptersMetadata([]), ';FFMETADATA1\n');
});

test('blurayRipArgs: copies streams, FLAC only for Blu-ray LPCM, sane language tags only', () => {
  const a = lib.blurayRipArgs({ source: '/d', playlist: 7, displayName: 'T' },
    [{ index: 0, codec: 'h264' }, { index: 2, codec: 'pcm_bluray', lang: 'eng' }, { index: 5, codec: 'truehd', lang: 'en"; rm' }],
    '/o/c.txt', '/o/x.part');
  assert.deepEqual(a.slice(a.indexOf('-playlist'), a.indexOf('-playlist') + 4), ['-playlist', '7', '-i', 'bluray:/d']);
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '-map'), ['0:0', '0:2', '0:5']);
  assert.ok(a.includes('-xerror'));
  assert.deepEqual(a.slice(a.indexOf('-c:1'), a.indexOf('-c:1') + 2), ['-c:1', 'flac']);
  assert.ok(!a.includes('-c:2'), 'TrueHD is copied, not converted');
  assert.ok(a.includes('language=eng') && !a.some((x) => x.includes('rm')));
  assert.equal(a.at(-1), '/o/x.part');
});

test('sandboxed() passes the libaacs/libbdplus key folders as parameters', () => {
  const [, args] = lib.sandboxed('/e/b', [], { engineDir: '/e', source: '/s', outDir: '/o', cssCache: '/c', keyDirs: { aacsConf: '/k' } });
  assert.ok(args.includes('AACS_CONF=/k') && args.includes('AACS_CACHE=/c'));
  const writable = lib.SANDBOX_PROFILE.slice(lib.SANDBOX_PROFILE.indexOf('(allow file-write*'));
  assert.ok(writable.includes('(param "AACS_CACHE")') && writable.includes('(param "BDPLUS_CACHE")'));
  assert.ok(!writable.includes('AACS_CONF') && !writable.includes('BDPLUS_CONF'), 'key files are read-only');
});

test('ripVerdict judges completeness from the finished file, not progress counters', () => {
  assert.deepEqual(lib.ripVerdict({ code: 0, videoSeconds: 89.9, duration: 90 }), { ok: true });
  assert.match(lib.ripVerdict({ code: 0, videoSeconds: 72, duration: 90 }).error, /stopped early \(80%/);
  assert.match(lib.ripVerdict({ code: 0, videoSeconds: null, duration: 90 }).error, /verify/);
  // read errors and engine failures still win, whatever the file looks like
  assert.match(lib.ripVerdict({ code: 0, stderr: 'dvdnav error: Error reading from DVD.', videoSeconds: 90, duration: 90 }).error, /scratched/);
  assert.match(lib.ripVerdict({ code: 187, stderr: 'Unable to read next block of PGC' }).error, /scratched/);
  assert.match(lib.ripVerdict({ code: 1, stderr: 'libdvdcss: could not get CSS key' }).error, /decrypt/);
  assert.match(lib.ripVerdict({ code: 255, stderr: '' }).error, /code 255/);
  assert.match(lib.ripVerdict({ code: null, signal: 'SIGABRT' }).error, /stopped safely/);
});

test('outputVideoSeconds reads the MKV video track duration tag', () => {
  assert.equal(lib.outputVideoSeconds({ streams: [{ codec_type: 'audio', tags: { DURATION: '00:00:05.000000000' } }, { codec_type: 'video', tags: { DURATION: '01:27:18.383000000' } }] }), 5238.383);
  assert.equal(lib.outputVideoSeconds({ streams: [{ codec_type: 'video', tags: {} }] }), null);
  assert.equal(lib.outputVideoSeconds({ streams: [{ codec_type: 'video', tags: { DURATION: 'evil' } }] }), null);
  assert.equal(lib.outputVideoSeconds(null), null);
});

test('blurayBlocker explains what is actually missing', () => {
  const k = '/home/me/.config/aacs/KEYDB.cfg';
  const aacs = (aacsError, extra = {}) => ({ aacs: true, libaacs: true, aacsHandled: false, aacsError, ...extra });
  assert.equal(lib.blurayBlocker(null, k), null);
  assert.equal(lib.blurayBlocker({ aacs: true, aacsHandled: true }, k), null);
  assert.match(lib.blurayBlocker(aacs(0, { libaacs: false }), k, 'sudo apt install libaacs0'), /Install libaacs \(sudo apt install libaacs0\)/);
  assert.match(lib.blurayBlocker(aacs(-2), k), /found no KEYDB\.cfg.*\/home\/me\/\.config\/aacs\/KEYDB\.cfg/);
  assert.match(lib.blurayBlocker(aacs(-3), k), /has no key that opens it/);
  assert.match(lib.blurayBlocker(aacs(-8), k), /has no key that opens it/);
  assert.match(lib.blurayBlocker(aacs(-5), k), /revokes/);
  assert.match(lib.blurayBlocker(aacs(-6), k), /refused the AACS handshake/);
  assert.match(lib.blurayBlocker({ bdplus: true, bdplusHandled: false }, k), /BD\+/);
});

// ---------- mediumIdentity (SAFE-01 / CR-01 consent binding) ----------
const idTmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `spinarr-id-${tag}-`));
const FIXED = new Date('2020-01-01T00:00:00Z');

test('mediumIdentity: an unchanged ISO keeps the same file: identity string', () => {
  const dir = idTmp('iso');
  try {
    const iso = path.join(dir, 'disc.iso');
    fs.writeFileSync(iso, 'AAAA');
    const a = lib.mediumIdentity(iso);
    assert.equal(typeof a, 'string');
    assert.ok(a.startsWith('file:'));
    assert.equal(lib.mediumIdentity(iso), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mediumIdentity: an ISO overwritten in place with different bytes changes identity', () => {
  const dir = idTmp('isow');
  try {
    const iso = path.join(dir, 'disc.iso');
    fs.writeFileSync(iso, 'AAAA');
    const a = lib.mediumIdentity(iso);
    fs.writeFileSync(iso, 'BBBBBBBB');
    assert.notEqual(lib.mediumIdentity(iso), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mediumIdentity: an ISO replaced by rename (same size, same mtime) changes identity', () => {
  const dir = idTmp('isor');
  try {
    const iso = path.join(dir, 'disc.iso');
    const tmp = path.join(dir, 'new.tmp');
    fs.writeFileSync(iso, 'AAAA');
    fs.utimesSync(iso, FIXED, FIXED);
    const a = lib.mediumIdentity(iso);
    fs.writeFileSync(tmp, 'BBBB');
    fs.utimesSync(tmp, FIXED, FIXED);
    fs.renameSync(tmp, iso);
    assert.notEqual(lib.mediumIdentity(iso), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function makeDvd(root) {
  fs.mkdirSync(path.join(root, 'VIDEO_TS'), { recursive: true });
  fs.writeFileSync(path.join(root, 'VIDEO_TS', 'VIDEO_TS.IFO'), 'IFO');
  fs.writeFileSync(path.join(root, 'VIDEO_TS', 'VTS_01_1.VOB'), 'VOBDATA');
  for (const f of ['VIDEO_TS.IFO', 'VTS_01_1.VOB']) fs.utimesSync(path.join(root, 'VIDEO_TS', f), FIXED, FIXED);
}

test('mediumIdentity: a DVD folder is stable and changes when a file grows or the tree is recreated', () => {
  const dir = idTmp('dvd');
  try {
    const root = path.join(dir, 'MOVIE');
    makeDvd(root);
    const a = lib.mediumIdentity(root);
    assert.ok(a.startsWith('dvd:'));
    assert.equal(lib.mediumIdentity(root), a);
    fs.appendFileSync(path.join(root, 'VIDEO_TS', 'VTS_01_1.VOB'), 'X');
    const b = lib.mediumIdentity(root);
    assert.notEqual(b, a);
    fs.rmSync(root, { recursive: true, force: true });
    makeDvd(root);
    fs.appendFileSync(path.join(root, 'VIDEO_TS', 'VTS_01_1.VOB'), 'X');
    fs.utimesSync(path.join(root, 'VIDEO_TS', 'VTS_01_1.VOB'), FIXED, FIXED);
    assert.notEqual(lib.mediumIdentity(root), b);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mediumIdentity: a Blu-ray folder is stable, tolerates a missing CLIPINF, and changes with a playlist', () => {
  const dir = idTmp('bd');
  try {
    const root = path.join(dir, 'BD');
    fs.mkdirSync(path.join(root, 'BDMV', 'PLAYLIST'), { recursive: true });
    fs.mkdirSync(path.join(root, 'BDMV', 'STREAM'), { recursive: true });
    fs.writeFileSync(path.join(root, 'BDMV', 'index.bdmv'), 'INDX');
    fs.writeFileSync(path.join(root, 'BDMV', 'PLAYLIST', '00000.mpls'), 'MPLS');
    fs.writeFileSync(path.join(root, 'BDMV', 'STREAM', '00000.m2ts'), 'M2TS');
    const a = lib.mediumIdentity(root);
    assert.ok(a.startsWith('bluray:'));
    assert.equal(lib.mediumIdentity(root), a);
    fs.writeFileSync(path.join(root, 'BDMV', 'PLAYLIST', '00000.mpls'), 'MPLS-LONGER');
    assert.notEqual(lib.mediumIdentity(root), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mediumIdentity: a different device at the same path (drive-letter reuse) changes identity', () => {
  const dir = idTmp('dev');
  try {
    const root = path.join(dir, 'MOVIE');
    makeDvd(root);
    const a = lib.mediumIdentity(root);
    const stat = (p, o) => {
      const st = fs.statSync(p, o);
      if (p !== root || !o || !o.bigint) return st;
      return new Proxy(st, { get: (t, k) => (k === 'dev' ? t.dev + 12345n : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
    };
    assert.notEqual(lib.mediumIdentity(root, { stat }), a);
    // ISO file with a swapped device too
    const iso = path.join(dir, 'disc.iso');
    fs.writeFileSync(iso, 'AAAA');
    const isoStat = (p, o) => {
      const st = fs.statSync(p, o);
      return new Proxy(st, { get: (t, k) => (k === 'dev' ? t.dev + 1n : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
    };
    assert.notEqual(lib.mediumIdentity(iso, { stat: isoStat }), lib.mediumIdentity(iso));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mediumIdentity: a removed source or a folder that lost VIDEO_TS/BDMV throws', () => {
  const dir = idTmp('gone');
  try {
    const root = path.join(dir, 'MOVIE');
    makeDvd(root);
    lib.mediumIdentity(root);
    fs.rmSync(path.join(root, 'VIDEO_TS'), { recursive: true, force: true });
    assert.throws(() => lib.mediumIdentity(root), /Source changed/);
    fs.rmSync(root, { recursive: true, force: true });
    assert.throws(() => lib.mediumIdentity(root));
    assert.throws(() => lib.mediumIdentity(path.join(dir, 'missing.iso')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mediumIdentity: an entry that vanishes mid-walk is recorded, and more entries than the cap refuses instead of passing', () => {
  const dir = idTmp('cap');
  try {
    const root = path.join(dir, 'MOVIE');
    makeDvd(root);
    const vob = path.join(root, 'VIDEO_TS', 'VTS_01_1.VOB');
    const flaky = (p, o) => { if (p === vob) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return fs.statSync(p, o); };
    assert.notEqual(lib.mediumIdentity(root, { stat: flaky }), lib.mediumIdentity(root));
    // The cap fails closed: past it, the walk throws IDENTITY_TOO_MANY (identityOf -> null -> refusal)
    assert.equal(typeof lib.MAX_IDENTITY_ENTRIES, 'number');
    assert.ok(lib.MAX_IDENTITY_ENTRIES >= 20000);
    assert.equal(typeof lib.IDENTITY_TOO_MANY, 'string');
    assert.ok(lib.IDENTITY_TOO_MANY.length > 0);
    const names = Array.from({ length: lib.MAX_IDENTITY_ENTRIES + 1 }, (_, i) => `F${String(i).padStart(5, '0')}.VOB`);
    const readdir = (p) => (p.endsWith('VIDEO_TS') ? names : fs.readdirSync(p));
    const big = (p, o) => (p.startsWith(path.join(root, 'VIDEO_TS') + path.sep) ? fs.statSync(path.join(root, 'VIDEO_TS', 'VIDEO_TS.IFO'), o) : fs.statSync(p, o));
    assert.throws(() => lib.mediumIdentity(root, { stat: big, readdir }), (e) => e instanceof Error && e.message === lib.IDENTITY_TOO_MANY);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Each case gets a fresh DVD and checks one change against its own baseline.
function dvdChanges(tag, edit) {
  const dir = idTmp(tag);
  try {
    const root = path.join(dir, 'MOVIE');
    makeDvd(root);
    const a = lib.mediumIdentity(root);
    edit(root);
    return lib.mediumIdentity(root) !== a;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const put = (root, rel, data = 'NEW') => {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

test('mediumIdentity: a root-level IFO added to a DVD folder changes identity (libdvdread searches the root first)', () => {
  assert.ok(dvdChanges('dvdroot', (r) => put(r, 'VTS_01_0.IFO', 'IFO')));
  assert.ok(dvdChanges('dvdrootlc', (r) => put(r, 'vts_01_1.vob', 'VOB')));
});

test('mediumIdentity: files in video_ts, AUDIO_TS and DVD_RTAV change a DVD identity', () => {
  assert.ok(dvdChanges('dvdlc', (r) => put(r, 'video_ts/VTS_02_0.IFO', 'IFO')));
  assert.ok(dvdChanges('dvdats', (r) => put(r, 'AUDIO_TS/AUDIO_TS.IFO', 'IFO')));
  assert.ok(dvdChanges('dvdvr', (r) => put(r, 'DVD_RTAV/VR_MANGR.IFO', 'IFO')));
});

test('mediumIdentity: OS metadata files do not change a DVD identity', () => {
  const dir = idTmp('dvdjunk');
  try {
    const root = path.join(dir, 'MOVIE');
    makeDvd(root);
    const a = lib.mediumIdentity(root);
    put(root, '.DS_Store');
    put(root, 'VIDEO_TS/.DS_Store');
    put(root, 'VIDEO_TS/._VTS_01_1.VOB');
    put(root, 'Thumbs.db');
    put(root, 'desktop.ini');
    put(root, 'VIDEO_TS/Thumbs.db');
    put(root, 'VIDEO_TS/desktop.ini');
    put(root, 'ehthumbs.db');
    put(root, '.Spotlight-V100/Store-V2/x');
    assert.equal(lib.mediumIdentity(root), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const BD_FILES = [
  'BDMV/index.bdmv', 'BDMV/MovieObject.bdmv', 'BDMV/PLAYLIST/00000.mpls', 'BDMV/CLIPINF/00000.clpi',
  'BDMV/STREAM/00000.m2ts', 'BDMV/BACKUP/index.bdmv', 'BDMV/BACKUP/PLAYLIST/00000.mpls',
  'BDMV/BACKUP/CLIPINF/00000.clpi', 'AACS/Unit_Key_RO.inf', 'AACS/MKB_RO.inf', 'AACS/DUPLICATE/Unit_Key_RO.inf',
  'CERTIFICATE/id.bdmv', 'CERTIFICATE/BACKUP/id.bdmv',
];
function makeBluray(root) {
  for (const rel of BD_FILES) {
    put(root, rel, `ORIG:${rel}`);
    fs.utimesSync(path.join(root, ...rel.split('/')), FIXED, FIXED);
  }
}
// Fresh Blu-ray per case; the root inode must not move, so only the edited file can explain a change.
function blurayChanges(tag, edit) {
  const dir = idTmp(tag);
  try {
    const root = path.join(dir, 'BD');
    makeBluray(root);
    const ino = fs.statSync(root).ino;
    const a = lib.mediumIdentity(root);
    assert.ok(a.startsWith('bluray:'));
    edit(root);
    assert.equal(fs.statSync(root).ino, ino);
    return lib.mediumIdentity(root) !== a;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const rewrite = (rel) => (root) => fs.writeFileSync(path.join(root, ...rel.split('/')), `REWRITTEN:${rel}:longer`);

test('mediumIdentity: a rewritten BDMV/BACKUP playlist, clip or index changes identity', () => {
  for (const rel of ['BDMV/BACKUP/PLAYLIST/00000.mpls', 'BDMV/BACKUP/CLIPINF/00000.clpi', 'BDMV/BACKUP/index.bdmv']) {
    assert.ok(blurayChanges('bdbak', rewrite(rel)), rel);
  }
});

test('mediumIdentity: a same-size rewrite of a BACKUP playlist with a new mtime changes identity', () => {
  const rel = 'BDMV/BACKUP/PLAYLIST/00000.mpls';
  assert.ok(blurayChanges('bdsame', (root) => {
    const p = path.join(root, ...rel.split('/'));
    const len = fs.statSync(p).size;
    fs.writeFileSync(p, 'Z'.repeat(len));
    const t = new Date('2021-06-01T00:00:00Z');
    fs.utimesSync(p, t, t);
    assert.equal(fs.statSync(p).size, len);
  }));
});

test('mediumIdentity: a rewritten AACS file changes identity', () => {
  assert.ok(blurayChanges('bdaacs', rewrite('AACS/Unit_Key_RO.inf')));
  assert.ok(blurayChanges('bdaacsdup', rewrite('AACS/DUPLICATE/Unit_Key_RO.inf')));
});

test('mediumIdentity: a rewritten CERTIFICATE file changes identity', () => {
  assert.ok(blurayChanges('bdcert', rewrite('CERTIFICATE/id.bdmv')));
  assert.ok(blurayChanges('bdcertbak', rewrite('CERTIFICATE/BACKUP/id.bdmv')));
});

test('mediumIdentity: META, JAR and BDSVM files added to a Blu-ray change identity', () => {
  assert.ok(blurayChanges('bdmeta', (r) => put(r, 'BDMV/META/DL/bdmt_eng.xml', '<xml/>')));
  assert.ok(blurayChanges('bdjar', (r) => put(r, 'BDMV/JAR/00000.jar', 'PK')));
  assert.ok(blurayChanges('bdsvm', (r) => put(r, 'BDSVM/00000.svm', 'SVM')));
});

test('mediumIdentity: OS metadata files do not change a Blu-ray identity', () => {
  assert.equal(blurayChanges('bdjunk', (r) => {
    put(r, 'BDMV/PLAYLIST/.DS_Store');
    put(r, 'BDMV/PLAYLIST/._00000.mpls');
    put(r, 'BDMV/BACKUP/.DS_Store');
  }), false);
});

test('mediumIdentity: desktop.ini in BDMV/PLAYLIST changes identity because libbluray parses it', () => {
  assert.ok(blurayChanges('bdini', (r) => put(r, 'BDMV/PLAYLIST/desktop.ini', '[.ShellClassInfo]')));
});

// ---------- CR-01 round 3: an unreadable walked directory fails closed ----------
// libbluray opens files by name, which needs only search (x) permission on the directory. A
// traverse-only BDMV used to read as `BDMV|missing`, freezing the identity while the engine kept
// reading edited files (01-VERIFICATION round 2). Now only ENOENT/ENOTDIR count as absent.
const NO_REAL_CHMOD = process.platform === 'win32' || !!(process.getuid && process.getuid() === 0);
const errCode = (code) => Object.assign(new Error(code), { code });
const isUnreadable = (e) => e instanceof Error && e.message === lib.IDENTITY_UNREADABLE;
function makeSmallBluray(root) {
  for (const rel of ['BDMV/index.bdmv', 'BDMV/PLAYLIST/00000.mpls', 'BDMV/CLIPINF/00000.clpi', 'BDMV/STREAM/00000.m2ts']) {
    put(root, rel, `ORIG:${rel}`);
  }
}
function traverseOnly(tag, relDir) {
  const dir = idTmp(tag);
  const root = path.join(dir, 'BD');
  makeSmallBluray(root);
  const target = path.join(root, ...relDir.split('/'));
  try {
    assert.equal(typeof lib.mediumIdentity(root), 'string');
    fs.chmodSync(target, 0o311);
    assert.throws(() => lib.mediumIdentity(root), isUnreadable);
  } finally {
    // Restore the mode before removing, or rmSync can't list the directory.
    try { fs.chmodSync(target, 0o755); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('mediumIdentity: a traverse-only BDMV (mode 0o311) throws IDENTITY_UNREADABLE instead of freezing the identity', { skip: NO_REAL_CHMOD && 'needs POSIX permissions and a non-root user' }, () => {
  traverseOnly('bd311', 'BDMV');
});

test('mediumIdentity: a traverse-only BDMV/PLAYLIST (mode 0o311) throws IDENTITY_UNREADABLE', { skip: NO_REAL_CHMOD && 'needs POSIX permissions and a non-root user' }, () => {
  traverseOnly('bdpl311', 'BDMV/PLAYLIST');
});

test('mediumIdentity: readdir errors other than ENOENT/ENOTDIR on a walked directory throw IDENTITY_UNREADABLE', () => {
  const dir = idTmp('rderr');
  try {
    const bd = path.join(dir, 'BD');
    makeSmallBluray(bd);
    const dvd = path.join(dir, 'MOVIE');
    makeDvd(dvd);
    for (const code of ['EACCES', 'EPERM', 'EIO', 'ELOOP']) {
      for (const [root, failing] of [[bd, path.join(bd, 'BDMV')], [bd, path.join(bd, 'BDMV', 'PLAYLIST')], [dvd, path.join(dvd, 'VIDEO_TS')], [dvd, dvd]]) {
        const readdir = (p) => { if (p === failing) throw errCode(code); return fs.readdirSync(p); };
        assert.throws(() => lib.mediumIdentity(root, { readdir }), isUnreadable, `${code} on ${failing}`);
      }
    }
    // An error with no code at all is not "absent" either.
    const bare = (p) => { if (p === path.join(bd, 'BDMV')) throw new Error('boom'); return fs.readdirSync(p); };
    assert.throws(() => lib.mediumIdentity(bd, { readdir: bare }), isUnreadable);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mediumIdentity: stat errors other than ENOENT/ENOTDIR on an entry or a Blu-ray top folder throw IDENTITY_UNREADABLE', () => {
  const dir = idTmp('sterr');
  try {
    const root = path.join(dir, 'BD');
    makeSmallBluray(root);
    const mpls = path.join(root, 'BDMV', 'PLAYLIST', '00000.mpls');
    const aacs = path.join(root, 'AACS');
    const failOn = (target, code) => (p, o) => { if (p === target) throw errCode(code); return fs.statSync(p, o); };
    assert.throws(() => lib.mediumIdentity(root, { stat: failOn(mpls, 'EACCES') }), isUnreadable);
    assert.throws(() => lib.mediumIdentity(root, { stat: failOn(mpls, 'EIO') }), isUnreadable);
    assert.throws(() => lib.mediumIdentity(root, { stat: failOn(aacs, 'EACCES') }), isUnreadable);
    assert.throws(() => lib.mediumIdentity(root, { stat: failOn(aacs, 'EPERM') }), isUnreadable);
    // A missing AACS is fine: most discs and rips have none.
    assert.equal(lib.mediumIdentity(root, { stat: failOn(aacs, 'ENOENT') }), lib.mediumIdentity(root));
    // An entry that vanished mid-walk is recorded, not fatal.
    const gone = lib.mediumIdentity(root, { stat: failOn(mpls, 'ENOENT') });
    assert.equal(typeof gone, 'string');
    assert.notEqual(gone, lib.mediumIdentity(root));
    assert.equal(typeof lib.mediumIdentity(root, { stat: failOn(mpls, 'ENOTDIR') }), 'string');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mediumIdentity: folders without the optional DVD and Blu-ray directories still give a stable identity', () => {
  const dir = idTmp('optional');
  try {
    const dvd = path.join(dir, 'MOVIE');
    makeDvd(dvd); // no video_ts (case-sensitive disks), AUDIO_TS or DVD_RTAV
    const a = lib.mediumIdentity(dvd);
    assert.ok(a.startsWith('dvd:'));
    assert.equal(lib.mediumIdentity(dvd), a);
    const bd = path.join(dir, 'BD');
    makeSmallBluray(bd); // no AACS, CERTIFICATE or BDSVM
    const b = lib.mediumIdentity(bd);
    assert.ok(b.startsWith('bluray:'));
    assert.equal(lib.mediumIdentity(bd), b);
    // ENOTDIR (a file where a folder would be) counts as absent too.
    const notDir = (p) => { if (p === path.join(dvd, 'video_ts')) throw errCode('ENOTDIR'); return fs.readdirSync(p); };
    assert.equal(typeof lib.mediumIdentity(dvd, { readdir: notDir }), 'string');
    const noEnt = (p) => { if (p === path.join(dvd, 'AUDIO_TS')) throw errCode('ENOENT'); return fs.readdirSync(p); };
    assert.equal(typeof lib.mediumIdentity(dvd, { readdir: noEnt }), 'string');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('identityRefusal names the real reason and always starts with "Scan the disc again"', () => {
  assert.equal(typeof lib.IDENTITY_UNREADABLE, 'string');
  assert.ok(lib.IDENTITY_UNREADABLE.length > 0);
  assert.equal(typeof lib.identityRefusal, 'function');
  assert.equal(lib.identityRefusal(new Error(lib.IDENTITY_UNREADABLE)), `Scan the disc again. ${lib.IDENTITY_UNREADABLE}`);
  assert.equal(lib.identityRefusal(new Error(lib.IDENTITY_TOO_MANY)), `Scan the disc again. ${lib.IDENTITY_TOO_MANY}`);
  assert.equal(lib.identityRefusal(new Error('Source changed')), lib.RESCAN_CHANGED);
  assert.equal(lib.identityRefusal(null), lib.RESCAN_CHANGED);
  assert.equal(lib.identityRefusal(undefined), lib.RESCAN_CHANGED);
  for (const e of [new Error(lib.IDENTITY_UNREADABLE), new Error(lib.IDENTITY_TOO_MANY), new Error('x'), null]) {
    assert.match(lib.identityRefusal(e), /^Scan the disc again/);
  }
});
