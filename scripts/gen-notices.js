// Writes THIRD_PARTY_NOTICES.txt from the engine pin table (REL-04, D-15):
//   node scripts/gen-notices.js           regenerate the committed file
//   node scripts/gen-notices.js --check   exit 1 if the committed file is stale (CI drift guard)
// License texts are copied from the verified, extracted sources (`sh engine/build.sh fetch`)
// and from node_modules/electron (`npm ci`). Decryption libraries are never listed: they
// are not distributed with Spinarr.
const fs = require('fs');
const path = require('path');
const pins = require('./pins');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'THIRD_PARTY_NOTICES.txt');
const RULE = '-'.repeat(78);

const HEADER = `Spinarr third-party notices
===========================

Spinarr is free software, licensed under GPL-3.0-or-later (see LICENSE).

The rip engine bundled with Spinarr statically links the components below, built from
pinned, checksum-verified upstream sources with the local patches listed for each one.
The complete corresponding source for each release, including those upstream tarballs,
the patches and the build scripts, is the spinarr-<version>-source.tar.gz asset on that
release at https://github.com/rick-rami94/spinarr/releases

Decryption libraries are not part of Spinarr and are not distributed with it.
`;

// Which license files to copy, relative to engine/deps/<name>-<version>/.
const LICENSE_FILES = {
  ffmpeg: ['COPYING.GPLv3', 'LICENSE.md'],
  libdvdread: ['COPYING'],
  libdvdnav: ['COPYING'],
  libbluray: ['COPYING'],
};

const lf = (s) => String(s).replace(/\r\n?/g, '\n').replace(/\n*$/, '\n');
const patchName = (p) => (typeof p === 'string' ? p : p.file);

function patchLines(list) {
  if (!list || list.length === 0) return ['Local patches: none'];
  return ['Local patches:', ...list.map((p) => `  ${patchName(p)}`)];
}

function licenseOf(readLicense, c) {
  try {
    return lf(readLicense(c));
  } catch (e) {
    throw new Error(`license text for ${c.name} ${c.version} unavailable: ${e.message}`);
  }
}

// buildNotices({ pins, embedded, electron, patches: { name: [file | {file}] }, readLicense(component) })
function buildNotices(input) {
  const { embedded = [], electron, patches = {}, readLicense } = input;
  const parts = [HEADER];
  const add = (c, extra) => {
    if (/dvdcss|aacs|bdplus/i.test(c.name)) throw new Error(`refusing to list decryption library ${c.name}`);
    parts.push([
      RULE,
      `== ${c.name} ${c.version} (${c.spdx}) ==`,
      `Upstream: ${c.url}`,
      ...extra,
      ...patchLines(patches[c.name]),
      '',
      licenseOf(readLicense, c),
    ].join('\n'));
  };
  for (const p of input.pins) {
    add(p, []);
    for (const e of embedded.filter((x) => x.parent === p.name)) {
      add(e, [`Embedded in: ${p.name} ${p.version} (${e.licensePath.replace(/\/COPYING$/, '')}), linked into the engine`]);
    }
  }
  add({ name: 'electron', version: electron, spdx: 'MIT', url: 'https://github.com/electron/electron', kind: 'electron' }, [
    "Chromium's third-party licenses: licenses/LICENSES.chromium.html (bundled with the app)",
    `Electron's bundled libffmpeg is LGPL-2.1; its source is at the Electron release tag https://github.com/electron/electron/tree/v${electron} and the Chromium version it pins`,
  ]);
  return parts.join('\n');
}

module.exports = { buildNotices };

function depDir(c) {
  return path.join(ROOT, 'engine', 'deps', `${c.name}-${c.version}`);
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const list = pins.readPins(ROOT);
  for (const p of list) {
    if (!fs.existsSync(depDir(p))) {
      console.error(`engine/deps/${p.name}-${p.version} is missing: run \`sh engine/build.sh fetch\` first`);
      process.exit(2);
    }
  }
  const electronLicense = path.join(ROOT, 'node_modules', 'electron', 'dist', 'LICENSE');
  if (!fs.existsSync(electronLicense)) {
    console.error('node_modules/electron/dist/LICENSE is missing: run `npm ci` first');
    process.exit(2);
  }
  const byName = Object.fromEntries(list.map((p) => [p.name, p]));
  const readLicense = (c) => {
    if (c.kind === 'electron') return fs.readFileSync(electronLicense, 'utf8');
    const e = pins.EMBEDDED.find((x) => x.name === c.name);
    if (e) return fs.readFileSync(path.join(depDir(byName[e.parent]), e.licensePath), 'utf8');
    const files = LICENSE_FILES[c.name];
    if (!files) throw new Error(`no license file mapping for ${c.name} in scripts/gen-notices.js`);
    return files.map((f) => lf(fs.readFileSync(path.join(depDir(c), f), 'utf8'))).join('\n');
  };
  const patches = {};
  for (const p of list) patches[p.name] = pins.patchesFor(p.name, ROOT).map((f) => path.basename(f));
  const text = buildNotices({ pins: list, embedded: pins.EMBEDDED, electron: pins.electronVersion(ROOT), patches, readLicense });
  const n = list.length + pins.EMBEDDED.length + 1;
  if (check) {
    let cur = null;
    try { cur = fs.readFileSync(OUT, 'utf8'); } catch { /* missing counts as stale */ }
    if (cur !== text) {
      console.error('THIRD_PARTY_NOTICES.txt is stale: run node scripts/gen-notices.js');
      process.exit(1);
    }
    console.log(`THIRD_PARTY_NOTICES.txt is current (${n} components)`);
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote THIRD_PARTY_NOTICES.txt (${n} components)`);
  }
}
