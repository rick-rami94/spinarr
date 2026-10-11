// Guards legal neutrality: no tracked app or doc file links to a libdvdcss download or names
// VideoLAN as a place to download it (engine/ build sources are out of scope).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BAD = /libdvdcss[^\n]*https?:\/\/|https?:\/\/[^\s)]*libdvdcss|VideoLAN[^\n]*(dll|download)|(dll|download)[^\n]*VideoLAN/i;

test('no tracked app or doc file points users at a libdvdcss download', () => {
  const files = execFileSync('git', ['ls-files', 'README.md', 'SECURITY.md', 'CLAUDE.md', 'docs', 'app', '.github'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.ok(files.length > 0, 'git ls-files returned nothing');
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(path.join(ROOT, f)); } catch { continue; }
    if (buf.includes(0)) continue; // binary
    const m = BAD.exec(buf.toString('utf8'));
    assert.equal(m, null, `${f}: ${m?.[0]}`);
  }
});
