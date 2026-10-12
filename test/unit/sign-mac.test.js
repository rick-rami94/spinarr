// Unit tests for build/sign-mac.js, the electron-builder mac.sign hook (SF-6).
// The hook never runs here: osx-sign is required lazily, so this loads on any OS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const signMac = require('../../build/sign-mac.js');

const BASE = Object.freeze({
  entitlements: 'APP_OR_INHERIT',
  hardenedRuntime: true,
  timestamp: 'ts',
  requirements: 'req',
  additionalArguments: ['--x'],
});

function fakeOpts() {
  const seen = [];
  return {
    seen,
    opts: {
      optionsForFile: (filePath) => {
        seen.push(filePath);
        return { ...BASE, additionalArguments: [...BASE.additionalArguments] };
      },
    },
  };
}

test('exports the hook and its helpers', () => {
  assert.equal(typeof signMac, 'function');
  assert.equal(typeof signMac.wrapOptions, 'function');
  assert.equal(typeof signMac.isEnginePath, 'function');
  assert.equal(signMac.ENGINE_PLIST, path.join(__dirname, '..', '..', 'build', 'entitlements.engine.plist'));
});

test('isEnginePath matches only binaries inside Contents/Resources/engine/', () => {
  const table = [
    ['/x/Spinarr.app/Contents/Resources/engine/ffmpeg', true],
    ['/x/Spinarr.app/Contents/Resources/engine/dvdinfo', true],
    ['C:\\x\\Spinarr.app\\Contents\\Resources\\engine\\ffmpeg', true],
    ['/x/Spinarr.app', false],
    ['/x/Spinarr.app/Contents/Frameworks/Spinarr Helper.app', false],
    ['/x/Spinarr.app/Contents/Frameworks/Electron Framework.framework', false],
    ['/x/Spinarr.app/Contents/Resources/engine-evil/x', false],
    ['/x/Spinarr.app/Contents/Resources/engine', false],
    ['/x/Spinarr.app/Contents/Resources/app.asar', false],
    ['/x/Spinarr.app/Contents/MacOS/Spinarr', false],
    ['', false],
    [undefined, false],
  ];
  for (const [p, want] of table) assert.equal(signMac.isEnginePath(p), want, String(p));
});

test('wrapOptions gives engine binaries the engine plist and keeps the rest of the base options', () => {
  const { opts, seen } = fakeOpts();
  const wrapped = signMac.wrapOptions(opts);
  const p = '/x/Spinarr.app/Contents/Resources/engine/ffmpeg';
  const o = wrapped(p);
  assert.deepEqual(seen, [p]);
  assert.equal(o.entitlements, signMac.ENGINE_PLIST);
  assert.equal(o.hardenedRuntime, true);
  assert.equal(o.timestamp, 'ts');
  assert.equal(o.requirements, 'req');
  assert.deepEqual(o.additionalArguments, ['--x']);
});

test('wrapOptions forces hardened runtime on engine binaries even if the base said otherwise', () => {
  const wrapped = signMac.wrapOptions({ optionsForFile: () => ({ ...BASE, hardenedRuntime: false }) });
  assert.equal(wrapped('/x/Spinarr.app/Contents/Resources/engine/bdinfo').hardenedRuntime, true);
});

test('wrapOptions leaves the app, helpers, frameworks and look-alike paths untouched', () => {
  for (const p of [
    '/x/Spinarr.app',
    '/x/Spinarr.app/Contents/Frameworks/Spinarr Helper.app',
    '/x/Spinarr.app/Contents/Frameworks/Spinarr Helper (Renderer).app',
    '/x/Spinarr.app/Contents/Resources/engine-evil/x',
    '/x/Spinarr.app/Contents/Resources/app.asar',
  ]) {
    const { opts } = fakeOpts();
    const o = signMac.wrapOptions(opts)(p);
    assert.deepEqual(o, { ...BASE, additionalArguments: ['--x'] }, p);
    assert.notEqual(o.entitlements, signMac.ENGINE_PLIST, p);
  }
});

test('wrapOptions does not mutate the original optionsForFile', () => {
  const { opts } = fakeOpts();
  const original = opts.optionsForFile;
  signMac.wrapOptions(opts);
  assert.equal(opts.optionsForFile, original);
});

test('requiring the hook does not load @electron/osx-sign', () => {
  const loaded = Object.keys(require.cache).some((k) => k.includes(`${path.sep}@electron${path.sep}osx-sign${path.sep}`));
  assert.equal(loaded, false);
});
