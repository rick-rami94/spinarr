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

test('sanitizeSettingsPatch only lets known, typed keys through', () => {
  assert.deepEqual(lib.sanitizeSettingsPatch({ minMinutes: 5, accurateChapters: false }), { minMinutes: 5, accurateChapters: false });
  assert.deepEqual(lib.sanitizeSettingsPatch({ outputDir: '/etc', __proto__: { x: 1 }, evil: 1 }), {});
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
  assert.match(lib.blurayBlocker(aacs(0, { libaacs: false }), k), /Install libaacs/);
  assert.match(lib.blurayBlocker(aacs(-2), k), /found no KEYDB\.cfg.*\/home\/me\/\.config\/aacs\/KEYDB\.cfg/);
  assert.match(lib.blurayBlocker(aacs(-3), k), /has no key that opens it/);
  assert.match(lib.blurayBlocker(aacs(-8), k), /has no key that opens it/);
  assert.match(lib.blurayBlocker(aacs(-5), k), /revokes/);
  assert.match(lib.blurayBlocker(aacs(-6), k), /refused the AACS handshake/);
  assert.match(lib.blurayBlocker({ bdplus: true, bdplusHandled: false }, k), /BD\+/);
});
