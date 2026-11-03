// Updates the kit from its GitHub Releases without touching the person's data.
//
// How an update runs:
//   1. check()   - asks GitHub for the latest release (cached for 6 hours) and compares versions.
//   2. stage()   - downloads that release's source archive and unpacks it into .update/ (tar is built into
//                  Windows 10+, macOS and Linux).
//   3. The NEW version's own installer (its app/update.mjs --install-into) does the install, so fixes to the
//      installer itself ship with each release:
//        - stops the board, backs up every kit file it will replace,
//        - copies the new files in, removes files the new version no longer ships,
//        - runs npm install and the new version's migrate.mjs (schedule, shortcut, AI tool, resume library),
//        - restarts the board. If anything fails it restores the backup.
// Never touched: config.json, .env, data/, documents/, logs/, career-ops/, tools/, cv-preview.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, copyFileSync, createWriteStream } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { APP, KIT, DATA } from './paths.mjs';

export const KEEP = ['config.json', '.env', 'data', 'documents', 'logs', 'career-ops', 'tools', 'cv-preview.md', 'node_modules', '.update', '.git', 'backups'];
const STATE = join(DATA, 'update.json');
const UPD = join(KIT, '.update');
const MANIFEST = join(APP, '.kit-files.json');

export function localVersion(root = APP) {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}
export function repo() {
  if (process.env.KIT_UPDATE_REPO) return process.env.KIT_UPDATE_REPO;
  try { return JSON.parse(readFileSync(join(APP, 'kit.json'), 'utf8')).repo; } catch { return 'Dapper-D/job-board'; }
}
const API = () => (process.env.KIT_UPDATE_API || 'https://api.github.com').replace(/\/$/, '');
// "v2.10.0" > "v2.9.3"
export function newer(a, b) {
  const p = v => String(v || '0').replace(/^v/i, '').split(/[.-]/).map(x => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

export function readState() { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } }
export function writeState(patch) {
  mkdirSync(DATA, { recursive: true });
  const s = { ...readState(), ...patch };
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  return s;
}

// Latest release info. { current, latest, available, notes, url, checkedAt } (cached unless force).
export async function check({ force = false } = {}) {
  const current = localVersion();
  const st = readState();
  if (!force && st.checkedAt && Date.now() - new Date(st.checkedAt).getTime() < 6 * 3600e3 && st.latest) {
    return { ...st, current, available: newer(st.latest, current) };
  }
  try {
    const r = await fetch(`${API()}/repos/${repo()}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'job-hunt-kit-updater' }, signal: AbortSignal.timeout(20000) });
    if (r.status === 404) return writeState({ checkedAt: new Date().toISOString(), latest: '', checkError: 'No releases published yet', current, available: false });
    if (!r.ok) throw new Error('GitHub said ' + r.status);
    const j = await r.json();
    const s = writeState({ checkedAt: new Date().toISOString(), latest: String(j.tag_name || '').replace(/^v/i, ''), notes: String(j.body || '').slice(0, 6000),
      url: j.html_url || '', tarball: j.tarball_url || '', published: j.published_at || '', checkError: '' });
    return { ...s, current, available: newer(s.latest, current) };
  } catch (e) {
    return { ...writeState({ checkError: 'Couldn\'t reach GitHub: ' + e.message }), current, available: newer(st.latest, current) };
  }
}

// Downloads and unpacks the release; returns the folder that holds the new kit (the one with app/package.json).
export async function stage(info) {
  rmSync(UPD, { recursive: true, force: true });
  mkdirSync(join(UPD, 'new'), { recursive: true });
  const file = join(UPD, 'release.tar.gz');
  const r = await fetch(info.tarball, { headers: { 'user-agent': 'job-hunt-kit-updater' }, redirect: 'follow', signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
  const t = spawnSync('tar', ['-xzf', file, '-C', join(UPD, 'new')], { encoding: 'utf8' });
  if (t.status !== 0) throw new Error('Couldn\'t unpack the update (tar: ' + (t.stderr || t.error && t.error.message || '').trim().slice(0, 200) + ')');
  const top = readdirSync(join(UPD, 'new')).map(n => join(UPD, 'new', n)).find(p => existsSync(join(p, 'app', 'package.json')));
  if (!top) throw new Error('The download doesn\'t look like this kit');
  const pkg = JSON.parse(readFileSync(join(top, 'app', 'package.json'), 'utf8'));
  if (pkg.name !== 'job-hunt-kit') throw new Error('The download isn\'t the Job Hunt Kit');
  return top;
}

// ---- install side (run from the NEW version's code) ----
const isKept = rel => KEEP.includes(rel.split(/[\\/]/)[0]) || rel === join('app', 'node_modules') || rel.startsWith(join('app', 'node_modules') + sep) || rel === join('app', '.kit-files.json');
export function listFiles(root) {
  const out = [];
  const walk = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n), rel = relative(root, p);
      if (isKept(rel)) continue;
      if (statSync(p).isDirectory()) walk(p); else out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}
const copy = (from, to) => { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); };

// Files an older kit shipped, for kits installed before the manifest existed (v1: Windows/Codex kit).
const V1_EXTRA = ['run-refresh.ps1', 'start-board.ps1', 'uninstall.ps1'];

export function install({ source, kit, say = console.log }) {
  const oldVersion = localVersion(join(kit, 'app'));
  const newVersion = localVersion(join(source, 'app'));
  const oldFiles = existsSync(join(kit, 'app', '.kit-files.json')) ? JSON.parse(readFileSync(join(kit, 'app', '.kit-files.json'), 'utf8')) : listFiles(kit);
  const newFiles = listFiles(source);
  const backup = join(kit, '.update', 'backup-' + oldVersion);
  say(`Updating from ${oldVersion} to ${newVersion}...`);

  // Back up everything that will change or go away.
  rmSync(backup, { recursive: true, force: true });
  const touched = [...new Set([...oldFiles, ...newFiles])].filter(f => existsSync(join(kit, f)));
  for (const f of touched) copy(join(kit, f), join(backup, f));
  const restore = why => {
    say('Update failed: ' + why + '. Putting the previous version back...');
    for (const f of newFiles) if (!touched.includes(f)) rmSync(join(kit, f), { force: true });
    for (const f of touched) copy(join(backup, f), join(kit, f));
    spawnSync(npm(), ['install', '--no-fund', '--no-audit'], { cwd: join(kit, 'app'), stdio: 'ignore', shell: process.platform === 'win32' });
    say('Restored ' + oldVersion + '. Your data was not changed.');
  };
  try {
    for (const f of newFiles) copy(join(source, f), join(kit, f));
    for (const f of oldFiles) if (!newFiles.includes(f) && !isKept(f)) rmSync(join(kit, f), { force: true });
    say('Installing packages...');
    const n = spawnSync(npm(), ['install', '--no-fund', '--no-audit'], { cwd: join(kit, 'app'), stdio: 'inherit', shell: process.platform === 'win32' });
    if (n.status !== 0) throw new Error('npm install failed');
    writeFileSync(join(kit, 'app', '.kit-files.json'), JSON.stringify(newFiles, null, 1));
  } catch (e) { restore(e.message); return { ok: false, from: oldVersion, to: newVersion, error: e.message }; }
  return { ok: true, from: oldVersion, to: newVersion, oldFiles };
}
const npm = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');
export { V1_EXTRA, UPD };
