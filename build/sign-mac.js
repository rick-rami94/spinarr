// electron-builder mac.sign hook (package.json build.mac.sign).
// electron-builder only calls it when a Developer ID identity was found, so unsigned
// builds never reach it. It runs before notarization.
//
// electron-builder gives the app bundle `entitlements` and every other file
// `entitlementsInherit`, so it cannot tell Electron helpers from engine binaries.
// This hook does: only Contents/Resources/engine/* gets entitlements.engine.plist
// (disable-library-validation). Everything else keeps electron-builder's choice (SF-6).
// Hardened runtime and the secure timestamp stay on every Mach-O; notarization needs both.
const path = require('path');

const ENGINE_PLIST = path.join(__dirname, 'entitlements.engine.plist');

// Contents/Resources/engine/<something>, with either separator. "engine-evil" never matches.
const ENGINE_RE = /[\\/]Contents[\\/]Resources[\\/]engine[\\/][^\\/]/;

function isEnginePath(filePath) {
  return typeof filePath === 'string' && ENGINE_RE.test(filePath);
}

function wrapOptions(opts) {
  const base = opts.optionsForFile;
  return (filePath) => {
    const o = base(filePath);
    if (!isEnginePath(filePath)) return o;
    return { ...o, entitlements: ENGINE_PLIST, hardenedRuntime: true };
  };
}

async function sign(opts /* , packager */) {
  opts.optionsForFile = wrapOptions(opts);
  // Use the osx-sign electron-builder bundles, so the options shape matches. Required
  // here, not at the top, so the unit tests load on Linux and Windows.
  const osxSign = require(require.resolve('@electron/osx-sign', { paths: [require.resolve('app-builder-lib')] }));
  return osxSign.signAsync(opts); // opts.identity is the identity electron-builder chose
}

module.exports = sign;
module.exports.ENGINE_PLIST = ENGINE_PLIST;
module.exports.isEnginePath = isEnginePath;
module.exports.wrapOptions = wrapOptions;
