#!/usr/bin/env node
// Runs every e2e scenario in its own isolated app instance (fresh settings + output folder)
// and writes a JSON + Markdown report. Usage: node test/e2e/run.js [scenario ...]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scenarios = require('./scenarios');

const ROOT = path.join(__dirname, '..', '..');
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron'));
const REPORT_DIR = process.env.E2E_REPORT || path.join(ROOT, 'test', 'reports');
const SHOTS = path.join(REPORT_DIR, 'screenshots');
const only = process.argv.slice(2);
// Scenarios marked `docs` (README screenshots) only run when named explicitly.
const names = Object.keys(scenarios).filter((n) => typeof scenarios[n] === 'object' && (only.length ? only.includes(n) : !scenarios[n].docs));

function launch(name, i, env) {
  return new Promise((resolve) => {
    const resultFile = path.join(env.tmp, `result-${i}.json`);
    const child = spawn(ELECTRON, [ROOT], {
      env: {
        ...process.env,
        SPINARR_TEST: path.join(__dirname, 'harness.js'),
        SPINARR_SCENARIO: name,
        SPINARR_LAUNCH: String(i),
        SPINARR_USER_DATA: env.userData,
        // Hermetic home (D-22): key and cache folders resolve under the scenario's tmp dir.
        SPINARR_TEST_HOME: env.home,
        SPINARR_RESULT: resultFile,
        E2E_OUT: env.outDir,
        E2E_SHOTS: SHOTS,
        // Hermetic: only the test images count as drives, never a real disc in the user's drive.
        SPINARR_VOLUMES: 'NTSC_BASIC,THE_TEST_MOVIE_DISC_1',
        ...(scenarios[name].env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 240000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      let r;
      try { r = JSON.parse(fs.readFileSync(resultFile, 'utf8')); }
      catch { r = { pass: false, error: `app exited (${signal || code}) without a result\n${log.slice(-2000)}` }; }
      resolve(r);
    });
  });
}

// CI-only real-home sentinel (D-22). Plants a valid-looking KEYDB.cfg in the runner's REAL
// libaacs config folder so sec_hermetic_keydirs can prove the app never reads it. Runs only
// when CI === 'true' (never on a developer's machine), never overwrites an existing file
// (flag 'wx'), and removes only the file it created.
function plantSentinel() {
  const inCi = process.env.CI === 'true';
  if (!inCi) return null;
  const home = os.homedir();
  const dir = process.platform === 'darwin' ? path.join(home, 'Library', 'Preferences', 'aacs')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'aacs')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'aacs');
  const file = path.join(dir, 'KEYDB.cfg');
  const body = [
    '; Spinarr e2e CI sentinel. Not a real key file; removed after the run.',
    `0x${'0'.repeat(40)} = SPINARR SENTINEL | D | 2026-01-01 | V | 0x${'0'.repeat(32)}`,
    `| PK | 0x${'0'.repeat(32)}`,
    '',
  ].join('\n');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, body, { flag: 'wx' });
  } catch (e) {
    console.log(`sentinel: not planted (${e.code || e.message}); sec_hermetic_keydirs checks paths only`);
    return null;
  }
  process.env.SPINARR_SENTINEL = file; // truthy; the scenario also checks the file is in place
  console.log(`sentinel: planted ${file}`);
  return file;
}
let sentinelRemoved = false;
function removeSentinel(file) {
  if (!file || sentinelRemoved) return;
  sentinelRemoved = true;
  try { fs.unlinkSync(file); console.log(`sentinel: removed ${file}`); } catch (e) { console.log(`sentinel: could not remove ${file}: ${e.message}`); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  scenarios.detachFixtureImages();
  const sentinel = plantSentinel();
  process.on('exit', () => removeSentinel(sentinel)); // also covers an exit from a crash below
  const results = [];
  for (const name of names) {
    const sc = scenarios[name];
    if (sc.platforms && !sc.platforms.includes(process.platform)) {
      console.log(`SKIP  ${name.padEnd(30)}         ${sc.platforms.join('/')} only`);
      results.push({ name, stories: sc.stories, title: sc.title, pass: true, skipped: true, secs: '0.0', notes: [`skipped: ${sc.platforms.join('/')} only`] });
      continue;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `spinarr-e2e-${name}-`));
    const env = { tmp, userData: path.join(tmp, 'userData'), home: path.join(tmp, 'home'), outDir: path.join(tmp, 'out') };
    fs.mkdirSync(env.userData, { recursive: true });
    fs.mkdirSync(env.home, { recursive: true });
    const started = Date.now();
    let r = { pass: true, notes: [] };
    try {
      if (sc.setup) sc.setup(env);
      fs.writeFileSync(path.join(env.userData, 'settings.json'), JSON.stringify({
        outputDir: env.outDir, minMinutes: 2, accurateChapters: true, ...(env.settings || {}),
      }));
      const n = Array.isArray(sc.launches) ? sc.launches.length : 1;
      for (let i = 0; i < n && r.pass; i++) {
        const lr = await launch(name, i, env);
        r = { ...lr, notes: [...(r.notes || []), ...(lr.notes || [])] };
      }
      if (r.pass && sc.after) sc.after(env);
    } catch (e) {
      r = { ...r, pass: false, error: e.stack || String(e) };
    } finally {
      try { if (sc.after && !r.pass) sc.after(env); } catch {}
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ name, stories: sc.stories, title: sc.title, pass: r.pass, secs, error: r.error, notes: r.notes || [] });
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${secs.padStart(6)}s  ${sc.stories.join(', ')}`);
    if (!r.pass) console.log(String(r.error).split('\n').slice(0, 8).map((l) => '      ' + l).join('\n'));
    scenarios.detachFixtureImages();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  removeSentinel(sentinel);

  const passed = results.filter((r) => r.pass && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const ran = results.length - skipped;
  fs.writeFileSync(path.join(REPORT_DIR, 'e2e.json'), JSON.stringify(results, null, 2));
  const md = [
    `# Spinarr end-to-end results`, '',
    `${passed}/${ran} scenarios passed${skipped ? ` (${skipped} skipped on this OS)` : ''} on ${new Date().toISOString().slice(0, 10)} (${os.platform()} ${os.release()}, ${os.arch()}).`, '',
    '| Result | Scenario | Stories | Time |', '|---|---|---|---|',
    ...results.map((r) => `| ${r.skipped ? '⏭️' : r.pass ? '✅' : '❌'} | ${r.title} | ${r.stories.join(', ')} | ${r.secs}s |`),
    '', ...results.filter((r) => r.notes.length).flatMap((r) => [`**${r.name}**`, ...r.notes.map((n) => `- ${n}`), '']),
    ...results.filter((r) => !r.pass).flatMap((r) => [`### ❌ ${r.name}`, '```', String(r.error).slice(0, 3000), '```', '']),
  ].join('\n');
  fs.writeFileSync(path.join(REPORT_DIR, 'e2e.md'), md);
  console.log(`\n${passed}/${ran} passed${skipped ? `, ${skipped} skipped` : ''}. Report: ${path.join(REPORT_DIR, 'e2e.md')}`);
  process.exit(passed === ran ? 0 : 1);
})();
