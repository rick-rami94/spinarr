// Replays every malicious/fuzzer-found DVD and Blu-ray structure through the shipped scanners.
// Each one must exit normally (no signal), print valid JSON, and never take more than 10 s.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SUITES = [
  { tool: path.join(ROOT, 'engine', 'bin', 'dvdinfo'), dir: path.join(ROOT, 'test', 'fixtures', 'malicious') },
  { tool: path.join(ROOT, 'engine', 'bin', 'bdinfo'), dir: path.join(ROOT, 'test', 'fixtures', 'malicious-bd') },
];

for (const { tool, dir } of SUITES) for (const c of fs.readdirSync(dir).filter((d) => !d.startsWith('.')).sort()) {
  test(`malicious corpus (${path.basename(tool)}): ${c}`, () => {
    const r = spawnSync(tool, [path.join(dir, c)], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.error, undefined, String(r.error));
    assert.equal(r.signal, null, `dvdinfo was killed by ${r.signal}`);
    assert.ok([0, 1].includes(r.status), `exit ${r.status}`);
    const j = JSON.parse(r.stdout);
    assert.ok(j.error || Array.isArray(j.titles));
    for (const t of j.titles || []) {
      assert.ok(Number.isFinite(t.duration) && t.duration >= 0 && t.duration < 86400 * 2, `title ${t.title} duration ${t.duration}`);
      assert.ok(Number.isInteger(t.title) && t.title >= 1 && t.title <= 999);
    }
  });
}
