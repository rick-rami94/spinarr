// Static privacy and pinning invariants for .github/workflows/fuzz-*.yml (SAFE-10, D-09, D-16).
// Text and regex only, no YAML dependency. These workflows run in a public repo, so a crash input
// or stack trace must never reach a log, an artifact or code scanning.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '.github', 'workflows');
const FILES = fs.readdirSync(DIR).filter((f) => /^fuzz-.*\.ya?ml$/.test(f)).sort();
const SRC = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]));

const indent = (l) => l.match(/^ */)[0].length;
const code = (l) => l.replace(/(^|\s)#.*$/, ''); // drop YAML comments

// Step blocks: every "- " item directly under a `steps:` key, as arrays of lines.
function steps(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^( *)steps:\s*$/.exec(lines[i]);
    if (!m) continue;
    const base = m[1].length;
    let cur = null;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() && indent(l) <= base) break;
      if (/^ *- /.test(l) && indent(l) <= base + 2) { cur = [l]; out.push(cur); } else if (cur) cur.push(l);
    }
  }
  return out;
}

// Lines inside `run:` scripts (block scalars tracked by indentation, plus one-line runs).
function runLines(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^( *)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = m[2];
    if (!/^[|>][-+]?\s*$/.test(rest)) { out.push(rest); continue; }
    const keyIndent = indent(lines[i]) + (lines[i].trimStart().startsWith('- ') ? 2 : 0);
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() && indent(lines[j]) <= keyIndent) break;
      out.push(lines[j]);
    }
  }
  return out;
}

test('fuzz workflows exist', () => {
  assert.deepEqual(FILES, ['fuzz-cron.yml', 'fuzz-pr.yml']);
});

for (const [file, src] of Object.entries(SRC)) {
  const active = src.split('\n').map(code).join('\n');

  test(`${file}: no public crash channels and no pull_request_target`, () => {
    // Checked against the whole file, comments included, so a grep audit stays at zero.
    for (const bad of ['upload-artifact', 'run_fuzzers', 'upload-sarif', 'pull_request_target']) {
      assert.ok(!src.includes(bad), `${file} must not mention ${bad}`);
    }
    assert.ok(!/output-sarif:\s*true/.test(active), `${file} must not set output-sarif: true`);
    assert.ok(!/actions\/download-artifact/.test(active));
  });

  test(`${file}: every action is pinned to a full commit SHA with a version comment`, () => {
    const uses = src.split('\n').filter((l) => /^\s*(- )?uses:/.test(l));
    assert.ok(uses.length > 0);
    for (const l of uses) assert.match(l, /uses: [^@\s]+@[0-9a-f]{40} # v\d/, l.trim());
  });

  test(`${file}: checkout never persists credentials`, () => {
    const co = steps(src).filter((s) => s.some((l) => /uses: actions\/checkout@/.test(l)));
    assert.ok(co.length > 0);
    for (const s of co) assert.ok(s.some((l) => /^\s*persist-credentials:\s*false\s*$/.test(l)), s.join('\n'));
  });

  test(`${file}: no \${{ }} expressions inside run: scripts`, () => {
    const lines = runLines(src);
    assert.ok(lines.length > 0);
    for (const l of lines) assert.ok(!l.includes('${{'), `template expression in run: ${l.trim()}`);
  });

  test(`${file}: the fuzz log is never printed, and fuzzing only goes through fuzz-run.sh`, () => {
    for (const l of runLines(src)) {
      assert.ok(!/\b(cat|tee|head|tail|less|more|grep|sed|awk)\b[^\n]*fuzz\.log/.test(l), l.trim());
    }
    assert.match(active, /sh scripts\/fuzz-run\.sh --mode /);
    assert.ok(!/(^|\s)\.?\/?build-out\/fuzz_/.test(runLines(src).join('\n')), 'run fuzzers through scripts/fuzz-run.sh only');
  });

  test(`${file}: ASan ASLR fix before fuzzing`, () => {
    const at = active.indexOf('sudo sysctl vm.mmap_rnd_bits=28');
    assert.ok(at >= 0, 'vm.mmap_rnd_bits=28 missing');
    assert.ok(at < active.indexOf('scripts/fuzz-run.sh'));
  });

  test(`${file}: top-level permissions are read-only and every job has a timeout`, () => {
    assert.match(src, /^permissions:\n {2}contents: read\n/m);
    const jobs = src.slice(src.indexOf('\njobs:\n'));
    const ids = [...jobs.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      const start = jobs.indexOf(`\n  ${id}:\n`);
      const next = jobs.slice(start + 1).search(/\n {2}[\w-]+:\s*\n/);
      const body = next < 0 ? jobs.slice(start) : jobs.slice(start, start + 1 + next);
      assert.match(body, /\n {4}timeout-minutes: \d+/, `job ${id} needs timeout-minutes`);
      if (/secrets\.|vars\./.test(body)) assert.match(body, /\n {4}environment: fuzz\n/, `job ${id} uses credentials, needs environment: fuzz`);
    }
  });

  test(`${file}: the advisory credential is only visible to fuzz-report.js steps`, () => {
    const all = steps(src);
    for (const s of all) {
      const text = s.join('\n');
      if (/FUZZ_ADVISORY_TOKEN|advisory-token\.outputs/.test(text)) {
        assert.ok(text.includes('scripts/fuzz-report.js'), `advisory credential outside a fuzz-report.js step:\n${text}`);
      }
    }
    assert.ok(!/^ {0,4}env:[\s\S]*?FUZZ_ADVISORY_TOKEN/m.test(src.split('\njobs:\n')[0]), 'no workflow-level advisory token');
  });

  test(`${file}: git credentials are masked and the bot commits without trailers`, () => {
    const lines = runLines(src).join('\n');
    if (lines.includes('extraheader')) {
      assert.match(lines, /::add-mask::\$auth/);
      assert.ok(lines.indexOf('::add-mask::') < lines.indexOf('extraheader'));
    }
    assert.ok(!/Co-Authored-By/i.test(src));
    for (const m of src.matchAll(/user\.name=(\S+)/g)) assert.equal(m[1], 'spinarr-fuzz-bot');
  });

  test(`${file}: credentialed steps are app tokens scoped to one repository`, () => {
    for (const s of steps(src).filter((x) => x.some((l) => /create-github-app-token@/.test(l)))) {
      const text = s.join('\n');
      assert.match(text, /owner: rick-rami94/);
      assert.match(text, /repositories: (spinarr|spinarr-fuzz-corpus)\s*$/m);
      assert.match(text, /permission-[\w-]+: write/);
    }
  });
}

test('fuzz-pr.yml: pull_request with parser paths; fork PRs never get credentials', () => {
  const src = SRC['fuzz-pr.yml'];
  assert.match(src, /^on:\n {2}pull_request:\n/m);
  for (const p of ['engine/**', 'fuzz/**', '.clusterfuzzlite/**']) assert.ok(src.includes(`'${p}'`), p);
  assert.match(src, /--mode code-change --seconds 300/);
  assert.match(src, /--mode fork/);
  for (const s of steps(src)) {
    const text = s.join('\n');
    if (/secrets\.|steps\.[\w-]+-token\.outputs/.test(text)) {
      assert.match(text, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/, `ungated credential step:\n${text}`);
    }
  }
  assert.match(src, /fuzzing found a new crash; see the private advisory linked above/);
  assert.match(src, /fuzz infrastructure failure/);
});

test('fuzz-cron.yml: nightly and weekly schedules, one corpus writer, all modes', () => {
  const src = SRC['fuzz-cron.yml'];
  assert.match(src, /cron: '17 3 \* \* \*'/);
  assert.match(src, /cron: '41 4 \* \* 0'/);
  assert.match(src, /concurrency:\n {2}group: fuzz-corpus\n {2}cancel-in-progress: false/);
  assert.match(src, /workflow_dispatch:/);
  for (const m of ['--mode batch --seconds 3600', '--mode prune', '--mode coverage']) assert.ok(src.includes(m), m);
  assert.match(src, /sanitizer: coverage/);
  assert.match(src, /--mode nightly/);
});
