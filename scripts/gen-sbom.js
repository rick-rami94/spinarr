// Writes a CycloneDX 1.6 SBOM for a Spinarr release from the engine pin table (REL-03, D-15):
//   node scripts/gen-sbom.js --version <v> --out <file>
// The engine pins (engine/build.sh via scripts/pins.js), the local patches and the locked
// Electron version are the real bill of materials. Output is deterministic: no serialNumber,
// and the timestamp comes from SOURCE_DATE_EPOCH (else the HEAD commit time).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pins = require('./pins');

const ROOT = path.join(__dirname, '..');

const license = (id) => [{ license: { id } }];
const genericPurl = (name, version, url) => `pkg:generic/${name}@${version}?download_url=${encodeURIComponent(url)}`;

function pedigree(list) {
  if (!list || list.length === 0) return {};
  return { pedigree: { patches: list.map((p) => ({ type: 'unofficial', diff: { text: { content: p.text, contentType: 'text/x-diff' } } })) } };
}

// buildSbom({ version, pins, embedded, electron, patches: { name: [{ file, text }] }, sourceDateEpoch, toolchain })
function buildSbom(input) {
  const { version, embedded = [], electron, patches = {}, sourceDateEpoch, toolchain = {} } = input;
  const appPurl = `pkg:github/rick-rami94/spinarr@v${version}`;
  const deps = [];

  const components = input.pins.map((p) => {
    const purl = genericPurl(p.name, p.version, p.url);
    const nested = embedded.filter((e) => e.parent === p.name).map((e) => {
      const ePurl = `pkg:generic/${e.name}@${e.version}`;
      return {
        type: 'library', 'bom-ref': ePurl, name: e.name, version: e.version,
        licenses: license(e.spdx), purl: ePurl,
        externalReferences: [{ type: 'vcs', url: e.url }],
        ...pedigree(patches[e.name]),
      };
    });
    const c = {
      type: 'library', 'bom-ref': purl, name: p.name, version: p.version,
      licenses: license(p.spdx), purl,
      hashes: [{ alg: 'SHA-256', content: p.sha256 }],
      externalReferences: [{ type: 'distribution', url: p.url, hashes: [{ alg: 'SHA-256', content: p.sha256 }] }],
      ...pedigree(patches[p.name]),
    };
    if (nested.length) {
      c.components = nested;
      deps.push({ ref: purl, dependsOn: nested.map((n) => n['bom-ref']) });
    }
    return c;
  });

  const ePurl = `pkg:npm/electron@${electron}`;
  components.push({
    type: 'framework', 'bom-ref': ePurl, name: 'electron', version: electron,
    licenses: license('MIT'), purl: ePurl,
    externalReferences: [{ type: 'website', url: 'https://www.electronjs.org/' }],
    ...pedigree(patches.electron),
  });

  for (const c of components) {
    if (/dvdcss|aacs|bdplus/i.test(c.name)) throw new Error(`refusing to list decryption library ${c.name}`);
  }

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      timestamp: new Date(sourceDateEpoch * 1000).toISOString(),
      component: {
        type: 'application', 'bom-ref': appPurl, name: 'spinarr', version,
        licenses: license('GPL-3.0-or-later'), purl: appPurl,
        externalReferences: [{ type: 'vcs', url: 'https://github.com/rick-rami94/spinarr' }],
      },
      properties: Object.keys(toolchain).sort().map((k) => ({ name: `spinarr:build:${k}`, value: String(toolchain[k]) })),
    },
    components,
    dependencies: [{ ref: appPurl, dependsOn: components.map((c) => c['bom-ref']) }, ...deps],
  };
}

module.exports = { buildSbom };

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function toolchain() {
  const out = {};
  try { out.node = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim(); } catch { /* optional */ }
  try {
    const m = /^meson==(\S+)/m.exec(fs.readFileSync(path.join(ROOT, '.github', 'requirements-build.txt'), 'utf8'));
    if (m) out.meson = m[1];
  } catch { /* optional */ }
  return out;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const version = arg(argv, '--version');
  const out = arg(argv, '--out');
  if (!version || !out) {
    console.error('usage: gen-sbom.js --version <v> --out <file>');
    process.exit(2);
  }
  let sde = process.env.SOURCE_DATE_EPOCH;
  if (!sde) sde = execFileSync('git', ['log', '-1', '--format=%ct', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(sde)) { console.error(`bad SOURCE_DATE_EPOCH: ${sde}`); process.exit(2); }
  const list = pins.readPins(ROOT);
  const patches = {};
  for (const p of list) {
    const files = pins.patchesFor(p.name, ROOT);
    if (files.length) patches[p.name] = files.map((f) => ({ file: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
  }
  const sbom = buildSbom({
    version, pins: list, embedded: pins.EMBEDDED, electron: pins.electronVersion(ROOT),
    patches, sourceDateEpoch: Number(sde), toolchain: toolchain(),
  });
  fs.writeFileSync(out, JSON.stringify(sbom, null, 2) + '\n');
  console.log(`wrote ${out} (${sbom.components.length} components)`);
}
