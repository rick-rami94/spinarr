// Pin table parser (scripts/pins.js) and CycloneDX SBOM builder (scripts/gen-sbom.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pins = require('../../scripts/pins');

const ROOT = path.join(__dirname, '..', '..');
const BUILD_SH = path.join(ROOT, 'engine', 'build.sh');

// --- pins ---

test('pins: parsePins reads 4 pins in table order with 5 fields each', () => {
  const p = pins.parsePins(fs.readFileSync(BUILD_SH, 'utf8'));
  assert.equal(p.length, 4);
  assert.deepEqual(p.map((x) => x.name), ['ffmpeg', 'libdvdread', 'libdvdnav', 'libbluray']);
  for (const x of p) {
    assert.deepEqual(Object.keys(x).sort(), ['name', 'sha256', 'spdx', 'url', 'version']);
    assert.match(x.sha256, /^[0-9a-f]{64}$/);
    assert.match(x.url, /^https:\/\//);
  }
  assert.deepEqual(p.map((x) => x.spdx),
    ['GPL-3.0-or-later', 'GPL-2.0-or-later', 'GPL-2.0-or-later', 'LGPL-2.1-or-later']);
});

test('pins: parsePins rejects a pin without an SPDX column', () => {
  const text = 'X=1\nSOURCES="\nfoo 1.0 https://example.org/foo.tar.xz ' + 'a'.repeat(64) + '\n"\n';
  assert.throws(() => pins.parsePins(text), /pin foo has no SPDX license column/);
});

test('pins: parsePins skips blank lines and stops at the closing quote', () => {
  const text = 'SOURCES="\n\nfoo 1.0 https://e.org/f ' + 'b'.repeat(64) + ' MIT\n\n"\nbar 2 x y z\n';
  assert.deepEqual(pins.parsePins(text),
    [{ name: 'foo', version: '1.0', url: 'https://e.org/f', sha256: 'b'.repeat(64), spdx: 'MIT' }]);
});

test('pins: readPins(root) equals parsePins of engine/build.sh', () => {
  assert.deepEqual(pins.readPins(ROOT), pins.parsePins(fs.readFileSync(BUILD_SH, 'utf8')));
  assert.deepEqual(pins.readPins(), pins.readPins(ROOT));
});

test('pins: names and versions match what build.sh fetch() reads with awk', { skip: process.platform === 'win32' }, () => {
  const script = 'SOURCES=$(sed -n \'/^SOURCES="/,/^"$/p\' "$1" | sed \'1d;$d\'); '
    + 'echo "$SOURCES" | awk \'NF {print $1, $2, $3, $4}\'';
  const out = execFileSync('sh', ['-c', script, 'sh', BUILD_SH], { encoding: 'utf8' }).trim().split('\n');
  const p = pins.readPins(ROOT);
  assert.deepEqual(out, p.map((x) => [x.name, x.version, x.url, x.sha256].join(' ')));
});

test('pins: patchesFor lists sorted absolute patch paths', () => {
  const bd = pins.patchesFor('libbluray', ROOT);
  assert.equal(bd.length, 2);
  assert.deepEqual(bd, [...bd].sort());
  for (const f of bd) {
    assert.ok(path.isAbsolute(f));
    assert.match(path.basename(f), /^libbluray-\d{4}-.*\.patch$/);
  }
  assert.deepEqual(pins.patchesFor('libdvdnav', ROOT), []);
  // a name that is a prefix of another must not pick up its patches
  assert.deepEqual(pins.patchesFor('libdvd', ROOT), []);
});

test('pins: EMBEDDED describes libudfread inside libbluray', () => {
  assert.deepEqual(pins.EMBEDDED, [{
    name: 'libudfread', version: '1.2.0', spdx: 'LGPL-2.1-or-later', parent: 'libbluray',
    url: 'https://code.videolan.org/videolan/libudfread', licensePath: 'contrib/libudfread/COPYING',
  }]);
});

test('pins: electronVersion reads the exact version from package-lock.json', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const v = pins.electronVersion(ROOT);
  assert.equal(v, lock.packages['node_modules/electron'].version);
  assert.match(v, /^\d+\.\d+\.\d+$/);
});

// --- sbom ---

const { buildSbom } = require('../../scripts/gen-sbom');

const FIXTURE = {
  version: '0.2.0',
  pins: [
    { name: 'ffmpeg', version: '8.0.1', url: 'https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz', sha256: '1'.repeat(64), spdx: 'GPL-3.0-or-later' },
    { name: 'libdvdread', version: '7.1.1', url: 'https://example.org/libdvdread-7.1.1.tar.xz', sha256: '2'.repeat(64), spdx: 'GPL-2.0-or-later' },
    { name: 'libdvdnav', version: '7.0.0', url: 'https://example.org/libdvdnav-7.0.0.tar.xz', sha256: '3'.repeat(64), spdx: 'GPL-2.0-or-later' },
    { name: 'libbluray', version: '1.5.0', url: 'https://example.org/libbluray-1.5.0.tar.xz', sha256: '4'.repeat(64), spdx: 'LGPL-2.1-or-later' },
  ],
  embedded: pins.EMBEDDED,
  electron: '44.7.0',
  patches: {
    ffmpeg: [{ file: 'ffmpeg-0001-a.patch', text: '--- a/x\n+++ b/x\n' }],
    libbluray: [{ file: 'libbluray-0001-b.patch', text: 'diff b1\n' }, { file: 'libbluray-0002-c.patch', text: 'diff b2\n' }],
  },
  sourceDateEpoch: 1760000000,
  toolchain: { node: '22.23.3', meson: '1.12.1' },
};

function allComponents(list, out = []) {
  for (const c of list || []) { out.push(c); allComponents(c.components, out); }
  return out;
}

test('sbom: CycloneDX 1.6 header, deterministic, no serialNumber', () => {
  const s = buildSbom(FIXTURE);
  assert.equal(s.bomFormat, 'CycloneDX');
  assert.equal(s.specVersion, '1.6');
  assert.equal(s.version, 1);
  assert.equal('serialNumber' in s, false);
  assert.equal(JSON.stringify(buildSbom(FIXTURE)), JSON.stringify(s));
});

test('sbom: metadata timestamp and application component', () => {
  const s = buildSbom(FIXTURE);
  assert.equal(s.metadata.timestamp, new Date(1760000000 * 1000).toISOString());
  const app = s.metadata.component;
  assert.equal(app.type, 'application');
  assert.equal(app.name, 'spinarr');
  assert.equal(app.version, '0.2.0');
  assert.deepEqual(app.licenses, [{ license: { id: 'GPL-3.0-or-later' } }]);
  assert.equal(app.purl, 'pkg:github/rick-rami94/spinarr@v0.2.0');
  assert.equal(app['bom-ref'], app.purl);
});

test('sbom: top-level components and nested libudfread', () => {
  const s = buildSbom(FIXTURE);
  assert.deepEqual(s.components.map((c) => c.name), ['ffmpeg', 'libdvdread', 'libdvdnav', 'libbluray', 'electron']);
  const bd = s.components.find((c) => c.name === 'libbluray');
  assert.equal(bd.components.length, 1);
  const udf = bd.components[0];
  assert.equal(udf.name, 'libudfread');
  assert.equal(udf.version, '1.2.0');
  assert.deepEqual(udf.licenses, [{ license: { id: 'LGPL-2.1-or-later' } }]);
  const el = s.components.find((c) => c.name === 'electron');
  assert.equal(el.purl, 'pkg:npm/electron@44.7.0');
  assert.deepEqual(el.licenses, [{ license: { id: 'MIT' } }]);
});

test('sbom: pin components carry license, hash, distribution ref and generic purl', () => {
  const s = buildSbom(FIXTURE);
  for (const p of FIXTURE.pins) {
    const c = s.components.find((x) => x.name === p.name);
    assert.equal(c.version, p.version);
    assert.deepEqual(c.licenses, [{ license: { id: p.spdx } }]);
    assert.deepEqual(c.hashes, [{ alg: 'SHA-256', content: p.sha256 }]);
    assert.deepEqual(c.externalReferences, [{ type: 'distribution', url: p.url, hashes: [{ alg: 'SHA-256', content: p.sha256 }] }]);
    assert.equal(c.purl, `pkg:generic/${p.name}@${p.version}?download_url=${encodeURIComponent(p.url)}`);
    assert.equal(c['bom-ref'], c.purl);
  }
});

test('sbom: local patches become pedigree entries; unpatched components have no pedigree', () => {
  const s = buildSbom(FIXTURE);
  const by = (n) => s.components.find((c) => c.name === n);
  const ff = by('ffmpeg').pedigree.patches;
  assert.equal(ff.length, 1);
  assert.deepEqual(ff[0], { type: 'unofficial', diff: { text: { content: '--- a/x\n+++ b/x\n', contentType: 'text/x-diff' } } });
  assert.deepEqual(by('libbluray').pedigree.patches.map((p) => p.diff.text.content), ['diff b1\n', 'diff b2\n']);
  for (const n of ['libdvdread', 'libdvdnav', 'electron']) assert.equal('pedigree' in by(n), false, n);
});

test('sbom: toolchain is metadata only', () => {
  const s = buildSbom(FIXTURE);
  assert.deepEqual(s.metadata.properties, [
    { name: 'spinarr:build:meson', value: '1.12.1' },
    { name: 'spinarr:build:node', value: '22.23.3' },
  ]);
  const names = allComponents(s.components).map((c) => c.name);
  assert.ok(!names.includes('node') && !names.includes('meson'));
});

test('sbom: dependencies graph links app to components and libbluray to libudfread', () => {
  const s = buildSbom(FIXTURE);
  const app = s.metadata.component['bom-ref'];
  assert.deepEqual(s.dependencies.find((d) => d.ref === app).dependsOn, s.components.map((c) => c['bom-ref']));
  const bd = s.components.find((c) => c.name === 'libbluray');
  assert.deepEqual(s.dependencies.find((d) => d.ref === bd['bom-ref']).dependsOn, [bd.components[0]['bom-ref']]);
  const refs = new Set([app, ...allComponents(s.components).map((c) => c['bom-ref'])]);
  for (const d of s.dependencies) for (const r of [d.ref, ...d.dependsOn]) assert.ok(refs.has(r), r);
});

test('sbom: no decryption library is ever a component', () => {
  const s = buildSbom(FIXTURE);
  for (const c of allComponents(s.components)) assert.doesNotMatch(c.name, /dvdcss|aacs|bdplus/i);
});

test('sbom: real repo inputs cover every pin, libudfread, electron and each patch once', () => {
  const real = pins.readPins(ROOT);
  const patches = {};
  for (const p of real) {
    const files = pins.patchesFor(p.name, ROOT);
    if (files.length) patches[p.name] = files.map((f) => ({ file: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
  }
  const s = buildSbom({ version: '0.0.0-test', pins: real, embedded: pins.EMBEDDED, electron: pins.electronVersion(ROOT),
    patches, sourceDateEpoch: 1760000000, toolchain: {} });
  for (const p of real) {
    const c = s.components.find((x) => x.name === p.name);
    assert.ok(c, p.name);
    assert.equal(c.version, p.version);
  }
  assert.equal(s.components.find((c) => c.name === 'libbluray').components[0].name, 'libudfread');
  assert.equal(s.components.find((c) => c.name === 'electron').version, pins.electronVersion(ROOT));
  const texts = allComponents(s.components).flatMap((c) => (c.pedigree ? c.pedigree.patches : [])).map((p) => p.diff.text.content);
  const files = fs.readdirSync(path.join(ROOT, 'engine', 'patches')).filter((f) => f.endsWith('.patch'));
  assert.equal(texts.length, files.length);
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, 'engine', 'patches', f), 'utf8');
    assert.equal(texts.filter((x) => x === t).length, 1, f);
  }
});
