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
const names = Object.keys(scenarios).filter((n) => typeof scenarios[n] === 'object' && (!only.length || only.includes(n)));

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

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  scenarios.detachFixtureImages();
  const results = [];
  for (const name of names) {
    const sc = scenarios[name];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `spinarr-e2e-${name}-`));
    const env = { tmp, userData: path.join(tmp, 'userData'), outDir: path.join(tmp, 'out') };
    fs.mkdirSync(env.userData, { recursive: true });
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

  const passed = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(REPORT_DIR, 'e2e.json'), JSON.stringify(results, null, 2));
  const md = [
    `# Spinarr end-to-end results`, '',
    `${passed}/${results.length} scenarios passed on ${new Date().toISOString().slice(0, 10)} (macOS ${os.release()}, ${os.arch()}).`, '',
    '| Result | Scenario | Stories | Time |', '|---|---|---|---|',
    ...results.map((r) => `| ${r.pass ? '✅' : '❌'} | ${r.title} | ${r.stories.join(', ')} | ${r.secs}s |`),
    '', ...results.filter((r) => r.notes.length).flatMap((r) => [`**${r.name}**`, ...r.notes.map((n) => `- ${n}`), '']),
    ...results.filter((r) => !r.pass).flatMap((r) => [`### ❌ ${r.name}`, '```', String(r.error).slice(0, 3000), '```', '']),
  ].join('\n');
  fs.writeFileSync(path.join(REPORT_DIR, 'e2e.md'), md);
  console.log(`\n${passed}/${results.length} passed. Report: ${path.join(REPORT_DIR, 'e2e.md')}`);
  process.exit(passed === results.length ? 0 : 1);
})();
