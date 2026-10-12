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
