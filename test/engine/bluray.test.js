// Blu-ray engine tests: bdinfo + ffmpeg's bluray input against generated BDMV fixtures
// (npm run fixtures:bluray). The rip path mirrors main.js: scan -> probe -> PID languages
// -> chapters file -> blurayRipArgs. The system ffmpeg is the independent oracle.
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
  assert.ok(fs.existsSync(path.join(BIN, 'bdinfo')), 'missing engine/bin/bdinfo (npm run engine)');
  assert.ok(fs.existsSync(fx('bd_movie')), 'missing Blu-ray fixtures (npm run fixtures:bluray)');
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-bd-'));
});

function bdinfo(src) {
  const r = spawnSync(path.join(BIN, 'bdinfo'), [src], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.signal, null, `bdinfo crashed with ${r.signal}`);
  return { code: r.status, json: JSON.parse(r.stdout) };
}

// Same steps as main.js prepareBluray()
function ripBluray(src, titleNo, { select } = {}) {
  const { json } = bdinfo(src);
  const t = json.titles.find((x) => x.title === titleNo);
  const probe = JSON.parse(execFileSync(path.join(BIN, 'ffprobe'), ['-v', 'error', '-playlist', String(t.playlist), '-i', `bluray:${src}`, '-show_streams', '-of', 'json']));
  const langs = new Map([...t.audio, ...t.subtitles].map((x) => [x.pid, x.lang]));
  let streams = probe.streams.filter((s) => ['video', 'audio', 'subtitle'].includes(s.codec_type))
    .map((s) => ({ index: s.index, codec: s.codec_name, lang: langs.get(parseInt(s.id, 16)) }));
  if (select) streams = streams.filter((s) => select.includes(s.index));
  const out = path.join(TMP, `t${titleNo}-${Date.now()}.mkv`);
  const chapters = out + '.chapters.txt';
  fs.writeFileSync(chapters, lib.chaptersMetadata(t.chapters));
  const r = spawnSync(path.join(BIN, 'ffmpeg'), lib.blurayRipArgs({ source: src, playlist: t.playlist, displayName: 'BD Test' }, streams, chapters, out), { encoding: 'utf8' });
  return { r, out, t, streams };
}
const probe = (f) => JSON.parse(execFileSync(path.join(ORACLE, 'ffprobe'), ['-v', 'error', '-show_streams', '-show_chapters', '-show_format', '-of', 'json', f]));
const decoded = (f, spec) => execFileSync(path.join(ORACLE, 'ffmpeg'), ['-v', 'error', '-i', f, '-map', `0:${spec}`, '-f', 'md5', '-'], { encoding: 'utf8' }).trim();

test('bdinfo: playlists, chapters, codecs, languages and PIDs', () => {
  const { code, json } = bdinfo(fx('bd_movie'));
  assert.equal(code, 0);
  assert.equal(json.type, 'bluray');
  assert.deepEqual(json.titles.map((t) => [t.playlist, Math.round(t.duration), t.chapters.length]), [[0, 90, 5], [1, 90, 5], [2, 15, 1], [3, 4, 1]]);
  const t = json.titles[0];
  assert.deepEqual(t.video, { standard: '1080p', aspect: '16:9', codec: 'H.264' });
  assert.deepEqual(t.audio.map((a) => [a.codec, a.channels, a.lang]), [['AC3', 6, 'eng'], ['AC3', 2, 'fre'], ['LPCM', 2, 'eng']]);
  assert.deepEqual(t.subtitles.map((s) => s.lang), ['eng', 'fre']);
  assert.ok([...t.audio, ...t.subtitles].every((s) => s.pid >= 0x1100), 'PIDs reported');
  assert.equal(json.encryption.aacs, false);
});

test('bdinfo + analyzeTitles: main feature, duplicate playlist and extras', () => {
  const d = lib.analyzeTitles(bdinfo(fx('bd_movie.iso')).json, fx('bd_movie.iso'));
  assert.equal(d.label, 'MY_TEST_MOVIE');
  assert.equal(d.name, 'My Test Movie');
  assert.equal(d.titles.find((t) => t.main).playlist, 0);
  assert.equal(d.titles.find((t) => t.playlist === 1).duplicateOf, 1);
});

test('bdinfo: an AACS disc without libaacs is reported, not opened silently', () => {
  const { code, json } = bdinfo(fx('bd_aacs'));
  assert.equal(code, 0);
  assert.equal(json.encryption.aacs, true);
  assert.equal(json.encryption.aacsHandled, false);
});

for (const bad of ['bd_truncated_mpls', 'bd_empty', 'ntsc_basic.iso', 'random.iso']) {
  test(`bdinfo: malformed or non-Blu-ray input "${bad}" never crashes`, () => {
    const { json } = bdinfo(fx(bad));
    assert.ok(json.error || json.titles.every((t) => t.duration >= 0));
  });
}

test('Blu-ray rip is lossless: video, AC3 and LPCM->FLAC decode identically to the source', () => {
  const { r, out } = ripBluray(fx('bd_movie'), 1);
  assert.equal(r.status, 0, r.stderr);
  const src = fx('bd_movie/BDMV/STREAM/00000.m2ts');
  for (const s of ['v:0', 'a:0', 'a:1', 'a:2']) assert.equal(decoded(out, s), decoded(src, s), `${s} differs`);
  const p = probe(out);
  assert.deepEqual(p.streams.map((s) => s.codec_name), ['h264', 'ac3', 'ac3', 'flac', 'hdmv_pgs_subtitle', 'hdmv_pgs_subtitle']);
});

test('Blu-ray rip carries playlist chapters, languages and title', () => {
  const { out } = ripBluray(fx('bd_movie'), 1);
  const p = probe(out);
  assert.deepEqual(p.chapters.map((c) => Math.round(+c.start_time)), [0, 20, 40, 60, 80]);
  assert.deepEqual(p.streams.slice(1).map((s) => s.tags?.language), ['eng', 'fre', 'eng', 'eng', 'fre']);
  assert.equal(p.format.tags.title, 'BD Test');
  assert.ok(Math.abs(+p.format.duration - 90) < 1);
});

test('Blu-ray rip: a 4-second bonus playlist (under ffmpeg\'s old 180 s floor) rips', () => {
  const { r, out } = ripBluray(fx('bd_movie'), 4);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Math.abs(+probe(out).format.duration - 4) < 0.5);
});

test('Blu-ray rip from the ISO, with a track subset', () => {
  const { r, out } = ripBluray(fx('bd_movie.iso'), 1, { select: [0, 2, 5] });
  assert.equal(r.status, 0, r.stderr);
  const p = probe(out);
  assert.deepEqual(p.streams.map((s) => [s.codec_name, s.tags?.language]), [['h264', undefined], ['ac3', 'fre'], ['hdmv_pgs_subtitle', 'fre']]);
});

test('completeness check: the engine reads back the true video duration (film + early-ending subtitles)', () => {
  const { r, out } = ripBluray(fx('bd_movie'), 1);
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(execFileSync(path.join(BIN, 'ffprobe'), ['-v', 'error', '-f', 'matroska', '-show_entries', 'stream=codec_type:stream_tags=DURATION', '-of', 'json', out]));
  const secs = lib.outputVideoSeconds(p);
  assert.ok(Math.abs(secs - 90) < 0.5, `video ${secs}s`);
  assert.deepEqual(lib.ripVerdict({ code: 0, videoSeconds: secs, duration: 90.09 }), { ok: true });
});
