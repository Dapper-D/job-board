// Installs career-ops at the commit pinned in app/kit.json, so a change pushed to career-ops can't run on
// people's computers until a kit release has picked that version.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP, CAREER_OPS } from './paths.mjs';

const git = (args, quiet = true) => spawnSync('git', ['-C', CAREER_OPS, ...args], { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
export function pinned() {
  const k = JSON.parse(readFileSync(join(APP, 'kit.json'), 'utf8')).careerOps || {};
  if (!/^[0-9a-f]{40}$/.test(k.commit || '') || !/^https:\/\/github\.com\//.test(k.repo || '')) throw new Error('kit.json has no valid career-ops pin');
  return k;
}
// fresh: clone at the pin. existing: move forward to the pin only if the pin is newer (never downgrade, never discard edits).
export function pinCareerOps({ onlyForward = true } = {}) {
  const { repo, commit } = pinned();
  if (!existsSync(join(CAREER_OPS, '.git'))) {
    mkdirSync(CAREER_OPS, { recursive: true });
    for (const a of [['init', '-q'], ['remote', 'add', 'origin', repo], ['fetch', '--depth', '1', 'origin', commit], ['checkout', '-q', '--detach', 'FETCH_HEAD']]) {
      const r = git(a, a[0] === 'fetch' ? false : true);
      if (r.status !== 0) return { ok: false, why: 'Downloading career-ops failed (' + (r.stderr || '').trim().slice(0, 200) + '). Check your internet connection and run setup again.' };
    }
    return { ok: true, commit };
  }
  const head = (git(['rev-parse', 'HEAD']).stdout || '').trim();
  if (head === commit) return { ok: true, commit };
  if (git(['fetch', '-q', '--depth', '50', 'origin', commit]).status !== 0) return { ok: true, commit: head, note: 'couldn\'t fetch the pinned career-ops version; kept the current one' };
  if (onlyForward && git(['merge-base', '--is-ancestor', head, commit]).status !== 0) return { ok: true, commit: head, note: 'your career-ops is newer than the kit\'s pinned version; kept it' };
  const co = git(['checkout', '-q', '--detach', commit]);
  if (co.status !== 0) return { ok: true, commit: head, note: 'career-ops has local changes; kept the current version' };
  return { ok: true, commit };
}
