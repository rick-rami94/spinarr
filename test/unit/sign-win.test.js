// Unit tests for build/sign-win.js, the electron-builder win.signtoolOptions.sign hook.
// exec is injected, so no pwsh or Azure account is needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const signWin = require('../../build/sign-win.js');

const PS1 = path.join(__dirname, '..', '..', 'build', 'sign-win.ps1');
const AZURE = Object.freeze({
  AZURE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
  AZURE_SIGNING_ACCOUNT: 'spinarr',
  AZURE_CERT_PROFILE: 'spinarr-public',
});

function spy() {
  const calls = [];
  const exec = (...args) => { calls.push(args); };
  return { calls, exec };
}

test('exports the hook, signWith and the pinned module version', () => {
  assert.equal(typeof signWin, 'function');
  assert.equal(typeof signWin.signWith, 'function');
  assert.equal(signWin.MODULE_VERSION, '0.1.20');
});

test('no Azure configuration: silent no-op (build now, sign later)', async () => {
  const { calls, exec } = spy();
  assert.equal(await signWin.signWith({ path: 'C:\\x\\Spinarr.exe' }, { env: {}, exec }), undefined);
  assert.equal(calls.length, 0);
});

test('SPINARR_REQUIRE_SIGNING=1 without Azure configuration throws, naming the file', async () => {
  const { calls, exec } = spy();
  await assert.rejects(
    signWin.signWith({ path: 'C:\\x\\Spinarr.exe' }, { env: { SPINARR_REQUIRE_SIGNING: '1' }, exec }),
    (e) => e instanceof Error && /signing (is )?required/i.test(e.message) && e.message.includes('C:\\x\\Spinarr.exe'),
  );
  assert.equal(calls.length, 0);
});

test('half-configured Azure signing throws, naming the missing variables', async () => {
  const cases = [
    [{ AZURE_SIGNING_ENDPOINT: AZURE.AZURE_SIGNING_ENDPOINT }, ['AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE']],
    [{ AZURE_SIGNING_ENDPOINT: AZURE.AZURE_SIGNING_ENDPOINT, AZURE_SIGNING_ACCOUNT: 'a' }, ['AZURE_CERT_PROFILE']],
    [{ AZURE_CERT_PROFILE: 'p' }, ['AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT']],
  ];
  for (const [env, missing] of cases) {
    const { calls, exec } = spy();
    await assert.rejects(signWin.signWith({ path: 'C:\\x\\a.exe' }, { env, exec }), (e) => {
      for (const m of missing) assert.ok(e.message.includes(m), `${e.message} should name ${m}`);
      return /half-configured/.test(e.message);
    });
    assert.equal(calls.length, 0);
  }
});

test('fully configured: one pwsh call with an argv array and the pinned module version', async () => {
  const { calls, exec } = spy();
  const config = { path: 'C:\\x\\Spinarr.exe', hash: 'sha256' };
  await signWin.signWith(config, { env: { ...AZURE }, exec });
  assert.equal(calls.length, 1);
  const [cmd, argv, opts] = calls[0];
  assert.equal(cmd, 'pwsh');
  assert.ok(Array.isArray(argv));
  assert.deepEqual(argv, ['-NoProfile', '-NonInteractive', '-File', PS1, '-ModuleVersion', '0.1.20', '-File', config.path]);
  assert.ok(path.isAbsolute(argv[3]) && argv[3].endsWith(path.join('build', 'sign-win.ps1')));
  assert.equal(opts.stdio, 'inherit');
  assert.notEqual(opts.shell, true);
});

test('hostile file paths reach pwsh as one unmodified argv element', async () => {
  const evil = 'C:\\dist dir\\a; Remove-Item -Recurse C:\\ $(whoami) `calc` "q" \'s\'.exe';
  const { calls, exec } = spy();
  await signWin.signWith({ path: evil }, { env: { ...AZURE }, exec });
  const argv = calls[0][1];
  assert.equal(argv[argv.length - 1], evil);
  assert.equal(argv.filter((a) => a === evil).length, 1);
  assert.equal(argv.length, 8);
});

test('only sha256 is signed', async () => {
  for (const [hash, want] of [['sha1', 0], ['sha256', 1], [undefined, 1]]) {
    const { calls, exec } = spy();
    assert.equal(await signWin.signWith({ path: 'C:\\x\\a.exe', hash }, { env: { ...AZURE }, exec }), undefined);
    assert.equal(calls.length, want, String(hash));
  }
});

test('the sha1 pass never calls pwsh, even on a required-signing build', async () => {
  const { calls, exec } = spy();
  await signWin.signWith({ path: 'C:\\x\\a.exe', hash: 'sha1' }, { env: { ...AZURE, SPINARR_REQUIRE_SIGNING: '1' }, exec });
  assert.equal(calls.length, 0);
});

test('sign-win.ps1 imports the pinned module and never installs one', () => {
  const ps = fs.readFileSync(PS1, 'utf8');
  assert.ok(ps.includes('Import-Module ArtifactSigning -RequiredVersion $ModuleVersion'));
  assert.ok(!/Install-Module/i.test(ps));
  assert.ok(ps.includes('Invoke-ArtifactSigning'));
  assert.ok(ps.includes('Get-AuthenticodeSignature'));
  assert.ok(ps.includes("$ErrorActionPreference = 'Stop'"));
});
