// SF-6: only the engine may disable library validation. The app and the Electron
// helpers get allow-jit and nothing else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', '..', 'build');
const read = (name) => fs.readFileSync(path.join(BUILD, name), 'utf8');
// Strip XML comments so a comment that mentions a key never counts as granting it.
const keys = (name) => read(name).replace(/<!--[\s\S]*?-->/g, '');

const DLV = 'com.apple.security.cs.disable-library-validation';
const JIT = 'com.apple.security.cs.allow-jit';
const DYLD = 'com.apple.security.cs.allow-dyld-environment-variables';

for (const name of ['entitlements.mac.plist', 'entitlements.mac.inherit.plist']) {
  test(`${name} grants allow-jit only`, () => {
    const k = keys(name);
    assert.ok(k.includes(`<key>${JIT}</key>`), `${name} must keep allow-jit`);
    assert.ok(!k.includes('disable-library-validation'), `${name} must not disable library validation`);
    assert.ok(!k.includes('allow-dyld'), `${name} must not allow DYLD variables`);
    assert.equal((k.match(/<key>/g) || []).length, 1, `${name} must hold exactly one key`);
  });
}

test('entitlements.engine.plist grants disable-library-validation only', () => {
  const k = keys('entitlements.engine.plist');
  assert.ok(k.includes(`<key>${DLV}</key>`));
  assert.ok(!k.includes('allow-jit'));
  assert.ok(!k.includes('allow-dyld'));
  assert.ok(!k.includes(DYLD));
  assert.equal((k.match(/<key>/g) || []).length, 1);
});

test('every entitlement plist is a well-formed Apple plist', () => {
  for (const name of ['entitlements.mac.plist', 'entitlements.mac.inherit.plist', 'entitlements.engine.plist']) {
    const t = read(name);
    assert.ok(t.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), name);
    assert.ok(t.includes('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"'), name);
    assert.ok(/<plist version="1.0">\s*<dict>[\s\S]*<\/dict>\s*<\/plist>\s*$/.test(t), name);
  }
});
