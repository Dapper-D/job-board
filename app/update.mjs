#!/usr/bin/env node
// Update the kit to the latest release, keeping your answers, jobs, documents and logs.
//   node update.mjs            check, show what's new, ask, then update
//   node update.mjs --check    only check
//   node update.mjs --yes      update without asking (used by the board's Update button)
// Internal: --install-into <kit> --source <folder>   (run by the NEW version to install itself)
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { appendFileSync, mkdirSync, readFileSync, existsSync, readlinkSync } from 'node:fs';
import { KIT, LOGS } from './lib/paths.mjs';
import { check, stage, install, writeState, localVersion } from './lib/update.mjs';

const argv = process.argv.slice(2);
const val = n => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
mkdirSync(LOGS, { recursive: true });
const LOG = join(LOGS, 'update.log');
const say = m => { console.log(m); appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); };

// Stops a running board so the new version's server starts fresh. Returns true if one was running.
async function stopBoard(kit) {
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(kit, 'config.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
  const base = `http://127.0.0.1:${cfg.port || 4777}/`;
  const up = () => fetch(base, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false);
  if (!(await up())) return false;
  const r = await fetch(base + 'api/shutdown', { method: 'POST', headers: { 'x-kit-token': cfg.token || '', 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!r || !r.ok) {
    // Older boards have no shutdown endpoint: stop the node process running this kit's server.mjs.
    const server = join(kit, 'app', 'server.mjs');
    if (process.platform === 'win32') spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*app\\server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
    else {
      // Mac/Linux: any "node ... server.mjs" whose path or working folder is this kit's app folder.
      const app = join(kit, 'app');
      const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout || '';
      for (const line of ps.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!m || !/node/.test(m[2]) || !/server\.mjs/.test(m[2]) || Number(m[1]) === process.pid) continue;
        let cwd = '';
        try { cwd = readlinkSync('/proc/' + m[1] + '/cwd'); } catch {
          cwd = ((spawnSync('lsof', ['-a', '-p', m[1], '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout || '').match(/^n(.*)$/m) || [])[1] || '';
        }
        if (m[2].includes(server) || cwd === app) try { process.kill(Number(m[1])); } catch {}
      }
    }
  }
  for (let i = 0; i < 10 && (await up()); i++) await new Promise(res => setTimeout(res, 500));
  return true;
}

if (val('--install-into')) {
  // Running from the downloaded (new) version: install it into the kit folder.
  const kit = val('--install-into'), source = val('--source');
  const wasRunning = await stopBoard(kit);
  const r = install({ source, kit, say });
  if (r.ok) {
    say('Running update steps for ' + r.to + '...');
    const m = spawnSync(process.execPath, [join(kit, 'app', 'migrate.mjs'), '--from', r.from, ...(argv.includes('--quiet') ? ['--quiet'] : [])], { cwd: join(kit, 'app'), stdio: 'inherit', env: { ...process.env, KIT_HOME: kit } });
    if (m.status !== 0) say('Some update steps need attention; see above. The new version is installed.');
  }
  if (wasRunning || argv.includes('--start-board')) spawnSync(process.execPath, [join(kit, 'app', 'start.mjs'), '--no-open'], { cwd: join(kit, 'app'), stdio: 'inherit', env: { ...process.env, KIT_HOME: kit } });
  process.exit(r.ok ? 0 : 1);
}

const info = await check({ force: true });
if (info.checkError && !info.latest) { say(info.checkError); writeState({ state: 'idle' }); process.exit(argv.includes('--check') ? 0 : 1); }
if (!info.available) { say(`You have the latest version (${info.current}).`); writeState({ state: 'idle' }); process.exit(0); }
console.log(`\nVersion ${info.latest} is available (you have ${info.current}).\n`);
if (info.notes) console.log(info.notes.split('\n').map(l => '  ' + l).join('\n') + '\n');
if (argv.includes('--check')) process.exit(0);
if (!argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question('Update now? Your answers, jobs, documents and logs are kept. (y/n) [y]: ')).trim();
  rl.close();
  if (/^n/i.test(a)) process.exit(0);
}
writeState({ state: 'updating', target: info.latest, startedAt: new Date().toISOString(), error: '' });
try {
  say('Downloading ' + info.latest + '...');
  const src = await stage(info);
  const r = spawnSync(process.execPath, [join(src, 'app', 'update.mjs'), '--install-into', KIT, '--source', src, ...argv.filter(a => a === '--quiet' || a === '--start-board')], { cwd: join(src, 'app'), stdio: 'inherit', env: { ...process.env, KIT_HOME: KIT } });
  const now = localVersion();
  if (r.status === 0) { writeState({ state: 'done', from: info.current, to: now, at: new Date().toISOString() }); say('Updated to ' + now + '.'); }
  else { writeState({ state: 'failed', error: 'The update didn\'t finish; the previous version was kept. See logs/update.log.', at: new Date().toISOString() }); process.exit(1); }
} catch (e) {
  say('Update failed: ' + e.message);
  writeState({ state: 'failed', error: e.message, at: new Date().toISOString() });
  process.exit(1);
}
