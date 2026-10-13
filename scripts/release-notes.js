// Release body and pre-release flag from the build legs' signing markers (D-07).
// Each build leg of .github/workflows/release.yml uploads one marker,
// { name, platform: 'mac'|'win'|'linux', signed: true|false|null }; linux is null (not
// code-signed, covered by cosign and attestations). The release job runs:
//   node scripts/release-notes.js --markers <dir> --version <v> --out <notes.md>
// It writes the body to --out and `prerelease=true|false` to $GITHUB_OUTPUT (else stdout).
//
// A release is a pre-release when macOS or Windows came out unsigned, or the version is a
// release candidate. The notes say so plainly and never tell anyone to bypass Gatekeeper
// or SmartScreen.
const fs = require('fs');
const path = require('path');

const REPO = 'rick-rami94/spinarr';
const EXPECTED_MARKERS = 5;
const PLATFORMS = { mac: 'macOS', win: 'Windows', linux: 'Linux' };
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function validate(markers) {
  if (!Array.isArray(markers)) throw new Error('markers must be an array');
  if (markers.length !== EXPECTED_MARKERS) {
    throw new Error(`expected ${EXPECTED_MARKERS} signing markers, got ${markers.length}`);
  }
  const seen = new Set();
  for (const m of markers) {
    if (!m || typeof m.name !== 'string' || !m.name) throw new Error('signing marker without a name');
    if (seen.has(m.name)) throw new Error(`duplicate signing marker: ${m.name}`);
    seen.add(m.name);
    if (!Object.hasOwn(PLATFORMS, m.platform)) {
      throw new Error(`signing marker ${m.name} has unknown platform "${m.platform}"`);
    }
    if (m.platform === 'linux') {
      if (m.signed !== null) throw new Error(`signing marker ${m.name}: linux legs must report signed: null`);
    } else if (typeof m.signed !== 'boolean') {
      throw new Error(`signing marker ${m.name}: signed must be true or false for ${PLATFORMS[m.platform]}`);
    }
  }
}

function unsignedSection(unsigned) {
  const names = unsigned.map((p) => PLATFORMS[p]).join(' and ');
  const lines = [
    '## Unsigned build',
    '',
    `The ${names} ${unsigned.length > 1 ? 'installers in this release are' : 'installer in this release is'} not code-signed. This build is for testing only.`,
    '',
  ];
  if (unsigned.includes('mac')) {
    lines.push('- **macOS:** Gatekeeper will warn about or block the unsigned app. That warning is correct for this build.');
  }
  if (unsigned.includes('win')) {
    lines.push('- **Windows:** SmartScreen will warn about the unsigned installer. That warning is correct for this build.');
  }
  lines.push(
    '',
    'Signed releases are v0.2.0 and later. For everyday use, install a signed release.',
    'Spinarr will never ask you to turn your system\'s protections off.',
    '',
  );
  return lines;
}

function rcSection() {
  return [
    '## Release candidate',
    '',
    'This is a release candidate, not for general use. It exists to test the release pipeline and the installers before the final release.',
    '',
  ];
}

function verifySection(version, repo) {
  return [
    '## Verify this release',
    '',
    'Every file in this release is listed in `SHA256SUMS.txt`, which is signed with Sigstore and covered by GitHub build attestations.',
    '',
    '```sh',
    '# 1. Checksums (macOS: shasum -a 256 -c --ignore-missing SHA256SUMS.txt)',
    'sha256sum -c --ignore-missing SHA256SUMS.txt',
    '',
    '# 2. The checksum file was signed by this repository\'s release workflow',
    'cosign verify-blob --bundle SHA256SUMS.txt.sigstore.json \\',
    `  --certificate-identity https://github.com/${repo}/.github/workflows/release.yml@refs/tags/v${version} \\`,
    '  --certificate-oidc-issuer https://token.actions.githubusercontent.com \\',
    '  SHA256SUMS.txt',
    '',
    '# 3. Build provenance for any file you downloaded',
    `gh attestation verify <file> --repo ${repo}`,
    '```',
    '',
    `Details: https://github.com/${repo}/blob/main/docs/RELEASING.md#verifying-a-release`,
    '',
  ];
}

function signedNote() {
  return [
    '## Signing',
    '',
    '- The macOS app and `.dmg` are signed with a Developer ID and notarized by Apple.',
    '- The Windows installer and every program inside it are signed, with publisher **Rick Ramirez**. On early signed releases, Windows SmartScreen may still show an "unrecognized app" notice while the publisher builds reputation.',
    '',
  ];
}

// buildNotes({ version, markers, repo? }) -> { prerelease, body }
function buildNotes({ version, markers, repo = REPO }) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error(`bad release version "${version}" (expected X.Y.Z or X.Y.Z-suffix, no leading v)`);
  }
  validate(markers);

  const unsigned = ['mac', 'win'].filter((p) => markers.some((m) => m.platform === p && m.signed === false));
  const rc = version.includes('-');

  const lines = [];
  if (unsigned.length) lines.push(...unsignedSection(unsigned));
  if (rc) lines.push(...rcSection());
  if (!unsigned.length) lines.push(...signedNote());
  lines.push(...verifySection(version, repo));

  return { prerelease: unsigned.length > 0 || rc, body: lines.join('\n') };
}

function readMarkers(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch (err) {
        throw new Error(`signing marker ${f} is not valid JSON: ${err.message}`);
      }
    });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--markers', '--version', '--out'].includes(key) || i + 1 >= argv.length) {
      throw new Error('usage: node scripts/release-notes.js --markers <dir> --version <v> --out <notes.md>');
    }
    args[key.slice(2)] = argv[i + 1];
  }
  for (const k of ['markers', 'version', 'out']) {
    if (!args[k]) throw new Error(`missing --${k}`);
  }
  return args;
}

module.exports = { buildNotes, readMarkers };

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { prerelease, body } = buildNotes({ version: args.version, markers: readMarkers(args.markers) });
    fs.writeFileSync(args.out, body);
    const line = `prerelease=${prerelease}\n`;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
    else process.stdout.write(line);
  } catch (err) {
    console.error(`release-notes: ${err.message}`);
    process.exit(1);
  }
}
