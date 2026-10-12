// Single parser for the engine pin table in engine/build.sh (D-15).
// The SBOM, THIRD_PARTY_NOTICES.txt, the source bundle and the fuzz build all read the pins
// through this module, so they cannot drift from what build.sh actually downloads.
// `node scripts/pins.js` prints the pins as JSON for shell callers.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Sources compiled into a pinned component rather than downloaded on their own.
// libbluray 1.5.0 vendors libudfread and build.sh links it in with -Dembed_udfread=true.
const EMBEDDED = [{
  name: 'libudfread',
  version: '1.2.0',
  spdx: 'LGPL-2.1-or-later',
  parent: 'libbluray',
  url: 'https://code.videolan.org/videolan/libudfread',
  licensePath: 'contrib/libudfread/COPYING',
}];

// parsePins(text): the lines between `SOURCES="` and the next line that is just `"`,
// each `name version url sha256 spdx` (the same fields build.sh's awk reads as $1..$5).
function parsePins(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('SOURCES="'));
  if (start < 0) throw new Error('no SOURCES=" block in engine/build.sh');
  const end = lines.findIndex((l, i) => i > start && l.trim() === '"');
  if (end < 0) throw new Error('SOURCES block in engine/build.sh is not closed');
  const out = [];
  for (const line of lines.slice(start + 1, end)) {
    const f = line.trim().split(/\s+/).filter(Boolean);
    if (f.length === 0) continue;
    if (f.length === 4) throw new Error(`pin ${f[0]} has no SPDX license column`);
    if (f.length !== 5) throw new Error(`pin ${f[0]} has ${f.length} fields, expected 5`);
    const [name, version, url, sha256, spdx] = f;
    out.push({ name, version, url, sha256, spdx });
  }
  return out;
}

function readPins(root = ROOT) {
  return parsePins(fs.readFileSync(path.join(root, 'engine', 'build.sh'), 'utf8'));
}

// patchesFor(name): engine/patches/<name>-*.patch, sorted, as absolute paths (build.sh applies
// them in glob order, which is the same sort).
function patchesFor(name, root = ROOT) {
  const dir = path.join(root, 'engine', 'patches');
  let files;
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files
    .filter((f) => f.startsWith(`${name}-`) && f.endsWith('.patch'))
    .sort()
    .map((f) => path.join(dir, f));
}

// The exact Electron version that ships, from package-lock.json (package.json has a caret range).
function electronVersion(root = ROOT) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const e = lock.packages && lock.packages['node_modules/electron'];
  if (!e || !e.version) throw new Error('electron is missing from package-lock.json');
  return e.version;
}

module.exports = { parsePins, readPins, patchesFor, electronVersion, EMBEDDED };

if (require.main === module) {
  process.stdout.write(JSON.stringify(readPins(), null, 2) + '\n');
}
