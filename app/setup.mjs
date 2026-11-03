#!/usr/bin/env node
// Job Hunt Kit setup (Windows, Mac, Linux). Started by setup.ps1 / setup.sh after they make sure Node.js and Git exist.
// Safe to run again: it updates what's there and keeps your answers and data.
//   --provider codex|claude|gemini   skip the AI question
//   --skip-career-ops  --skip-discover  --no-schedule  --no-first-refresh  --answers <file>
import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP, KIT, CAREER_OPS, LOGS } from './lib/paths.mjs';
import { loadConfig, saveConfig } from './lib/config.mjs';
import { PROVIDERS, status, login } from './lib/ai.mjs';
import { installProvider } from './lib/install.mjs';
import { OS, sh, schedule, shortcut, background } from './lib/platform.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const val = n => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
mkdirSync(LOGS, { recursive: true });
const LOG = join(LOGS, 'setup-' + new Date().toLocaleDateString('en-CA') + '.log');
const note = m => appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n');
const step = m => { console.log('\n\x1b[36m==> ' + m + '\x1b[0m'); note('STEP ' + m); };
const info = m => { console.log('    ' + m); note(m); };
const fail = m => { console.log('\n\x1b[31m' + m + '\x1b[0m\nThe setup log is at ' + LOG); note('FAIL ' + m); process.exit(1); };

// A fresh prompt per question, so child programs (sign-in, the setup questions) get the keyboard in between.
const ask = async (q, def = '') => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question('    ' + q + (def ? ` [${def}]` : '') + ': ')).trim() || def; } finally { rl.close(); }
};

console.log('\x1b[32mJob Hunt Kit setup\x1b[0m (' + OS + ')');
console.log('This installs the board, career-ops and your AI tool, asks some questions, and sets up a daily job search.');
note('setup started on ' + OS + ', node ' + process.version);

step('Board app');
if (!sh('npm', ['install', '--no-fund', '--no-audit'], { cwd: APP }).ok) fail('Installing the board app failed. Check your internet connection and run setup again.');

if (!flag('--skip-career-ops')) {
  step('career-ops (job scanner, MIT licence)');
  if (existsSync(join(CAREER_OPS, 'scan.mjs'))) sh('git', ['-C', CAREER_OPS, 'pull', '--ff-only']);
  else if (!sh('git', ['clone', '--depth', '1', 'https://github.com/career-ops-hq/career-ops.git', CAREER_OPS]).ok) fail('Downloading career-ops failed. Check your internet connection and run setup again.');
  if (!sh('npm', ['install', '--no-fund', '--no-audit'], { cwd: CAREER_OPS }).ok) fail('Installing career-ops failed.');
  info('Installing the browser career-ops uses for some career sites...');
  sh('npx', ['playwright', 'install', 'chromium'], { cwd: CAREER_OPS });
}

step('Your AI');
const cfg = loadConfig();
let provider = val('--provider');
if (!PROVIDERS[provider]) {
  const keys = Object.keys(PROVIDERS);
  console.log('    Which AI do you pay for (or want to use)? It runs on this computer, signed in with your own account:');
  keys.forEach((k, i) => console.log(`      ${i + 1}) ${PROVIDERS[k].label}: needs ${PROVIDERS[k].plan}`));
  const cur = keys.indexOf(cfg.ai.provider) + 1 || 1;
  const a = await ask('Choose 1, 2 or 3', String(cur));
  provider = keys[(parseInt(a, 10) || cur) - 1] || keys[0];
}
info('Using ' + PROVIDERS[provider].label + '.');
if (!installProvider(provider)) fail('Could not install ' + PROVIDERS[provider].label + '.');
cfg.ai = { ...cfg.ai, provider, ...(cfg.ai.provider !== provider ? { model: '' } : {}) };
saveConfig(cfg);
let st = await status();
if (st.ready) info('Already signed in.');
else {
  info(PROVIDERS[provider].loginHelp);
  await login(provider);
  st = await status();
  if (!st.ready) info('Not signed in yet (' + st.why + '). You can finish later with: node app/login.mjs (setup continues).');
  else info('Signed in.');
}
note('ai ' + provider + ' ready=' + st.ready);

step('Your details');
const ob = spawnSync(process.execPath, ['onboard.mjs', ...(val('--answers') ? ['--answers', val('--answers')] : [])], { cwd: APP, stdio: 'inherit' });
if (ob.status !== 0) fail('The setup questions did not finish. Run setup again to try again (your answers are kept).');

if (!flag('--skip-career-ops') && !flag('--skip-discover') && existsSync(join(CAREER_OPS, 'companies-seed.yml'))) {
  step('Finding job boards for employers (a few minutes)');
  sh('node', ['discover-ats.mjs', '--in', 'companies-seed.yml', '--write'], { cwd: CAREER_OPS });
  sh('node', ['validate-portals.mjs'], { cwd: CAREER_OPS });
}

const time = loadConfig().refreshTime || '07:10';
if (!flag('--no-schedule')) {
  step('Daily refresh at ' + time);
  const s = schedule(time);
  if (s.ok) info(s.how); else info('Could not set up the daily schedule (' + String(s.err || '').trim().slice(0, 200) + '). You can run a refresh any time with the board\'s "Refresh now" button.');
}

step('Shortcut');
const sc = shortcut();
info(sc.ok ? 'Created ' + sc.file : 'Could not create a shortcut. Start the board any time with: node app/start.mjs');

if (!flag('--no-first-refresh')) {
  step('First refresh');
  const go = await ask('Run the first job search now? It takes 20-60 minutes in the background (y/n)', 'y');
  if (!/^n/i.test(go)) { background('run-refresh.mjs', [], 'first-refresh.log'); info('Started. Watch progress in logs/refresh-' + new Date().toLocaleDateString('en-CA') + '.log, or on the board.'); }
}

step('Health check');
spawnSync(process.execPath, ['doctor.mjs'], { cwd: APP, stdio: 'inherit' });
spawnSync(process.execPath, ['start.mjs'], { cwd: APP, stdio: 'inherit' });
console.log('\n\x1b[32mAll set.\x1b[0m Your board is open in the browser. Use the "Job Board" shortcut any time.');
console.log('Tailored resumes and cover letters are saved in: ' + join(KIT, 'documents'));
note('setup finished');
