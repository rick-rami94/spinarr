// scripts/release-notes.js: per-platform signing markers -> release body + pre-release flag (D-07).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildNotes } = require('../../scripts/release-notes');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'release-notes.js');

function markers({ mac = true, win = true } = {}) {
  return [
    { name: 'macos-arm64', platform: 'mac', signed: mac },
    { name: 'macos-x64', platform: 'mac', signed: mac },
    { name: 'linux-x64', platform: 'linux', signed: null },
    { name: 'linux-arm64', platform: 'linux', signed: null },
    { name: 'windows-x64', platform: 'win', signed: win },
  ];
}

test('fully signed release is not a pre-release and carries verify commands', () => {
  const { prerelease, body } = buildNotes({ version: '0.2.0', markers: markers() });
  assert.equal(prerelease, false);
  assert.match(body, /## Verify this release/);
  assert.ok(body.includes('cosign verify-blob --bundle SHA256SUMS.txt.sigstore.json'));
  assert.ok(body.includes('--certificate-identity https://github.com/rick-rami94/spinarr/.github/workflows/release.yml@refs/tags/v0.2.0'));
  assert.ok(body.includes('--certificate-oidc-issuer https://token.actions.githubusercontent.com'));
  assert.ok(body.includes('gh attestation verify'));
  assert.ok(body.includes('--repo rick-rami94/spinarr'));
  assert.doesNotMatch(body, /Unsigned/);
  assert.doesNotMatch(body, /release candidate/i);
});

test('unsigned macOS makes a pre-release with an Unsigned build section first', () => {
  const { prerelease, body } = buildNotes({ version: '0.2.0', markers: markers({ mac: false }) });
  assert.equal(prerelease, true);
  assert.match(body, /^## Unsigned build/);
  const section = body.split('\n## ')[0];
  assert.match(section, /macOS/);
  assert.doesNotMatch(section, /Windows/);
  assert.match(section, /Gatekeeper/);
});

test('unsigned Windows names Windows and SmartScreen', () => {
  const { prerelease, body } = buildNotes({ version: '0.2.0', markers: markers({ win: false }) });
  assert.equal(prerelease, true);
  assert.match(body, /^## Unsigned build/);
  const section = body.split('\n## ')[0];
  assert.match(section, /Windows/);
  assert.match(section, /SmartScreen/);
  assert.doesNotMatch(section, /macOS/);
});

test('both unsigned names both platforms', () => {
  const { prerelease, body } = buildNotes({ version: '0.2.0', markers: markers({ mac: false, win: false }) });
  assert.equal(prerelease, true);
  const section = body.split('\n## ')[0];
  assert.match(section, /macOS/);
  assert.match(section, /Windows/);
});

test('notes never tell users to bypass OS protections', () => {
  for (const m of [markers(), markers({ mac: false }), markers({ win: false }), markers({ mac: false, win: false })]) {
    for (const version of ['0.2.0', '0.2.0-rc.1']) {
      const { body } = buildNotes({ version, markers: m });
      assert.doesNotMatch(body, /open anyway|run anyway|right-click|right click/i);
    }
  }
});

test('a -rc version is a pre-release and says so', () => {
  const { prerelease, body } = buildNotes({ version: '0.2.0-rc.1', markers: markers() });
  assert.equal(prerelease, true);
  assert.match(body, /release candidate/i);
  assert.match(body, /not for general use/i);
  assert.ok(body.includes('release.yml@refs/tags/v0.2.0-rc.1'));
});

test('linux markers with signed null never make a pre-release', () => {
  const { prerelease } = buildNotes({ version: '0.3.0', markers: markers() });
  assert.equal(prerelease, false);
});

test('fewer than five markers throws', () => {
  assert.throws(() => buildNotes({ version: '0.2.0', markers: markers().slice(0, 4) }), /expected 5 signing markers, got 4/);
});

test('a duplicate marker name throws', () => {
  const m = markers();
  m[1] = { ...m[0] };
  assert.throws(() => buildNotes({ version: '0.2.0', markers: m }), /duplicate signing marker: macos-arm64/);
});

test('an unknown platform throws', () => {
  const m = markers();
  m[4] = { name: 'windows-x64', platform: 'beos', signed: true };
  assert.throws(() => buildNotes({ version: '0.2.0', markers: m }), /unknown platform "beos"/);
});

test('a mac or win marker without a boolean signed value throws', () => {
  const m = markers();
  m[0] = { name: 'macos-arm64', platform: 'mac', signed: null };
  assert.throws(() => buildNotes({ version: '0.2.0', markers: m }), /macos-arm64.*signed/);
});

test('a bad version throws', () => {
  assert.throws(() => buildNotes({ version: 'v0.2.0', markers: markers() }), /version/);
  assert.throws(() => buildNotes({ version: '0.2.0;rm -rf', markers: markers() }), /version/);
});

test('CLI reads a marker dir, writes notes and appends prerelease to GITHUB_OUTPUT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-notes-'));
  try {
    const mdir = path.join(dir, 'markers');
    fs.mkdirSync(mdir);
    for (const m of markers({ win: false })) fs.writeFileSync(path.join(mdir, `signing-${m.name}.json`), JSON.stringify(m));
    fs.writeFileSync(path.join(mdir, 'ignore.txt'), 'not json');
    const out = path.join(dir, 'notes.md');
    const ghOut = path.join(dir, 'gh-output');
    fs.writeFileSync(ghOut, 'earlier=1\n');
    execFileSync(process.execPath, [SCRIPT, '--markers', mdir, '--version', '0.2.0', '--out', out], {
      env: { ...process.env, GITHUB_OUTPUT: ghOut },
    });
    assert.match(fs.readFileSync(out, 'utf8'), /^## Unsigned build/);
    assert.equal(fs.readFileSync(ghOut, 'utf8'), 'earlier=1\nprerelease=true\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI prints the flag when GITHUB_OUTPUT is unset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-notes-'));
  try {
    for (const m of markers()) fs.writeFileSync(path.join(dir, `${m.name}.json`), JSON.stringify(m));
    const env = { ...process.env };
    delete env.GITHUB_OUTPUT;
    const stdout = execFileSync(process.execPath, [SCRIPT, '--markers', dir, '--version', '0.2.0', '--out', path.join(dir, 'n.md')],
      { env, encoding: 'utf8' });
    assert.match(stdout, /prerelease=false/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
