// THIRD_PARTY_NOTICES.txt generator (scripts/gen-notices.js) and the committed file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pins = require('../../scripts/pins');
const { buildNotices } = require('../../scripts/gen-notices');

const ROOT = path.join(__dirname, '..', '..');
const NOTICES = path.join(ROOT, 'THIRD_PARTY_NOTICES.txt');

const INPUT = {
  pins: [
    { name: 'ffmpeg', version: '8.0.1', url: 'https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz', sha256: '1'.repeat(64), spdx: 'GPL-3.0-or-later' },
    { name: 'libdvdnav', version: '7.0.0', url: 'https://example.org/libdvdnav-7.0.0.tar.xz', sha256: '3'.repeat(64), spdx: 'GPL-2.0-or-later' },
    { name: 'libbluray', version: '1.5.0', url: 'https://example.org/libbluray-1.5.0.tar.xz', sha256: '4'.repeat(64), spdx: 'LGPL-2.1-or-later' },
  ],
  embedded: pins.EMBEDDED,
  electron: '44.7.0',
  patches: { ffmpeg: ['ffmpeg-0001-a.patch', 'ffmpeg-0002-b.patch'] },
  readLicense: (c) => `LICENSE TEXT FOR ${c.name}\n`,
};

function section(text, name) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`== ${name} `));
  assert.ok(i >= 0, `no section for ${name}`);
  const j = lines.findIndex((l, k) => k > i && l.startsWith('== '));
  return lines.slice(i, j < 0 ? undefined : j).join('\n');
}

test('notices: header names the Spinarr license and the source asset, without a version', () => {
  const t = buildNotices(INPUT);
  const head = t.slice(0, t.indexOf('\n== '));
  assert.match(head, /GPL-3\.0-or-later/);
  assert.match(head, /spinarr-<version>-source\.tar\.gz/);
  assert.match(head, /https:\/\/github\.com\/rick-rami94\/spinarr\/releases/);
  assert.doesNotMatch(head, /\d+\.\d+\.\d+/);
});

test('notices: one section per pin and embedded component with URL, patches and license', () => {
  const t = buildNotices(INPUT);
  for (const p of [...INPUT.pins, ...INPUT.embedded]) {
    const s = section(t, p.name);
    assert.equal(s.split('\n')[0], `== ${p.name} ${p.version} (${p.spdx}) ==`);
    assert.ok(s.includes(p.url), `${p.name} url`);
    assert.ok(s.includes(`LICENSE TEXT FOR ${p.name}`), `${p.name} license`);
  }
  const ff = section(t, 'ffmpeg');
  assert.ok(ff.includes('ffmpeg-0001-a.patch') && ff.includes('ffmpeg-0002-b.patch'));
  assert.match(section(t, 'libdvdnav'), /Local patches: none/);
  assert.match(section(t, 'libudfread'), /libbluray 1\.5\.0/);
});

test('notices: electron section has its license, Chromium pointer and libffmpeg note', () => {
  const s = section(buildNotices(INPUT), 'electron');
  assert.equal(s.split('\n')[0], '== electron 44.7.0 (MIT) ==');
  assert.ok(s.includes('LICENSE TEXT FOR electron'));
  assert.ok(s.includes('licenses/LICENSES.chromium.html'));
  assert.match(s, /libffmpeg[^\n]*LGPL-2\.1/);
  assert.match(s, /v44\.7\.0/);
});

test('notices: a missing license file fails with the component name', () => {
  const input = { ...INPUT, readLicense: (c) => { if (c.name === 'libudfread') throw new Error('ENOENT'); return 'x\n'; } };
  assert.throws(() => buildNotices(input), /libudfread/);
});

test('notices: no decryption library section', () => {
  const t = buildNotices(INPUT);
  assert.doesNotMatch(t, /^== [^\n]*(dvdcss|aacs|bdplus)/im);
});

test('notices: output is deterministic with LF line endings', () => {
  const crlf = { ...INPUT, readLicense: (c) => `line one ${c.name}\r\nline two\r\n` };
  const a = buildNotices(crlf);
  assert.equal(a, buildNotices(crlf));
  assert.ok(!a.includes('\r'));
  assert.ok(a.endsWith('\n'));
});

test('notices: committed THIRD_PARTY_NOTICES.txt has a section for every current component', () => {
  const t = fs.readFileSync(NOTICES, 'utf8');
  for (const p of pins.readPins(ROOT)) assert.ok(t.includes(`\n== ${p.name} ${p.version} (${p.spdx}) ==\n`), p.name);
  for (const e of pins.EMBEDDED) assert.ok(t.includes(`\n== ${e.name} ${e.version} (${e.spdx}) ==\n`), e.name);
  assert.ok(t.includes(`\n== electron ${pins.electronVersion(ROOT)} (MIT) ==\n`));
  assert.equal(t.split('\n').filter((l) => l.startsWith('== ')).length, pins.readPins(ROOT).length + pins.EMBEDDED.length + 1);
});

test('notices: --check passes on the committed file when sources are present', (t) => {
  const have = pins.readPins(ROOT).every((p) => fs.existsSync(path.join(ROOT, 'engine', 'deps', `${p.name}-${p.version}`)))
    && fs.existsSync(path.join(ROOT, 'node_modules', 'electron', 'dist', 'LICENSE'));
  if (!have) { t.skip('engine sources or node_modules/electron not present (run `sh engine/build.sh fetch` and `npm ci`)'); return; }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-notices.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
