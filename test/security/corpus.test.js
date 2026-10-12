// Replays every malicious/fuzzer-found DVD and Blu-ray structure through the shipped scanners.
// Each one must exit normally (no signal), print valid JSON, and never take more than 10 s.
// SPINARR_ENGINE_BIN=engine/bin-asan replays against the sanitizer build (`engine/build.sh asan`):
// then any AddressSanitizer/UBSan report fails the case, even if the scanner would exit 1 anyway.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n);
const SANITIZED = Boolean(process.env.SPINARR_ENGINE_BIN);
const BIN = SANITIZED ? path.resolve(process.env.SPINARR_ENGINE_BIN) : path.join(ROOT, 'engine', 'bin');
const SUITES = [
  { tool: path.join(BIN, exe('dvdinfo')), dir: path.join(ROOT, 'test', 'fixtures', 'malicious') },
  { tool: path.join(BIN, exe('bdinfo')), dir: path.join(ROOT, 'test', 'fixtures', 'malicious-bd') },
];
// Distinct sanitizer exit codes, so a memory error can never pass as the scanner's normal error exit 1.
const SPAWN = SANITIZED
  ? {
      timeout: 60000,
      env: {
        ...process.env,
        ASAN_OPTIONS: 'detect_leaks=0:exitcode=86:abort_on_error=0:symbolize=1',
        UBSAN_OPTIONS: 'print_stacktrace=1:halt_on_error=1:exitcode=87',
      },
    }
  : { timeout: 10000 };

for (const { tool, dir } of SUITES) for (const c of fs.readdirSync(dir).filter((d) => !d.startsWith('.')).sort()) {
  test(`malicious corpus (${path.basename(tool)}): ${c}`, () => {
    const r = spawnSync(tool, [path.join(dir, c)], { encoding: 'utf8', ...SPAWN });
    const stderr = (r.stderr || '').slice(0, 2000);
    assert.equal(r.error, undefined, String(r.error));
    assert.equal(r.signal, null, `${path.basename(tool)} was killed by ${r.signal}\n${stderr}`);
    assert.ok(![86, 87].includes(r.status), `sanitizer report (exit ${r.status})\n${stderr}`);
    assert.doesNotMatch(r.stderr || '', /ERROR: AddressSanitizer|runtime error:/, `sanitizer report\n${stderr}`);
    assert.ok([0, 1].includes(r.status), `exit ${r.status}`);
    const j = JSON.parse(r.stdout);
    assert.ok(j.error || Array.isArray(j.titles));
    for (const t of j.titles || []) {
      assert.ok(Number.isFinite(t.duration) && t.duration >= 0 && t.duration < 86400 * 2, `title ${t.title} duration ${t.duration}`);
      assert.ok(Number.isInteger(t.title) && t.title >= 1 && t.title <= 999);
    }
  });
}
