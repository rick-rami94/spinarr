// Checks the GPL corresponding-source bundle (REL-04, D-14): contents, upstream checksums and
// byte-for-byte determinism. The full run needs GNU tar and the pinned engine tarballs in
// engine/deps/ (the linux CI job has both after `npm run engine`), so it skips elsewhere to keep
// `npm run test:unit` offline and fast on dev machines.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPins } = require('../../scripts/pins');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'source-bundle.sh');
const VER = '0.0.0-test';
const P = `spinarr-${VER}`;
const DECRYPT = /^lib(dvdcss|aacs|bdplus)[^/]*\.(dll|dylib|so(\.[0-9]+)*)$/i;

function gnuTar() {
  for (const t of ['gtar', 'tar']) {
    const r = spawnSync(t, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /GNU tar/.test(r.stdout)) return t;
  }
  return null;
}

function skipReason() {
  if (process.platform === 'win32') return 'source bundle is built on Linux/macOS only';
  if (!gnuTar()) return 'needs GNU tar (macOS: brew install gnu-tar)';
  const missing = readPins().filter((p) => !fs.existsSync(path.join(ROOT, 'engine', 'deps', `${p.name}-${p.version}.tar.xz`)));
  if (missing.length) return `engine tarballs not fetched (${missing.map((p) => p.name).join(', ')}): run sh engine/build.sh fetch`;
  return null;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function build(outDir) {
  execFileSync('sh', [SCRIPT, VER, outDir], {
    cwd: ROOT, env: { ...process.env, SPINARR_SOURCE_REF: 'HEAD' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return path.join(outDir, `${P}-source.tar.gz`);
}

test('source bundle is complete, verified and deterministic', (t) => {
  const reason = skipReason();
  if (reason) { t.skip(reason); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-bundle-'));
  try {
    const a = build(fs.mkdtempSync(path.join(tmp, 'a-')));
    const b = build(fs.mkdtempSync(path.join(tmp, 'b-')));
    assert.equal(sha256(a), sha256(b), 'two runs on the same ref differ');
    assert.ok(fs.statSync(a).size < 50 * 1024 * 1024, 'bundle is over 50 MB');

    const entries = execFileSync('tar', ['-tzf', a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean);
    for (const e of entries) assert.ok(e === `${P}/` || e.startsWith(`${P}/`), `entry outside ${P}/: ${e}`);
    const set = new Set(entries);
    for (const f of ['package.json', 'BUILDING.md', 'THIRD_PARTY_NOTICES.txt', 'engine/build.sh', 'scripts/source-bundle.sh']) {
      assert.ok(set.has(`${P}/${f}`), `missing ${f}`);
    }
    const patches = execFileSync('git', ['ls-files', 'engine/patches'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter((f) => f.endsWith('.patch'));
    assert.ok(patches.length > 0, 'no tracked engine patches');
    for (const f of patches) assert.ok(set.has(`${P}/${f}`), `missing ${f}`);

    const pins = readPins();
    const upstream = entries.filter((e) => e.startsWith(`${P}/engine/upstream/`) && !e.endsWith('/'));
    assert.deepEqual(
      upstream.map((e) => path.basename(e)).sort(),
      pins.map((p) => `${p.name}-${p.version}.tar.xz`).sort(),
      'engine/upstream/ must hold exactly the pinned tarballs',
    );
    for (const e of entries) assert.doesNotMatch(path.basename(e), DECRYPT, `decryption library in bundle: ${e}`);

    const x = fs.mkdtempSync(path.join(tmp, 'x-'));
    execFileSync('tar', ['-xzf', a, '-C', x, `${P}/engine/upstream`]);
    for (const p of pins) {
      const file = path.join(x, P, 'engine', 'upstream', `${p.name}-${p.version}.tar.xz`);
      assert.equal(sha256(file), p.sha256, `${p.name} tarball does not match its pin`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('source bundle refuses to run when engine/build.sh differs from the ref', (t) => {
  if (process.platform === 'win32') { t.skip('source bundle is built on Linux/macOS only'); return; }
  // A throwaway repo holding just the script and build.sh, committed, then build.sh edited.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-bundle-ref-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.mkdirSync(path.join(tmp, 'engine'));
    fs.copyFileSync(SCRIPT, path.join(tmp, 'scripts', 'source-bundle.sh'));
    fs.copyFileSync(path.join(ROOT, 'engine', 'build.sh'), path.join(tmp, 'engine', 'build.sh'));
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
      '-c', 'commit.gpgsign=false', ...args], { cwd: tmp, stdio: 'pipe' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    fs.appendFileSync(path.join(tmp, 'engine', 'build.sh'), '# local edit\n');
    const r = spawnSync('sh', [path.join(tmp, 'scripts', 'source-bundle.sh'), VER, path.join(tmp, 'out')], {
      cwd: tmp, env: { ...process.env, SPINARR_SOURCE_REF: 'HEAD' }, encoding: 'utf8',
    });
    assert.notEqual(r.status, 0, 'script should fail');
    assert.match(r.stderr, /engine\/build\.sh differs from HEAD; check out HEAD first/);
    assert.equal(fs.existsSync(path.join(tmp, 'out', `${P}-source.tar.gz`)), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
