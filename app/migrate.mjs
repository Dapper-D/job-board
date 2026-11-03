#!/usr/bin/env node
// Steps that run after an update (started by update.mjs; safe to run again by hand: node migrate.mjs).
// Brings an older install up to date without redoing setup:
//   - the daily schedule and the Job Board shortcut (their paths change between versions)
//   - the AI tool in the kit's tools/ folder
//   - the resume library that tailored resumes are made from (built from the resume you gave in setup)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP, KIT, LIB_FILE } from './lib/paths.mjs';
import { loadConfig, saveConfig } from './lib/config.mjs';
import { PROVIDERS, status } from './lib/ai.mjs';
import { installProvider } from './lib/install.mjs';
import { schedule, scheduleStatus, shortcut } from './lib/platform.mjs';
import { writeState } from './lib/update.mjs';
import { harden } from './lib/secure.mjs';

const argv = process.argv.slice(2);
const from = (argv[argv.indexOf('--from') + 1] || '0.0.0');
const notes = [];
const ok = m => console.log('  OK   ' + m);
const todo = m => { console.log('  TODO ' + m); notes.push(m); };

const cfg = loadConfig();
if (!existsSync(join(KIT, 'config.json'))) { console.log('No config.json: this kit was never set up. Run setup instead.'); process.exit(0); }
saveConfig(cfg); // fills in settings added since the last version, keeping every answer
harden({ force: true }); ok('Private files (config, .env, data, documents, logs) readable only by you')

// The AI tool. Older kits used a global Codex install or an OpenAI API key; both keep working.
const p = cfg.ai.provider;
if (PROVIDERS[p] && !existsSync(join(KIT, 'tools', 'node_modules', ...PROVIDERS[p].entry))) {
  if (installProvider(p)) ok(PROVIDERS[p].label + ' installed in the kit\'s tools folder');
}
const st = await status();
st.ready ? ok('AI ready: ' + st.label) : todo('Sign in to your AI: in the app folder run "node login.mjs"' + (p === 'openai' ? ' (or switch to a sign-in AI: node login.mjs codex)' : ''));

// career-ops: move forward to the version this release was tested with (never backwards, never over local edits).
if (existsSync(join(KIT, 'career-ops', '.git'))) {
  const { pinCareerOps } = await import('./lib/careerops-pin.mjs');
  const before = spawnSync('git', ['-C', join(KIT, 'career-ops'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const r = pinCareerOps();
  if (r.commit !== before) {
    const lock = existsSync(join(KIT, 'career-ops', 'package-lock.json'));
    spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [lock ? 'ci' : 'install', '--no-fund', '--no-audit'], { cwd: join(KIT, 'career-ops'), stdio: 'inherit', shell: process.platform === 'win32' });
    ok('career-ops updated to the tested version ' + r.commit.slice(0, 7));
  } else ok('career-ops ' + (r.note || 'up to date'));
}

// Schedule and shortcut point at this version's files.
if (scheduleStatus().exists || /^1\./.test(from)) {
  const s = schedule(cfg.refreshTime || '07:10');
  s.ok ? ok('Daily refresh schedule updated (' + (cfg.refreshTime || '07:10') + ')') : todo('Set up the daily schedule again: run setup, or use "Refresh now" on the board');
}
const sc = shortcut();
sc.ok ? ok('Job Board shortcut updated') : todo('Create a shortcut yourself, or start the board with: node app/start.mjs');

// Resume library (new in 2.0): tailored resumes and cover letters need it.
if (!existsSync(LIB_FILE)) {
  if (!cfg.resume || !existsSync(String(cfg.resume).replace(/^"|"$/g, ''))) todo('Build your resume library: in the app folder run  node onboard.mjs --library --resume "path to your resume"');
  else if (!st.ready) todo('After signing in, build your resume library: node onboard.mjs --library');
  else {
    console.log('  Building your resume library from ' + cfg.resume + ' (1-3 minutes)...');
    const r = spawnSync(process.execPath, ['onboard.mjs', '--library'], { cwd: APP, stdio: 'inherit' });
    r.status === 0 && existsSync(LIB_FILE) ? ok('Resume library built: tailored resumes start at the next refresh') : todo('Build your resume library: node onboard.mjs --library');
  }
} else ok('Resume library found');

writeState({ migrateNotes: notes, migratedFrom: from });
console.log(notes.length ? '\nTo finish, please:\n - ' + notes.join('\n - ') : '\nNothing else to do.');
