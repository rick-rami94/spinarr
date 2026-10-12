// electron-builder Windows sign hook (package.json build.win.signtoolOptions.sign).
// Called once per file per hash for Spinarr.exe, every .exe in extraResources (the
// engine), and the NSIS installer and uninstaller.
//
// D-04 "build now, sign later": with no Azure configuration it is a silent no-op, so
// local builds, PR builds and the required `windows` CI check stay green and unsigned.
// D-07: with SPINARR_REQUIRE_SIGNING=1 (tag builds with credentials) it throws instead,
// so an unsigned build cannot pass as signed. electron-builder swallows per-file
// failures, so build/verify-win.ps1 re-checks every exe afterwards.
//
// win.azureSignOptions is deliberately not used: it runs an unpinned
// `Install-Module TrustedSigning -MinimumVersion`. build/sign-win.ps1 imports one exact
// module version instead.
const { execFileSync } = require('child_process');
const path = require('path');

// Keep in sync with the Install-Module -RequiredVersion in .github/workflows/release.yml
// (a unit test added in plan 02-11 enforces it).
const MODULE_VERSION = '0.1.20';
const SCRIPT = path.join(__dirname, 'sign-win.ps1');
const AZURE_VARS = ['AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE'];

async function signWith(config, { env, exec }) {
  // signingHashAlgorithms is ["sha256"]; never sign a legacy sha1 pass.
  if (config.hash && config.hash !== 'sha256') return undefined;

  const missing = AZURE_VARS.filter((name) => !env[name]);
  if (missing.length === AZURE_VARS.length) {
    if (env.SPINARR_REQUIRE_SIGNING === '1') {
      throw new Error(`Windows signing is required (SPINARR_REQUIRE_SIGNING=1) but Azure Artifact Signing is not configured: ${config.path}`);
    }
    return undefined;
  }
  if (missing.length) {
    throw new Error(`Azure Artifact Signing is half-configured: missing ${missing.join(', ')} (signing ${config.path})`);
  }

  // argv only: the path is one parameter to a script file, never spliced into a command.
  exec('pwsh', ['-NoProfile', '-NonInteractive', '-File', SCRIPT, '-ModuleVersion', MODULE_VERSION, '-File', config.path],
    { stdio: 'inherit' });
  return undefined;
}

async function sign(config) {
  return signWith(config, { env: process.env, exec: execFileSync });
}

module.exports = sign;
module.exports.signWith = signWith;
module.exports.MODULE_VERSION = MODULE_VERSION;
