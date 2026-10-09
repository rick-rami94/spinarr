// Runs the real engine inside the real sandbox (macOS profile or Linux bubblewrap) and
// checks what a compromised engine could do: read your files, write outside the output
// folder. Skipped where there is no sandbox (Windows, or Linux without bubblewrap).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPlatform } = require('../../app/platform');

const ROOT = path.join(__dirname, '..', '..');
const ENGINE = path.join(ROOT, 'engine', 'bin');
const SOURCE = path.join(ROOT, 'test', 'fixtures', 'out', 'src', 'feat.mpg');
const platform = createPlatform({ run: async () => '', env: {} });
const skip = platform.sandboxKind === 'none' ? 'no engine sandbox on this system'
  : !fs.existsSync(SOURCE) ? 'run `npm run fixtures` first' : false;

const ffmpeg = (args, outDir) => {
  const [cmd, a] = platform.wrap(path.join(ENGINE, platform.exe('ffmpeg')), args, { engineDir: ENGINE, source: SOURCE, outDir });
  return spawnSync(cmd, a, { encoding: 'utf8', timeout: 30000, env: platform.engineEnv, detached: process.platform !== 'win32' });
};

test(`engine sandbox (${platform.sandboxKind})`, { skip }, async (t) => {
  // Inside the home folder: the macOS profile denies /Users, bubblewrap never mounts $HOME.
  const outside = fs.mkdtempSync(path.join(os.homedir(), '.spinarr-sandbox-test-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinarr-sandbox-out-'));
  const secret = path.join(outside, 'secret.mpg');
  fs.copyFileSync(SOURCE, secret);
  try {
    await t.test('cannot read files outside the source', () => {
      const r = ffmpeg(['-v', 'error', '-i', secret, '-f', 'null', '-'], outDir);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /Operation not permitted|Permission denied|No such file/);
    });
    await t.test('cannot write outside the output folder', () => {
      const target = path.join(outside, 'pwned.mkv');
      const r = ffmpeg(['-v', 'error', '-i', SOURCE, '-map', '0:v', '-c', 'copy', '-t', '1', '-y', target], outDir);
      assert.notEqual(r.status, 0);
      assert.equal(fs.existsSync(target), false);
    });
    await t.test('can read the source and write the rip', () => {
      const target = path.join(fs.realpathSync(outDir), 'ok.mkv');
      const r = ffmpeg(['-v', 'error', '-i', SOURCE, '-map', '0:v', '-c', 'copy', '-t', '1', '-y', target], outDir);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.statSync(target).size > 0);
    });
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
