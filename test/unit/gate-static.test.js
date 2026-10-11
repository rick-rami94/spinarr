// Pins the renderer's scan chokepoint: every scan goes through requestScan, and only the
// "Scan anyway" click can send { userConfirmed: true } to main.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'app.js'), 'utf8');

// [start, end) of `function name(` through its closing brace, found by brace counting.
function body(name) {
  const m = new RegExp(`function ${name}\\(`).exec(SRC);
  if (!m) return null;
  const open = SRC.indexOf('{', SRC.indexOf(')', m.index));
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return [m.index, i + 1];
  }
  return null;
}
const indexes = (needle) => {
  const out = [];
  for (let i = SRC.indexOf(needle); i !== -1; i = SRC.indexOf(needle, i + 1)) out.push(i);
  return out;
};
const inside = (i, range) => !!range && i >= range[0] && i < range[1];
const lineAt = (i) => SRC.slice(SRC.lastIndexOf('\n', i) + 1, SRC.indexOf('\n', i) === -1 ? SRC.length : SRC.indexOf('\n', i));
const isDef = (i, name) => SRC.slice(Math.max(0, i - 9), i) === 'function ' && SRC.startsWith(`${name}(`, i);
const calls = (name) => indexes(`${name}(`).filter((i) => !/[\w$.]/.test(SRC[i - 1] || '') && !isDef(i, name));

test('spinarr.scan( appears once, inside loadSource', () => {
  const hits = indexes('spinarr.scan(');
  assert.equal(hits.length, 1, 'spinarr.scan( must appear exactly once');
  assert.ok(inside(hits[0], body('loadSource')), 'spinarr.scan( must be inside loadSource');
});

test('loadSource is only called from requestScan or confirmScan', () => {
  const allowed = [body('requestScan'), body('confirmScan')];
  assert.ok(allowed[0], 'requestScan must exist');
  assert.ok(allowed[1], 'confirmScan must exist');
  for (const i of calls('loadSource')) {
    assert.ok(allowed.some((r) => inside(i, r)), `loadSource called outside requestScan/confirmScan: ${lineAt(i).trim()}`);
  }
});

test('userConfirmed: true appears once, inside confirmScan', () => {
  const hits = indexes('userConfirmed: true');
  assert.equal(hits.length, 1, 'userConfirmed: true must appear exactly once');
  assert.ok(inside(hits[0], body('confirmScan')), 'userConfirmed: true must be inside confirmScan');
});

test("confirmScan is only called from case 'scan-anyway'", () => {
  const hits = calls('confirmScan');
  assert.equal(hits.length, 1, 'confirmScan must be called exactly once');
  assert.match(lineAt(hits[0]), /case 'scan-anyway'/);
});

test('every scan entry point goes through requestScan', () => {
  const hits = calls('requestScan');
  assert.ok(hits.length >= 6, `expected at least 6 requestScan call sites, found ${hits.length}`);
});

test('the dvdcss download-page action is gone', () => {
  assert.equal(SRC.includes('openDvdcssPage'), false);
  assert.equal(SRC.includes('dvdcss-page'), false);
});
