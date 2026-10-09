// Integration tests for the rip engine (dvdinfo + custom ffmpeg) against the fixture matrix.
// Requires: npm run engine && npm run fixtures. Uses the system ffmpeg/ffprobe (brew) as an independent oracle.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../../app/lib');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'engine', 'bin');
const FX = path.join(ROOT, 'test', 'fixtures', 'out');
const ORACLE = process.env.ORACLE_FFMPEG_DIR || '/usr/local/bin';
const fx = (n) => path.join(FX, n);
let TMP;

before(() => {
  for (const b of ['dvdinfo', 'ffmpeg', 'ffprobe']) assert.ok(fs.existsSync(path.join(BIN, b)), `missing engine/bin/${b} (npm run engine)`);
  assert.ok(fs.existsSync(fx('ntsc_basic.iso')), 'missing fixtures (npm run fixtures)');
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-engine-'));
});

function dvdinfo(src) {
  const r = spawnSync(path.join(BIN, 'dvdinfo'), [src], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.signal, null, `dvdinfo crashed with ${r.signal} on ${src}`);
  return { code: r.status, json: JSON.parse(r.stdout) };
}

function rip(src, title, streams, name) {
  const out = path.join(TMP, name + '.mkv');
  const args = lib.ripArgs({ source: src, title, streams, displayName: name, accurateChapters: true }, out);
  const r = spawnSync(path.join(BIN, 'ffmpeg'), args, { encoding: 'utf8', timeout: 120000 });
  return { ...r, out };
}

function probe(file) {
  return JSON.parse(execFileSync(path.join(ORACLE, 'ffprobe'), ['-v', 'error', '-show_streams', '-show_chapters', '-show_format', '-of', 'json', file]));
}

const packetHashes = (file, spec) => execFileSync(path.join(ORACLE, 'ffmpeg'), ['-v', 'error', '-i', file, '-map', `0:${spec}`, '-c', 'copy', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').at(-1).trim());
const decodedHash = (file, spec) => execFileSync(path.join(ORACLE, 'ffmpeg'), ['-v', 'error', '-i', file, '-map', `0:${spec}`, '-f', 'md5', '-'], { encoding: 'utf8' }).trim();

// ---------------- dvdinfo ----------------

test('dvdinfo: NTSC disc with chapters and two audio languages', () => {
  const { code, json } = dvdinfo(fx('ntsc_basic.iso'));
  assert.equal(code, 0);
  assert.equal(json.volume, 'NTSC_BASIC');
  assert.equal(json.titles.length, 2);
  const [t1, t2] = json.titles;
  assert.equal(t1.chapters.length, 4);
  assert.ok(Math.abs(t1.duration - 40) < 0.5, `t1 duration ${t1.duration}`);
  assert.ok(Math.abs(t1.chapters.reduce((a, b) => a + b) - t1.duration) < 0.01);
  assert.ok(Math.abs(t2.duration - 12) < 0.5);
  assert.deepEqual(t1.video, { standard: 'NTSC', aspect: '16:9', mpeg: 2 });
  assert.deepEqual(t1.audio.map((a) => [a.lang, a.codec, a.channels]), [['en', 'AC3', 2], ['es', 'AC3', 2]]);
  assert.ok(t1.bytes > 1e6);
});

test('dvdinfo: PAL 4:3 with 5.1 audio, commentary track and three subtitle languages', () => {
  const { json } = dvdinfo(fx('pal_subs.iso'));
  const t = json.titles[0];
  assert.deepEqual(t.video, { standard: 'PAL', aspect: '4:3', mpeg: 2 });
  assert.deepEqual(t.audio.map((a) => [a.channels, a.commentary]), [[6, false], [2, true]]);
  assert.deepEqual(t.subtitles.map((s) => s.lang), ['en', 'fr', 'de']);
  assert.equal(t.chapters.length, 2);
});

test('dvdinfo + analyzeTitles: multi-titleset disc finds main feature, duplicate and extras', () => {
  const { json } = dvdinfo(fx('feature_disc.iso'));
  assert.deepEqual(json.titles.map((t) => t.vts), [1, 2, 2, 2]);
  const d = lib.analyzeTitles(json, fx('feature_disc.iso'));
  assert.equal(d.name, 'The Test Movie Disc 1');
  assert.equal(d.titles.find((t) => t.main).title, 2);
  assert.equal(d.titles.find((t) => t.title === 3).duplicateOf, 2);
  assert.equal(d.titles.find((t) => t.title === 2).chapters.length, 5);
  assert.deepEqual(d.titles[0].audio.map((a) => a.codec), ['MPEG']);
});

test('dvdinfo: VIDEO_TS folder input works the same as an ISO', () => {
  const a = dvdinfo(fx('ntsc_basic')).json, b = dvdinfo(fx('ntsc_basic.iso')).json;
  assert.deepEqual(a.titles, b.titles);
});

test('dvdinfo: unicode and hostile names pass through as valid JSON', () => {
  assert.equal(dvdinfo(fx('xss_label.iso')).json.volume, '<img src=x onerror=__xss=1>');
  assert.equal(dvdinfo(fx('Amélie – Ünïcødé 日本語')).json.titles.length, 2);
});

for (const bad of ['random.iso', 'empty.iso', 'no_videots', 'empty_videots', 'zeroed_ifo', 'does-not-exist.iso']) {
  test(`dvdinfo: malformed input "${bad}" gives a JSON error, exit 1, no crash`, () => {
    const { code, json } = dvdinfo(fx(bad));
    assert.equal(code, 1);
    assert.equal(typeof json.error, 'string');
  });
}

test('dvdinfo: no arguments prints usage and exits 2', () => {
  const r = spawnSync(path.join(BIN, 'dvdinfo'), [], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

// ---------------- ripping ----------------

const LOSSLESS = [
  { disc: 'ntsc_basic.iso', title: 1, src: 'src/nb1.mpg', audio: 2 },
  { disc: 'ntsc_basic.iso', title: 2, src: 'src/nb2.mpg', audio: 2 },
  { disc: 'pal_subs.iso', title: 1, src: 'src/ps1.mpg', audio: 2 },
  { disc: 'feature_disc.iso', title: 2, src: 'src/feat.mpg', audio: 2 },
  { disc: 'feature_disc.iso', title: 1, src: 'src/logo.mpg', audio: 1 },
];
for (const L of LOSSLESS) {
  test(`rip is lossless: ${L.disc} title ${L.title} (video bit-identical, every audio packet kept)`, () => {
    const r = rip(fx(L.disc), L.title, null, `lossless-${path.basename(L.disc, '.iso')}-${L.title}`);
    assert.equal(r.status, 0, r.stderr);
    const src = fx(L.src);
    assert.equal(decodedHash(r.out, 'v:0'), decodedHash(src, 'v:0'), 'decoded video differs');
    for (let i = 0; i < L.audio; i++) {
      const got = packetHashes(r.out, `a:${i}`), want = packetHashes(src, `a:${i}`);
      const start = want.indexOf(got[0]);
      assert.ok(start >= 0 && start <= 8, `audio ${i} starts at source packet ${start}`);
      assert.deepEqual(got, want.slice(start, start + got.length), `audio ${i}: packets missing or altered mid-stream`);
      assert.ok(want.length - got.length <= 12, `audio ${i} lost ${want.length - got.length} edge packets`);
      const pts = execFileSync(path.join(ORACLE, 'ffprobe'), ['-v', 'error', '-select_streams', `a:${i}`, '-show_entries', 'packet=pts', '-of', 'csv=p=0', r.out], { encoding: 'utf8' })
        .trim().split('\n').map(Number);
      for (let k = 1; k < pts.length; k++) assert.ok(pts[k] > pts[k - 1], `audio ${i} timestamps not increasing at packet ${k}`);
    }
  });
}

test('rip: chapters and language tags are preserved', () => {
  const r = rip(fx('ntsc_basic.iso'), 1, null, 'chapters');
  const p = probe(r.out);
  assert.equal(p.chapters.length, 4);
  const want = [0, 10, 20, 30];
  p.chapters.forEach((c, i) => assert.ok(Math.abs(+c.start_time - want[i]) < 0.6, `chapter ${i + 1} at ${c.start_time}`));
  assert.deepEqual(p.streams.filter((s) => s.codec_type === 'audio').map((s) => s.tags.language), ['eng', 'spa']);
  assert.equal(p.format.tags.title, 'chapters');
});

test('rip: only the selected tracks end up in the file', () => {
  const r = rip(fx('pal_subs.iso'), 1, [0, 2, 4], 'selected');
  assert.equal(r.status, 0, r.stderr);
  const s = probe(r.out).streams;
  assert.deepEqual(s.map((x) => x.codec_type), ['video', 'audio', 'subtitle']);
  assert.equal(s[1].channels, 2, 'kept the commentary (stereo) track');
  assert.equal(s[2].tags.language, 'fre');
});

test('rip: subtitles are copied as DVD bitmap subtitles with languages', () => {
  const r = rip(fx('pal_subs.iso'), 1, null, 'subs');
  const subs = probe(r.out).streams.filter((s) => s.codec_type === 'subtitle');
  assert.deepEqual(subs.map((s) => [s.codec_name, s.tags.language]), [['dvd_subtitle', 'eng'], ['dvd_subtitle', 'fre'], ['dvd_subtitle', 'ger']]);
});

test('rip: a title from the second title set rips at the right length', () => {
  const r = rip(fx('feature_disc.iso'), 2, null, 'feature');
  assert.equal(r.status, 0, r.stderr);
  const p = probe(r.out);
  assert.ok(Math.abs(+p.format.duration - 150) < 1, `duration ${p.format.duration}`);
  assert.equal(p.chapters.length, 5);
  assert.equal(p.streams.find((s) => s.codec_type === 'audio').channels, 6);
});

test('rip: unreadable disc data fails loudly instead of producing a short file', () => {
  const r = rip(fx('truncated.iso'), 1, null, 'truncated');
  assert.notEqual(r.status, 0, 'ffmpeg must exit non-zero on read errors');
  const v = lib.ripVerdict({ code: r.status, stderr: r.stderr, progress: 0.1 });
  assert.equal(v.ok, false);
  assert.match(v.error, /scratched/);
});

test('rip: a title number that does not exist fails cleanly', () => {
  const r = rip(fx('ntsc_basic.iso'), 7, null, 'missing-title');
  assert.notEqual(r.status, 0);
});

test('ffprobe stream order matches what the UI offers for track selection', () => {
  const j = JSON.parse(execFileSync(path.join(BIN, 'ffprobe'), ['-v', 'error', '-f', 'dvdvideo', '-title', '1', '-i', fx('pal_subs.iso'), '-show_streams', '-of', 'json']));
  assert.deepEqual(j.streams.map((s) => s.codec_type), ['video', 'audio', 'audio', 'subtitle', 'subtitle', 'subtitle']);
});

test('completeness check: the engine reads back the true video duration of a DVD rip', () => {
  const r = rip(fx('pal_subs.iso'), 1, null, 'verify-dvd');
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(execFileSync(path.join(BIN, 'ffprobe'), ['-v', 'error', '-f', 'matroska', '-show_entries', 'stream=codec_type:stream_tags=DURATION', '-of', 'json', r.out]));
  const secs = lib.outputVideoSeconds(p);
  assert.ok(Math.abs(secs - 30) < 0.5, `video ${secs}s`);
});
