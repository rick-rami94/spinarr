// Static invariants for .github/workflows/release.yml and ci.yml. Text and regex only (no YAML
// dependency), in the style of gate-static.test.js. These lock in the supply-chain rules
// (SHA pins, no caches, least privilege) and the release trust-chain order (REL-01..REL-04).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const read = (name) => fs.readFileSync(path.join(WF_DIR, name), 'utf8').replace(/\r\n/g, '\n');
const RELEASE = read('release.yml');
const CI = read('ci.yml');
const { MODULE_VERSION } = require('../../build/sign-win');

const lines = (text) => text.split('\n');
const indent = (line) => line.match(/^ */)[0].length;
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

// The text of jobs.<id>: from its header line to the next job header (or EOF).
function job(text, id) {
  const start = text.search(new RegExp(`^  ${id}:\\s*$`, 'm'));
  if (start < 0) return null;
  const rest = text.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:\s*$/m);
  const end = next < 0 ? text.length : start + 1 + next;
  return { start, end, text: text.slice(start, end) };
}

// Every run: body, inline or block scalar, with its starting line number.
function runBlocks(text) {
  const out = [];
  const ls = lines(text);
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!m) continue;
    const base = indent(ls[i]);
    if (!/^[|>][-+]?\s*$/.test(m[2])) {
      out.push({ line: i + 1, body: m[2] });
      continue;
    }
    const body = [];
    for (let j = i + 1; j < ls.length; j++) {
      if (ls[j].trim() !== '' && indent(ls[j]) <= base) break;
      body.push(ls[j]);
    }
    out.push({ line: i + 1, body: body.join('\n') });
  }
  return out;
}

const indexAll = (text, needle) => {
  const out = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
};

test('release.yml restores no caches', () => {
  assert.doesNotMatch(RELEASE, /actions\/cache/);
  assert.doesNotMatch(RELEASE, /cache:\s*npm/);
  assert.doesNotMatch(RELEASE, /^\s*cache:/m, 'no cache: key at all');
  for (const m of RELEASE.matchAll(/package-manager-cache:\s*(\S+)/g)) assert.equal(m[1], 'false');
});

test('top-level permissions are contents: read only', () => {
  for (const [name, text] of [['release.yml', RELEASE], ['ci.yml', CI]]) {
    const head = text.slice(0, text.search(/^jobs:/m));
    const m = head.match(/^permissions:\n((?: {2}.*\n)+)/m);
    assert.ok(m, `${name}: top-level permissions block`);
    assert.equal(m[1].trim(), 'contents: read', `${name}: top-level permissions`);
  }
});

test('write permissions for releases and attestations exist only on the release job', () => {
  const rel = job(RELEASE, 'release');
  assert.ok(rel, 'release job exists');
  for (const perm of ['contents: write', 'id-token: write', 'attestations: write']) {
    const hits = indexAll(RELEASE, perm);
    assert.ok(hits.length > 0, `${perm} is granted`);
    if (perm === 'id-token: write') {
      // The build job also needs id-token for azure/login OIDC (Entra subject is pinned to
      // environment:release), but nothing that can write the repo or attestations.
      const build = job(RELEASE, 'build');
      for (const i of hits) {
        assert.ok((i >= rel.start && i < rel.end) || (i >= build.start && i < build.end), `${perm} at line ${lineOf(RELEASE, i)}`);
      }
    } else {
      for (const i of hits) assert.ok(i >= rel.start && i < rel.end, `${perm} outside the release job at line ${lineOf(RELEASE, i)}`);
    }
  }
  const build = job(RELEASE, 'build').text;
  assert.doesNotMatch(build, /contents: write|attestations: write/);
  assert.match(rel.text, /permissions:\n {6}contents: write\n {6}id-token: write\n {6}attestations: write\n/);
  assert.doesNotMatch(rel.text, /^ {4}environment:/m, 'the release job needs no signing secrets');
});

test('every action in release.yml and ci.yml is pinned to a full SHA with a version comment', () => {
  for (const [name, text] of [['release.yml', RELEASE], ['ci.yml', CI]]) {
    const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(.+)$/gm)];
    assert.ok(uses.length > 0, `${name} has uses:`);
    for (const m of uses) assert.match(m[1], /@[0-9a-f]{40} # v\d/, `${name}: ${m[1]}`);
  }
});

test('no workflow uses pull_request_target', () => {
  for (const f of fs.readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    assert.doesNotMatch(read(f), /pull_request_target/, f);
  }
});

test('no ${{ }} expression inside a run: block of release.yml', () => {
  const blocks = runBlocks(RELEASE);
  assert.ok(blocks.length > 5, 'found the run blocks');
  for (const b of blocks) assert.ok(!b.body.includes('${{'), `expression in run: at line ${b.line}`);
});

test('legacy signing inputs are gone', () => {
  for (const bad of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'WIN_CSC_', 'azureSignOptions']) {
    assert.ok(!RELEASE.includes(bad), `release.yml still mentions ${bad}`);
  }
});

test('ArtifactSigning RequiredVersion equals MODULE_VERSION in build/sign-win.js', () => {
  const m = [...RELEASE.matchAll(/Install-Module\s+-Name\s+ArtifactSigning\s+-RequiredVersion\s+(\S+)/g)];
  assert.equal(m.length, 1, 'exactly one pinned ArtifactSigning install');
  assert.equal(m[0][1], MODULE_VERSION);
});

test('signed legs force signing and assert the result', () => {
  const build = job(RELEASE, 'build').text;
  assert.match(build, /forceCodeSigning=true/);
  assert.match(build, /SPINARR_REQUIRE_SIGNING=1/);
  assert.match(build, /sh build\/verify-mac\.sh dist/);
  assert.match(build, /build\/verify-win\.ps1 -Dist dist/);
  assert.match(build, /xcrun stapler staple/);
  assert.match(build, /environment: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) && matrix\.sign != 'none' && 'release' \|\| '' \}\}/);
  assert.match(build, /name: signing-\$\{\{ matrix\.name \}\}/);
});

test('notarytool appears only in the build job', () => {
  const build = job(RELEASE, 'build');
  const hits = indexAll(RELEASE, 'notarytool');
  assert.ok(hits.length > 0);
  for (const i of hits) assert.ok(i >= build.start && i < build.end, `notarytool at line ${lineOf(RELEASE, i)}`);
});

test('release job: SBOM and source, then checksums, then cosign, then attest, then a draft upload last', () => {
  const rel = job(RELEASE, 'release').text;
  const at = (needle) => {
    const i = rel.indexOf(needle);
    assert.ok(i >= 0, `release job has ${needle}`);
    return i;
  };
  const sbom = at('name: SBOM');
  const source = at('name: Source bundle');
  const checksums = at('name: Checksums');
  const cosign = at('cosign sign-blob --yes --bundle');
  const attest = at('actions/attest@');
  const verify = at('name: Self-verify');
  const upload = at('softprops/action-gh-release@');

  assert.ok(sbom < checksums && source < checksums, 'SBOM and source bundle are checksummed');
  assert.ok(checksums < cosign, 'cosign signs after the Checksums step');
  assert.ok(cosign < attest, 'cosign signs before actions/attest');
  assert.ok(sbom < attest && source < attest, 'attest after the SBOM and Source bundle steps');
  assert.equal(indexAll(rel, 'subject-checksums: out/SHA256SUMS.txt').length, 2, 'provenance and SBOM attestations');
  assert.ok(rel.lastIndexOf('actions/attest@') < verify && verify < upload, 'self-verify before upload');

  const steps = indexAll(rel, '\n      - ');
  assert.ok(steps[steps.length - 1] < upload && upload - steps[steps.length - 1] < 20, 'the softprops step is last');
  const last = rel.slice(upload);
  assert.match(last, /draft: true/);
  assert.match(last, /body_path: notes\.md/);
  assert.match(last, /prerelease: \$\{\{ steps\.notes\.outputs\.prerelease \}\}/);
});

test('ci.yml required job ids exist with no name: key and no paths: filter', () => {
  const head = CI.slice(0, CI.search(/^jobs:/m));
  assert.doesNotMatch(head, /^\s*paths(-ignore)?:/m, 'no paths filter on CI triggers');
  for (const id of ['macos', 'linux', 'windows', 'audit', 'asan']) {
    const j = job(CI, id);
    assert.ok(j, `ci.yml job ${id}`);
    assert.doesNotMatch(j.text, /^ {4}name:/m, `${id} must not have a name: key`);
    assert.doesNotMatch(j.text, /^\s*paths(-ignore)?:/m, `${id} must not have a paths filter`);
  }
});
