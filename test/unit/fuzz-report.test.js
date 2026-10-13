// scripts/fuzz-report.js: crash signatures, dedupe against the private corpus repo, private
// draft advisories, and the D-09 rule that stdout never carries a trace or an input byte.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  parseSanitizerLog, crashSignature, advisoryPayload, report,
} = require('../../scripts/fuzz-report.js');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'fuzz-report.js');
const ADVISORIES = 'https://api.github.com/repos/rick-rami94/spinarr/security-advisories';
const GHSA = 'GHSA-xxxx-yyyy-zzzz';
const GHSA_URL = `https://github.com/rick-rami94/spinarr/security/advisories/${GHSA}`;
const TOKEN = 'ghs_TESTTOKENdoNotLeak0123456789';
const MARKER = 'REPRODUCER-MARKER-7f3a9c';
const LINE_RE = /^fuzz: \S+ crash [0-9a-f]{8} -> https:\/\/github\.com\/rick-rami94\/spinarr\/security\/advisories\/GHSA-/;

const asanLog = (addr = '0x602000000051') => `INFO: Running with entropic power schedule (0xFF, 100).
INFO: Seed: 1234567
=================================================================
==12==ERROR: AddressSanitizer: heap-buffer-overflow on address ${addr} at pc 0x55d4c3 bp 0x7ffd sp 0x7ffd
READ of size 4 at ${addr} thread T0
    #0 ${addr.replace('0x6', '0x5')} in __asan_memcpy /src/llvm-project/compiler-rt/lib/asan/asan_interceptors_memintrinsics.cpp:63:3
    #1 0x55d4c3a1b2c0 in ifoRead_PGC /src/libdvdread/src/ifo_read.c:1222:7
    #2 0x55d4c3a1c3d1 in ifoRead_PGCIT_internal /src/libdvdread/src/ifo_read.c:1690:10
    #3 0x55d4c3a1d4e2 in ifoOpen /src/libdvdread/src/ifo_read.c:401:9
    #4 0x55d4c3a1e5f3 in dvdinfo_print /src/spinarr/engine/dvdinfo.c:88:12
    #5 0x55d4c3a1f604 in LLVMFuzzerTestOneInput /src/spinarr/fuzz/fuzz_dvd_ifo.c:120:3
    #6 0x55d4c3a20715 in fuzzer::Fuzzer::ExecuteCallback(unsigned char const*, unsigned long) /src/llvm-project/compiler-rt/lib/fuzzer/FuzzerLoop.cpp:614:13

${addr} is located 0 bytes after 1-byte region [0x602000000050,${addr})
SUMMARY: AddressSanitizer: heap-buffer-overflow /src/libdvdread/src/ifo_read.c:1222:7 in ifoRead_PGC
`;

const ubsanLog = `/src/libbluray/src/libbluray/bdnav/clpi_parse.c:430:21: runtime error: index 4096 out of bounds for type 'uint32_t [64]'
    #0 0x4f00aa in clpi_find_stc_spn /src/libbluray/src/libbluray/bdnav/clpi_parse.c:430:21
    #1 0x4f01bb in _clip_to_title /src/libbluray/src/libbluray/bdnav/navigation.c:200:5
    #2 0x4f02cc in nav_title_open /src/libbluray/src/libbluray/bdnav/navigation.c:700:9
    #3 0x4f03dd in LLVMFuzzerTestOneInput /src/spinarr/fuzz/fuzz_bd_mpls_clpi.c:150:3
SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior clpi_parse.c:430:21
`;

const deadlyLog = `==77== ERROR: libFuzzer: deadly signal
    #0 0x52a1b1 in __sanitizer_print_stack_trace /src/llvm-project/compiler-rt/lib/asan/asan_stack.cpp:87:3
    #1 0x47e0f8 in fuzzer::PrintStackTrace() /src/llvm-project/compiler-rt/lib/fuzzer/FuzzerUtil.cpp:210:5
    #2 0x463b33 in fuzzer::Fuzzer::CrashCallback() /src/llvm-project/compiler-rt/lib/fuzzer/FuzzerLoop.cpp:231:3
    #3 0x7f1b0c in __interceptor_abort /src/llvm-project/compiler-rt/lib/sanitizer_common/x.inc:1:1
    #4 0x55aa01 in _parse_header /src/libbluray/src/libbluray/bdnav/mpls_parse.c:55:5
    #5 0x55aa02 in mpls_parse /src/libbluray/src/libbluray/bdnav/mpls_parse.c:900:9
    #6 0x55aa03 in bd_get_titles /src/libbluray/src/libbluray/bluray.c:2200:5
    #7 0x55aa04 in main /src/llvm-project/compiler-rt/lib/fuzzer/FuzzerMain.cpp:20:10
NOTE: libFuzzer has rudimentary signal handlers.
SUMMARY: libFuzzer: deadly signal
`;

const timeoutLog = `ALARM: working on the last Unit for 26 seconds
       and the timeout value is 25 (use -timeout=N to change)
==9== ERROR: libFuzzer: timeout after 26 seconds
    #0 0x5291a1 in __sanitizer_print_stack_trace /src/asan_stack.cpp:87:3
    #1 0x55bb01 in ifoRead_VTS_ATRT /src/libdvdread/src/ifo_read.c:2100:5
    #2 0x55bb02 in ifoOpen /src/libdvdread/src/ifo_read.c:401:9
    #3 0x55bb03 in LLVMFuzzerTestOneInput /src/spinarr/fuzz/fuzz_dvd_ifo.c:120:3
SUMMARY: libFuzzer: timeout
`;

const oomLog = `==5== ERROR: libFuzzer: out-of-memory (used: 2600Mb; exceeds: 2560Mb)
To change the out-of-memory limit use -rss_limit_mb=<N>
SUMMARY: libFuzzer: out-of-memory
`;

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fuzz-report-')); }

// <crashes>/<target>/<name> + <name>.log, the layout scripts/fuzz-run.sh writes.
function crashes(entries) {
  const dir = tmp();
  for (const { target, name, input, log } of entries) {
    fs.mkdirSync(path.join(dir, target), { recursive: true });
    fs.writeFileSync(path.join(dir, target, name), input);
    fs.writeFileSync(path.join(dir, target, `${name}.log`), log);
  }
  return dir;
}

function fakeFetch(res = { ok: true, status: 201, json: async () => ({ ghsa_id: GHSA, html_url: GHSA_URL, created_at: '2026-10-12T00:00:00Z' }) }) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return typeof res === 'function' ? res() : res; };
  fn.calls = calls;
  return fn;
}

function sink() {
  const chunks = [];
  return { write: (s) => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}

function assertClean(out) {
  for (const bad of ['#0 ', 'ERROR: AddressSanitizer', 'runtime error', MARKER, TOKEN]) {
    assert.ok(!out.includes(bad), `stdout must not contain ${JSON.stringify(bad)}`);
  }
}

// --- parseSanitizerLog ---

test('ASan heap-buffer-overflow: kind and frames without sanitizer/fuzzer frames', () => {
  const r = parseSanitizerLog(asanLog());
  assert.equal(r.kind, 'heap-buffer-overflow');
  assert.deepEqual(r.frames.slice(0, 3), ['ifoRead_PGC', 'ifoRead_PGCIT_internal', 'ifoOpen']);
  assert.ok(r.frames.includes('dvdinfo_print'));
  for (const f of r.frames) {
    assert.ok(!/^(__asan|__sanitizer|__interceptor|fuzzer::)/.test(f) && f !== 'LLVMFuzzerTestOneInput' && f !== 'main', f);
  }
});

test('UBSan, deadly signal, timeout and OOM kinds', () => {
  const u = parseSanitizerLog(ubsanLog);
  assert.equal(u.kind, 'ubsan');
  assert.deepEqual(u.frames, ['clpi_find_stc_spn', '_clip_to_title', 'nav_title_open']);
  const d = parseSanitizerLog(deadlyLog);
  assert.equal(d.kind, 'deadly-signal');
  assert.deepEqual(d.frames, ['_parse_header', 'mpls_parse', 'bd_get_titles']);
  assert.equal(parseSanitizerLog(timeoutLog).kind, 'timeout');
  assert.equal(parseSanitizerLog(oomLog).kind, 'oom');
  assert.equal(parseSanitizerLog('').kind, 'unknown');
});

// --- crashSignature / advisoryPayload ---

test('signature is sha256(target + top three frames) and ignores addresses', () => {
  const a = parseSanitizerLog(asanLog('0x602000000051'));
  const b = parseSanitizerLog(asanLog('0x6020000000ff'));
  const sa = crashSignature('fuzz_dvd_ifo', a.frames);
  assert.match(sa, /^[0-9a-f]{64}$/);
  assert.equal(sa, crashSignature('fuzz_dvd_ifo', b.frames));
  const want = require('crypto').createHash('sha256')
    .update('fuzz_dvd_ifo\nifoRead_PGC\nifoRead_PGCIT_internal\nifoOpen').digest('hex');
  assert.equal(sa, want);
  assert.notEqual(sa, crashSignature('fuzz_bd_mpls_clpi', a.frames));
  assert.notEqual(sa, crashSignature('fuzz_dvd_ifo', ['ifoRead_PGC', 'ifoOpen', 'x']));
});

test('advisory payload shape', () => {
  const sig = 'abcdef0123456789'.repeat(4);
  const p = advisoryPayload({ target: 'fuzz_dvd_ifo', sig, kind: 'heap-buffer-overflow', log: asanLog() });
  assert.equal(p.summary, '[fuzz:abcdef01] fuzz_dvd_ifo: heap-buffer-overflow');
  assert.equal(p.severity, 'high');
  assert.deepEqual(p.vulnerabilities, [{ package: { ecosystem: 'other', name: 'spinarr-engine' } }]);
  assert.ok(p.description.includes('```\n' + asanLog()) || p.description.includes(asanLog()));
  assert.match(p.description, /```[\s\S]*ERROR: AddressSanitizer[\s\S]*```/);
  assert.ok(p.description.includes(`crashes/fuzz_dvd_ifo/${sig}`));
});

test('advisory payload fence cannot be closed by the log', () => {
  const p = advisoryPayload({ target: 't', sig: '0'.repeat(64), kind: 'ubsan', log: 'a\n```\nb' });
  const fence = p.description.match(/^(`{3,})/m)[1];
  assert.ok(fence.length > 3);
});

// --- report ---

test('new crash: one POST, private files written, one GHSA line on stdout', async () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: `bytes ${MARKER} bytes`, log: asanLog() }]);
  const repo = tmp();
  const fetch = fakeFetch();
  const stdout = sink();
  const n = await report({ crashesDir: dir, corpusRepoDir: repo, mode: 'nightly', token: TOKEN, fetch, stdout });
  assert.equal(n, 1);
  assert.equal(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.equal(url, ADVISORIES);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers.Accept, 'application/vnd.github+json');
  assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
  const body = JSON.parse(init.body);
  assert.match(body.summary, /^\[fuzz:[0-9a-f]{8}\] fuzz_dvd_ifo: heap-buffer-overflow$/);

  const sig = crashSignature('fuzz_dvd_ifo', parseSanitizerLog(asanLog()).frames);
  const sd = path.join(repo, 'crashes', 'fuzz_dvd_ifo', sig);
  assert.equal(fs.readFileSync(path.join(sd, 'reproducer'), 'utf8'), `bytes ${MARKER} bytes`);
  assert.equal(fs.readFileSync(path.join(sd, 'sanitizer.log'), 'utf8'), asanLog());
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(sd, 'advisory.json'), 'utf8'))).sort(),
    ['created_at', 'ghsa_id', 'html_url']);

  const out = stdout.text();
  const lines = out.trimEnd().split('\n');
  assert.equal(lines.length, 1);
  for (const l of lines) assert.match(l, LINE_RE);
  assert.ok(out.includes(GHSA_URL));
  assert.ok(out.includes(` crash ${sig.slice(0, 8)} -> `));
  assertClean(out);
});

test('known crash: no POST, stdout links the existing advisory', async () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-def', input: MARKER, log: asanLog('0x6020000000aa') }]);
  const repo = tmp();
  const sig = crashSignature('fuzz_dvd_ifo', parseSanitizerLog(asanLog()).frames);
  const sd = path.join(repo, 'crashes', 'fuzz_dvd_ifo', sig);
  fs.mkdirSync(sd, { recursive: true });
  const known = 'GHSA-aaaa-bbbb-cccc';
  fs.writeFileSync(path.join(sd, 'advisory.json'), JSON.stringify({
    ghsa_id: known, html_url: `https://github.com/rick-rami94/spinarr/security/advisories/${known}`, created_at: 'x',
  }));
  const fetch = fakeFetch();
  const stdout = sink();
  const n = await report({ crashesDir: dir, corpusRepoDir: repo, mode: 'pr', token: TOKEN, fetch, stdout });
  assert.equal(n, 1);
  assert.equal(fetch.calls.length, 0);
  const out = stdout.text();
  assert.match(out, LINE_RE);
  assert.ok(out.includes(known));
  assertClean(out);
});

test('two crashes with one signature in a run create one advisory', async () => {
  const dir = crashes([
    { target: 'fuzz_dvd_ifo', name: 'crash-1', input: MARKER, log: asanLog('0x602000000011') },
    { target: 'fuzz_dvd_ifo', name: 'crash-2', input: MARKER, log: asanLog('0x602000000022') },
    { target: 'fuzz_bd_mpls_clpi', name: 'crash-3', input: MARKER, log: ubsanLog },
  ]);
  const repo = tmp();
  const fetch = fakeFetch();
  const stdout = sink();
  const n = await report({ crashesDir: dir, corpusRepoDir: repo, mode: 'nightly', token: TOKEN, fetch, stdout });
  assert.equal(n, 3);
  assert.equal(fetch.calls.length, 2);
  for (const l of stdout.text().trimEnd().split('\n')) assert.match(l, LINE_RE);
  assertClean(stdout.text());
});

test('fork mode: no fetch, no writes, one fixed line', async () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: MARKER, log: asanLog() }]);
  const repo = tmp();
  const fetch = fakeFetch();
  const stdout = sink();
  const n = await report({ crashesDir: dir, corpusRepoDir: repo, mode: 'fork', fetch, stdout });
  assert.equal(n, 1);
  assert.equal(fetch.calls.length, 0);
  assert.deepEqual(fs.readdirSync(repo), []);
  assert.equal(stdout.text(), 'fuzzing found a crash; a maintainer will reproduce it privately\n');
});

test('no crashes: zero, no output, no fetch', async () => {
  const fetch = fakeFetch();
  const stdout = sink();
  assert.equal(await report({ crashesDir: tmp(), corpusRepoDir: tmp(), mode: 'nightly', token: TOKEN, fetch, stdout }), 0);
  assert.equal(await report({ crashesDir: path.join(tmp(), 'missing'), corpusRepoDir: tmp(), mode: 'fork', fetch, stdout }), 0);
  assert.equal(fetch.calls.length, 0);
  assert.equal(stdout.text(), '');
});

test('API failure: rejects with the status only, never the body or token', async () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: MARKER, log: asanLog() }]);
  const repo = tmp();
  const fetch = fakeFetch({ ok: false, status: 422, json: async () => ({ message: `bad ${TOKEN} body` }), text: async () => `bad ${TOKEN} body` });
  const stdout = sink();
  await assert.rejects(
    report({ crashesDir: dir, corpusRepoDir: repo, mode: 'nightly', token: TOKEN, fetch, stdout }),
    (e) => e.message === 'advisory creation failed (HTTP 422)',
  );
  assertClean(stdout.text());
  const sig = crashSignature('fuzz_dvd_ifo', parseSanitizerLog(asanLog()).frames);
  assert.ok(!fs.existsSync(path.join(repo, 'crashes', 'fuzz_dvd_ifo', sig, 'advisory.json')));
});

test('network error and malformed response never leak the token', async () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: MARKER, log: asanLog() }]);
  const boom = fakeFetch(() => { throw new Error(`connect failed with ${TOKEN}`); });
  await assert.rejects(report({ crashesDir: dir, corpusRepoDir: tmp(), mode: 'pr', token: TOKEN, fetch: boom, stdout: sink() }),
    (e) => !e.message.includes(TOKEN) && /advisory creation failed/.test(e.message));
  const odd = fakeFetch({ ok: true, status: 201, json: async () => ({ ghsa_id: '../../evil', html_url: 'https://evil.example/' }) });
  const stdout = sink();
  await assert.rejects(report({ crashesDir: dir, corpusRepoDir: tmp(), mode: 'pr', token: TOKEN, fetch: odd, stdout }),
    /advisory creation failed/);
  assert.ok(!stdout.text().includes('evil'));
});

test('pr and nightly modes require a token', async () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: MARKER, log: asanLog() }]);
  await assert.rejects(report({ crashesDir: dir, corpusRepoDir: tmp(), mode: 'pr', fetch: fakeFetch(), stdout: sink() }), /token/);
  await assert.rejects(report({ crashesDir: dir, corpusRepoDir: tmp(), mode: 'bogus', token: TOKEN, fetch: fakeFetch(), stdout: sink() }), /mode/);
});

// --- CLI ---

function cli(args, env = {}, preload) {
  const pre = preload ? ['-r', preload] : [];
  return spawnSync(process.execPath, [...pre, SCRIPT, ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
  });
}

test('CLI: fork mode exits 1 on a crash, 0 without', () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: MARKER, log: asanLog() }]);
  const r = cli(['--crashes', dir, '--corpus-repo', tmp(), '--mode', 'fork']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'fuzzing found a crash; a maintainer will reproduce it privately\n');
  assertClean(r.stdout + r.stderr);
  assert.equal(cli(['--crashes', tmp(), '--corpus-repo', tmp(), '--mode', 'fork']).status, 0);
});

test('CLI: missing token or bad usage exits 2', () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: MARKER, log: asanLog() }]);
  assert.equal(cli(['--crashes', dir, '--corpus-repo', tmp(), '--mode', 'pr']).status, 2);
  assert.equal(cli(['--crashes', dir, '--mode', 'nightly'], { FUZZ_ADVISORY_TOKEN: TOKEN }).status, 2);
});

test('CLI: API failure exits 2 with the status only', () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: MARKER, log: asanLog() }]);
  const pre = path.join(tmp(), 'fetch.js');
  fs.writeFileSync(pre, `globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ m: 'SECRET-BODY' }), text: async () => 'SECRET-BODY' });\n`);
  const r = cli(['--crashes', dir, '--corpus-repo', tmp(), '--mode', 'nightly'], { FUZZ_ADVISORY_TOKEN: TOKEN }, pre);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /advisory creation failed \(HTTP 403\)/);
  assert.ok(!(r.stdout + r.stderr).includes('SECRET-BODY'));
  assertClean(r.stdout + r.stderr);
});

test('CLI: new crash exits 1 and prints only the GHSA line', () => {
  const dir = crashes([{ target: 'fuzz_dvd_ifo', name: 'crash-abc', input: MARKER, log: asanLog() }]);
  const pre = path.join(tmp(), 'fetch.js');
  fs.writeFileSync(pre, `globalThis.fetch = async () => ({ ok: true, status: 201, json: async () => (${JSON.stringify({ ghsa_id: GHSA, html_url: GHSA_URL, created_at: 'x' })}) });\n`);
  const r = cli(['--crashes', dir, '--corpus-repo', tmp(), '--mode', 'nightly'], { FUZZ_ADVISORY_TOKEN: TOKEN }, pre);
  assert.equal(r.status, 1);
  assert.match(r.stdout, LINE_RE);
  assert.equal(r.stdout.trimEnd().split('\n').length, 1);
  assertClean(r.stdout + r.stderr);
});
