const { test } = require('node:test');
const assert = require('node:assert/strict');
const f = require('../../app/renderer/format');

test('esc neutralises every HTML-significant character', () => {
  assert.equal(f.esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(f.esc(null), '');
  assert.equal(f.esc(undefined), '');
  assert.equal(f.esc(5), '5');
});

test('fmtDur', () => {
  assert.equal(f.fmtDur(0), '0:00');
  assert.equal(f.fmtDur(59.6), '1:00');
  assert.equal(f.fmtDur(754), '12:34');
  assert.equal(f.fmtDur(7384), '2:03:04');
});

test('fmtBytes', () => {
  assert.equal(f.fmtBytes(null), '');
  assert.equal(f.fmtBytes(512), '512 B');
  assert.equal(f.fmtBytes(32581632), '32.6 MB');
  assert.equal(f.fmtBytes(4.7e9), '4.70 GB');
});

test('fmtEta', () => {
  assert.equal(f.fmtEta(12.2), '13s');
  assert.equal(f.fmtEta(600), '10m');
  assert.equal(f.fmtEta(5400), '1h 30m');
});

test('channel names', () => {
  assert.equal(f.chans(2), 'Stereo');
  assert.equal(f.chans(6), '5.1');
  assert.equal(f.chans(4), '4ch');
  assert.equal(f.chans(undefined), '');
});

test('language names from 2- and 3-letter codes', () => {
  assert.equal(f.langName('eng'), 'English');
  assert.equal(f.langName('en'), 'English');
  assert.equal(f.langName('fre'), 'French');
  assert.equal(f.langName('ja'), 'Japanese');
  assert.equal(f.langName(''), 'Unknown');
  assert.equal(f.langName('und'), 'Unknown');
  assert.equal(f.langName('<b>'), '<b>', 'invalid codes come back raw (callers escape)');
  assert.equal(f.langShort('eng'), 'EN');
  assert.equal(f.langShort(''), '??');
  assert.equal(f.langShort('<b'), '&lt;B', 'langShort output is pre-escaped');
});

test('codecLabel names Blu-ray codecs plainly', () => {
  assert.equal(f.codecLabel('pcm_bluray'), 'LPCM → FLAC');
  assert.equal(f.codecLabel('hdmv_pgs_subtitle'), 'PGS');
  assert.equal(f.codecLabel('truehd'), 'TrueHD');
  assert.equal(f.codecLabel('ac3'), 'AC3');
  assert.equal(f.codecLabel(undefined), '');
});
