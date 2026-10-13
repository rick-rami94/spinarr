// Fuzz crash triage for CI (SAFE-10, D-09/D-10).
//
//   node scripts/fuzz-report.js --crashes <dir> --corpus-repo <dir> --mode pr|nightly|fork
//
// <crashes> is the layout scripts/fuzz-run.sh writes: <crashes>/<target>/<name> (the input)
// and <crashes>/<target>/<name>.log (the sanitizer output). <corpus-repo> is a clone of the
// private rick-rami94/spinarr-fuzz-corpus repo; the caller commits and pushes it.
//
// Each crash gets a signature: sha256(target + the top three symbolized frames). If
// crashes/<target>/<sig>/advisory.json already exists in the private repo the crash is known
// and no advisory is created. Otherwise the reproducer and sanitizer log are stored there and a
// private DRAFT security advisory is opened on rick-rami94/spinarr (visible to maintainers
// only). Token: env FUZZ_ADVISORY_TOKEN, needed unless --mode fork.
//
// The workflow log is public, so stdout carries only one line per crash:
//   fuzz: <target> crash <sig8> -> https://github.com/rick-rami94/spinarr/security/advisories/GHSA-...
// Never a stack trace, an input byte, a request or response body, or the token. Fork PRs have
// no credentials: --mode fork stores nothing and prints one fixed sentence.
//
// Exit 0 = no crash, 1 = at least one crash (reported), 2 = usage or advisory API failure.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Constant owner/repo: the advisory URL is never built from input.
const REPO = 'rick-rami94/spinarr';
const ADVISORY_API = `https://api.github.com/repos/${REPO}/security-advisories`;
const ADVISORY_WEB = `https://github.com/${REPO}/security/advisories/`;
const GHSA_RE = /^GHSA(-[0-9a-z]{4}){3}$/; // path- and URL-safe; never trust the response blindly
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const FORK_LINE = 'fuzzing found a crash; a maintainer will reproduce it privately';
const MODES = ['pr', 'nightly', 'fork'];

// Frames that belong to the sanitizer runtime, libFuzzer or the harness entry, not the bug.
const SKIP_PREFIX = ['__asan', '__sanitizer', '__interceptor', '__ubsan', '__lsan', 'fuzzer::'];
const SKIP_EXACT = new Set(['LLVMFuzzerTestOneInput', 'main', '__libc_start_main', '__libc_start_call_main', '_start']);

function skipFrame(fn) {
  return SKIP_EXACT.has(fn) || SKIP_PREFIX.some((p) => fn.startsWith(p));
}

// parseSanitizerLog(text) -> { kind, frames }. kind is the ASan bug type, 'ubsan',
// 'deadly-signal', 'timeout', 'oom' or 'unknown'. frames are function names from the first
// stack in the log, sanitizer/fuzzer frames removed.
function parseSanitizerLog(text) {
  const s = String(text || '');
  let kind = 'unknown';
  let m;
  if (/ERROR: libFuzzer: out-of-memory|ERROR: AddressSanitizer: out-of-memory/.test(s)) kind = 'oom';
  else if ((m = /ERROR: AddressSanitizer: ([A-Za-z0-9_-]+)/.exec(s))) kind = m[1];
  else if (/ERROR: libFuzzer: timeout/.test(s)) kind = 'timeout';
  else if (/runtime error:/.test(s)) kind = 'ubsan';
  else if (/ERROR: libFuzzer: deadly signal/.test(s)) kind = 'deadly-signal';
  else if ((m = /ERROR: (?:LeakSanitizer|MemorySanitizer): ([A-Za-z0-9_-]+)/.exec(s))) kind = m[1];

  const frames = [];
  let last = -1;
  for (const line of s.split(/\r?\n/)) {
    const f = /^\s*#(\d+) 0x[0-9a-fA-F]+ in (.+?)(?: \/| \(|$)/.exec(line);
    if (!f) continue;
    const n = Number(f[1]);
    if (n <= last) break; // a second stack (e.g. "freed by thread") starts again at #0
    last = n;
    // Strip C++ parameter lists so the name does not depend on the demangler's formatting.
    const fn = f[2].trim().replace(/\(.*$/, '');
    if (fn && !skipFrame(fn)) frames.push(fn);
  }
  return { kind, frames };
}

function crashSignature(target, frames) {
  return crypto.createHash('sha256')
    .update(`${target}\n${frames.slice(0, 3).join('\n')}`)
    .digest('hex');
}

// A fence longer than any backtick run in the log, so the log cannot close it.
function fenced(text) {
  const runs = String(text).match(/`+/g) || [];
  const len = Math.max(3, ...runs.map((r) => r.length + 1));
  const fence = '`'.repeat(len);
  return `${fence}\n${text}${String(text).endsWith('\n') ? '' : '\n'}${fence}`;
}

function advisoryPayload({ target, sig, kind, log, mode }) {
  const found = mode === 'pr' ? 'pull-request fuzzing' : 'scheduled fuzzing';
  return {
    summary: `[fuzz:${sig.slice(0, 8)}] ${target}: ${kind}`,
    description: [
      `Found by ${found} (ClusterFuzzLite, libFuzzer + ASan) in \`${target}\`.`,
      '',
      fenced(log),
      '',
      `Reproducer: private corpus repo rick-rami94/spinarr-fuzz-corpus, crashes/${target}/${sig}/reproducer`,
      `Signature: ${sig}`,
    ].join('\n'),
    severity: 'high',
    vulnerabilities: [{ package: { ecosystem: 'other', name: 'spinarr-engine' } }],
  };
}

function listCrashes(crashesDir) {
  let targets;
  try { targets = fs.readdirSync(crashesDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const t of targets.filter((d) => d.isDirectory() && NAME_RE.test(d.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(crashesDir, t.name);
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!f.isFile() || f.name.endsWith('.log')) continue;
      const logPath = path.join(dir, `${f.name}.log`);
      out.push({
        target: t.name,
        input: path.join(dir, f.name),
        log: fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '',
      });
    }
  }
  return out;
}

function readKnown(file) {
  try {
    const a = JSON.parse(fs.readFileSync(file, 'utf8'));
    return a && GHSA_RE.test(a.ghsa_id) ? a.ghsa_id : null;
  } catch { return null; }
}

async function createAdvisory(payload, token, fetchFn) {
  let res;
  try {
    res = await fetchFn(ADVISORY_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // The underlying error is dropped on purpose: it is not needed and must not echo anything.
    throw new Error('advisory creation failed (network error)');
  }
  if (!res || !res.ok) throw new Error(`advisory creation failed (HTTP ${res ? Number(res.status) : 0})`);
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!data || !GHSA_RE.test(data.ghsa_id)) throw new Error('advisory creation failed (unexpected response)');
  return {
    ghsa_id: data.ghsa_id,
    html_url: ADVISORY_WEB + data.ghsa_id,
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
  };
}

// report(opts) -> number of crashes found. Rejects on usage errors and advisory API failures.
async function report({ crashesDir, corpusRepoDir, mode, token, fetch: fetchFn = globalThis.fetch, stdout = process.stdout }) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode (want ${MODES.join('|')})`);
  const found = listCrashes(crashesDir);
  if (!found.length) return 0;

  if (mode === 'fork') {
    stdout.write(`${FORK_LINE}\n`);
    return found.length;
  }
  if (!token) throw new Error('FUZZ_ADVISORY_TOKEN token is required for this mode');
  if (!corpusRepoDir) throw new Error('--corpus-repo is required for this mode');

  for (const c of found) {
    const { kind, frames } = parseSanitizerLog(c.log);
    const sig = crashSignature(c.target, frames);
    const dir = path.join(corpusRepoDir, 'crashes', c.target, sig);
    const advFile = path.join(dir, 'advisory.json');
    let ghsa = readKnown(advFile);
    if (!ghsa) {
      // Store the evidence privately first, so a failed API call still keeps it.
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(c.input, path.join(dir, 'reproducer'));
      fs.writeFileSync(path.join(dir, 'sanitizer.log'), c.log);
      const adv = await createAdvisory(advisoryPayload({ target: c.target, sig, kind, log: c.log, mode }), token, fetchFn);
      fs.writeFileSync(advFile, JSON.stringify(adv, null, 2) + '\n');
      ghsa = adv.ghsa_id;
    }
    stdout.write(`fuzz: ${c.target} crash ${sig.slice(0, 8)} -> ${ADVISORY_WEB}${ghsa}\n`);
  }
  return found.length;
}

module.exports = { parseSanitizerLog, crashSignature, advisoryPayload, report, ADVISORY_API };

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const v = argv[i + 1];
    if (v === undefined) return null;
    if (argv[i] === '--crashes') opts.crashesDir = v;
    else if (argv[i] === '--corpus-repo') opts.corpusRepoDir = v;
    else if (argv[i] === '--mode') opts.mode = v;
    else return null;
  }
  if (!opts.crashesDir || !MODES.includes(opts.mode)) return null;
  if (opts.mode !== 'fork' && !opts.corpusRepoDir) return null;
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    process.stderr.write('usage: node scripts/fuzz-report.js --crashes <dir> --corpus-repo <dir> --mode pr|nightly|fork\n');
    process.exit(2);
  }
  opts.token = process.env.FUZZ_ADVISORY_TOKEN || '';
  if (opts.mode !== 'fork' && !opts.token) {
    process.stderr.write('fuzz-report: FUZZ_ADVISORY_TOKEN is not set\n');
    process.exit(2);
  }
  report(opts).then(
    (n) => { process.exitCode = n > 0 ? 1 : 0; },
    (e) => {
      // Only our own fixed messages are printed; anything else gets a generic line.
      const msg = /^advisory creation failed \([^)]*\)$/.test(e.message) ? e.message : 'internal error';
      process.stderr.write(`fuzz-report: ${msg}\n`);
      process.exitCode = 2;
    },
  );
}
