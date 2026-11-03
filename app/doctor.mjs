#!/usr/bin/env node
// Health check. Prints PASS / WARN / FAIL for each part and saves it to logs/doctor-<date>.log.
//   node doctor.mjs            check everything
//   node doctor.mjs --refresh  also run a refresh now and show its log as it goes
import { existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { APP, KIT, CAREER_OPS, LOGS, DATA, LIB_FILE, CONFIG } from './lib/paths.mjs';
import { loadConfig } from './lib/config.mjs';
import { status } from './lib/ai.mjs';
import { has, scheduleStatus, OS } from './lib/platform.mjs';
import * as store from './lib/store.mjs';

mkdirSync(LOGS, { recursive: true });
const LOG = join(LOGS, 'doctor-' + new Date().toLocaleDateString('en-CA') + '.log');
appendFileSync(LOG, '\n=== ' + new Date().toISOString() + ' ===\n');
let fails = 0, warns = 0;
const out = (tag, color, msg, fix) => {
  console.log(`\x1b[${color}m${tag}\x1b[0m ${msg}` + (fix ? `\n     -> ${fix}` : ''));
  appendFileSync(LOG, `${tag} ${msg}${fix ? ' -> ' + fix : ''}\n`);
};
const pass = m => out('PASS', 32, m);
const warn = (m, f) => { warns++; out('WARN', 33, m, f); };
const fail = (m, f) => { fails++; out('FAIL', 31, m, f); };

const major = parseInt(process.versions.node, 10);
major >= 22 ? pass('Node.js ' + process.version) : fail('Node.js ' + process.version + ' is too old', 'Install Node 22 LTS or newer from https://nodejs.org');
has('git') ? pass('Git installed') : fail('Git not found', 'Install Git, then run setup again');
try { createRequire(import.meta.url).resolve('pdfmake'); pass('Board app packages installed'); } catch { fail('Board app packages missing', 'Run setup again (it runs npm install in the app folder)'); }
['Regular', 'Bold', 'Italic', 'BoldItalic'].every(n => existsSync(join(APP, 'fonts', 'Carlito-' + n + '.ttf'))) ? pass('Resume fonts present') : fail('Resume fonts missing from app/fonts', 'Download the kit again');

const cfg = loadConfig();
if (!existsSync(CONFIG)) fail('No config.json yet', 'Run setup');
else if (!cfg.name || !(cfg.roles || []).length) fail('config.json is missing your name or target roles', 'Run setup again, or in the app folder: node onboard.mjs');
else pass(`Profile: ${cfg.name}, looking for ${cfg.roles.slice(0, 3).join(', ')}${cfg.roles.length > 3 ? '…' : ''}`);

const st = await status();
st.ready ? pass('AI: ' + st.label + ' is signed in') : fail('AI not ready: ' + (st.why || st.provider), 'In the app folder run: node login.mjs');

if (!existsSync(LIB_FILE)) fail('No resume library (data/resume-lib.json), so no tailored resumes', 'In the app folder run: node onboard.mjs');
else {
  const lib = store.readJson(LIB_FILE, {});
  const flagged = [...(lib.experience || []), ...(lib.projects || [])].flatMap(x => x.bullets || []).filter(b => b.check).length;
  pass(`Resume library: ${(lib.experience || []).length} jobs, ${(lib.projects || []).length} projects, ${(lib.skills || []).length} skill groups`);
  if (flagged) warn(flagged + ' resume line(s) are flagged "check" and left off resumes', 'Open data/resume-lib.json, fix those lines, and delete "check": true');
}

if (!existsSync(join(CAREER_OPS, 'scan.mjs'))) warn('career-ops not installed, so only links you add yourself are checked', 'Run setup again');
else {
  const portals = existsSync(join(CAREER_OPS, 'portals.yml')) ? readFileSync(join(CAREER_OPS, 'portals.yml'), 'utf8') : '';
  const boards = (portals.match(/careers_url:/g) || []).length;
  portals ? pass(`career-ops ready: ${boards} employer job boards tracked`) : fail('career-ops has no portals.yml', 'Run setup again');
  if (portals && boards < 10) warn('Few employer boards tracked', 'Run setup again and let it find job boards for employers');
}

const sch = scheduleStatus();
if (!sch.exists) warn('No daily schedule', 'Run setup again (or use "Refresh now" on the board)');
else pass('Daily schedule set (' + OS + ')' + (sch.last ? `; last run ${sch.last}, result ${sch.result}; next ${sch.next}` : ''));

const meta = store.getMeta();
const jobs = Object.values(store.getJobs());
if (!meta.lastRun) warn('No refresh has finished yet', 'Click "Refresh now" on the board, or run: node doctor.mjs --refresh');
else {
  const days = Math.round((Date.now() - new Date(meta.lastRun + 'T12:00:00').getTime()) / 864e5);
  (days <= 2 ? pass : warn)(`Last refresh ${meta.lastRun}` + (meta.log ? `: ${meta.log.added || 0} added, ${meta.log.tailored || 0} tailored, ${meta.log.documents || 0} PDFs` : ''), days > 2 ? 'Check that the computer was on, and logs/refresh-errors.log' : '');
  for (const u of (meta.sources && meta.sources.unreachable) || []) warn('Last refresh couldn\'t use: ' + u);
}
const open = jobs.filter(j => j.active !== false && !j.closed);
pass(`${open.length} open jobs on the board, ${open.filter(j => j.tailor && !j.tailor.noAI).length} with tailored documents, ${open.filter(j => j.legit && j.legit.trap).length} with AI traps flagged`);
const sum = join(LOGS, 'refresh-summary.log');
if (existsSync(sum)) {
  const last = readFileSync(sum, 'utf8').trim().split('\n').slice(-3);
  if (last.some(l => /FAILED/.test(l))) warn('A recent refresh failed: ' + last.filter(l => /FAILED/.test(l)).pop(), 'Open logs/refresh-errors.log');
}
const port = cfg.port || 4777;
(await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false))
  ? pass('Board running at http://127.0.0.1:' + port + '/') : warn('Board not running right now', 'Use the Job Board shortcut, or: node start.mjs');

if (process.argv.includes('--refresh')) {
  console.log('\nRunning a refresh now (this can take a while)...\n');
  const r = spawnSync(process.execPath, ['refresh.mjs', '--log', join(LOGS, 'refresh-' + new Date().toLocaleDateString('en-CA') + '.log')], { cwd: APP, stdio: 'inherit' });
  r.status === 0 ? pass('Refresh finished') : fail('Refresh failed (exit ' + r.status + ')', 'See the output above and logs/refresh-errors.log');
}

console.log(`\n${fails ? '\x1b[31m' + fails + ' problem(s)' : '\x1b[32mNo problems'}\x1b[0m${warns ? `, ${warns} warning(s)` : ''}. Saved to ${LOG}`);
process.exit(fails ? 1 : 0);
