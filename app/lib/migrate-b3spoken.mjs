// Moves a Job Hunt Kit install over to B3spoken. Runs from the downloaded release (app/update.mjs --install-into)
// when that release contains B3spoken (b3spoken/src/helper/main.mjs), so every kit switches when it updates.
//
// Steps, in this order, so a failure never leaves someone with nothing:
//   1. Copy B3spoken's files from the signed release into a folder next to the kit ("B3spoken").
//   2. Leave a note in B3spoken's data folder saying where the kit is; B3spoken imports the kit's answers,
//      resume library and tracker from it the first time it starts.
//   3. Add B3spoken's shortcut with its own setup script (no launch).
//   Only once 1-3 worked:
//   4. Remove the kit's daily refresh and its shortcut, and leave a note in the kit folder.
//   5. Start B3spoken (it opens in the browser).
// If 1-3 fail, nothing of the kit was changed and the caller restarts the old board.
// The kit's own data (config.json, data/, documents/) is never changed or deleted.
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// What a B3spoken source install is made of (the same list as B3spoken's own source package).
export const B3_FILES = ['b3spoken', 'setup.cmd', 'uninstall.cmd', 'setup.ps1', 'setup.sh', 'uninstall.ps1', 'uninstall.sh', 'README.md', 'LICENSE', 'SECURITY.md'];
export const HINT = 'kit-import.json';

export const hasB3spoken = source => existsSync(join(source, 'b3spoken', 'src', 'helper', 'main.mjs'));

// A folder next to the kit. An existing B3spoken source install there is updated in place; any other
// folder with that name is left alone and a dated name is used instead.
export function chooseTarget(kit, today = new Date().toISOString().slice(0, 10)) {
  const parent = dirname(kit);
  const first = join(parent, 'B3spoken');
  const isB3 = d => existsSync(join(d, 'b3spoken', 'src', 'helper', 'main.mjs'));
  if (!existsSync(first) || isB3(first)) return first;
  for (let i = 0; i < 100; i++) {
    const d = join(parent, `B3spoken ${today}${i ? ' ' + (i + 1) : ''}`);
    if (!existsSync(d) || isB3(d)) return d;
  }
  throw new Error('Could not find a free folder name for B3spoken next to ' + kit);
}

export function copySource(source, target) {
  mkdirSync(target, { recursive: true });
  for (const f of B3_FILES) {
    const from = join(source, f);
    if (!existsSync(from)) continue;
    if (f === 'b3spoken') rmSync(join(target, f), { recursive: true, force: true }); // no stale files from an older copy
    cpSync(from, join(target, f), { recursive: true, force: true, dereference: false, verbatimSymlinks: true });
  }
  if (!existsSync(join(target, 'b3spoken', 'src', 'helper', 'main.mjs'))) throw new Error('B3spoken\'s files did not copy into ' + target);
}

// B3spoken's own data folder, worked out by B3spoken's own code so the two can never disagree.
export async function b3DataDir(source) {
  const { dataDir } = await import(pathToFileURL(join(source, 'b3spoken', 'src', 'helper', 'paths.mjs')).href);
  return dataDir();
}

export function writeHint(dataDirPath, kit, now = new Date().toISOString()) {
  mkdirSync(dataDirPath, { recursive: true, mode: 0o700 });
  writeFileSync(join(dataDirPath, HINT), JSON.stringify({ dir: kit, from: 'job-hunt-kit-update', at: now }, null, 2), { mode: 0o600 });
}

// B3spoken's setup script adds the shortcut (and on Windows, records the install). --no-launch: we start it ourselves.
export function runSetup(target, { platform = process.platform, run = spawnSync } = {}) {
  const r = platform === 'win32'
    ? run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(target, 'setup.ps1'), '-NoLaunch', '-Quiet'], { cwd: target, stdio: 'inherit', windowsHide: true })
    : run('bash', [join(target, 'setup.sh'), '--no-launch'], { cwd: target, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('B3spoken\'s setup did not finish (exit ' + r.status + ')');
}

export function startB3spoken(target) {
  const helper = join(target, 'b3spoken', 'src', 'helper', 'main.mjs');
  // No arguments: on Windows B3spoken then restarts itself in the background with its icon by the clock.
  const c = spawn(process.execPath, [helper], { cwd: target, detached: true, stdio: 'ignore', windowsHide: true });
  c.unref();
}

export const NOTE = 'MOVED TO B3SPOKEN.txt';
export function leaveNote(kit, target, now = new Date().toISOString()) {
  writeFileSync(join(kit, NOTE), [
    'This Job Hunt Kit was moved to B3spoken on ' + now.slice(0, 10) + '.',
    '',
    'B3spoken is installed in: ' + target,
    'Open it from the B3spoken shortcut. Your answers, resume library and tracked jobs were brought over.',
    '',
    'Nothing in this folder was deleted: your documents, config.json and data/ are still here.',
    'The kit\'s daily refresh and its shortcut were removed. Once you are happy with B3spoken, you can delete this folder.',
    '',
  ].join('\n'));
}

/**
 * Move the kit at `kit` to B3spoken using the release unpacked at `source`.
 * deps lets tests replace the steps that touch the system (setup script, schedule, shortcut, start).
 * Returns { ok: true, target } or { ok: false, error, kitChanged: false }.
 */
export async function migrate({ kit, source, say = console.log, deps = {} }) {
  const d = {
    dataDir: () => b3DataDir(source),
    setup: target => runSetup(target),
    unschedule: async () => (await import('./platform.mjs')).unschedule(),
    removeShortcut: async () => (await import('./platform.mjs')).removeShortcut(),
    start: target => startB3spoken(target),
    ...deps,
  };
  let target;
  try {
    target = chooseTarget(kit);
    say('Installing B3spoken into ' + target + '...');
    copySource(source, target);
    const data = await d.dataDir();
    writeHint(data, kit);
    say('Adding the B3spoken shortcut...');
    await d.setup(target);
  } catch (e) {
    say('Could not move to B3spoken: ' + e.message + '. Your kit was not changed.');
    return { ok: false, error: e.message, kitChanged: false };
  }
  // From here on B3spoken is installed; problems are reported but don't undo it.
  try { await d.unschedule(); } catch (e) { say('Could not remove the kit\'s daily refresh (' + e.message + '). You can remove it with: node app/uninstall.mjs'); }
  try { await d.removeShortcut(); } catch (e) { say('Could not remove the kit\'s shortcut (' + e.message + ').'); }
  try { leaveNote(kit, target); } catch {}
  try {
    const pj = join(kit, 'app', 'package.json');
    const p = JSON.parse(readFileSync(pj, 'utf8'));
    p.version = JSON.parse(readFileSync(join(source, 'app', 'package.json'), 'utf8')).version;
    writeFileSync(pj, JSON.stringify(p, null, 2) + '\n'); // so the old board stops offering this update
  } catch {}
  say('Starting B3spoken...');
  try { await d.start(target); } catch (e) { say('Open B3spoken from its shortcut (it did not start by itself: ' + e.message + ').'); }
  say('Done: you are now on B3spoken (' + basename(target) + '). Your kit folder was kept as it was.');
  return { ok: true, target };
}
