// Keeps the kit's private files readable only by the person who installed it.
//   Mac/Linux: config.json and .env 600, data/ documents/ logs/ 700 (other accounts on the computer can't read them).
//   Windows: removes inherited access from config.json and .env and grants only the current user (icacls).
import { existsSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KIT } from './paths.mjs';

const FILES = ['config.json', '.env'];
const DIRS = ['data', 'documents', 'logs'];
let done = false;
export function harden({ force = false } = {}) {
  if (done && !force) return;
  done = true;
  if (process.platform === 'win32') {
    const user = process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' + process.env.USERNAME : process.env.USERNAME;
    if (!user) return;
    for (const f of FILES) {
      const p = join(KIT, f);
      if (existsSync(p)) spawnSync('icacls', [p, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore', windowsHide: true });
    }
    return;
  }
  for (const f of FILES) { const p = join(KIT, f); if (existsSync(p)) try { chmodSync(p, 0o600); } catch {} }
  for (const d of DIRS) { const p = join(KIT, d); if (existsSync(p) && statSync(p).isDirectory()) try { chmodSync(p, 0o700); } catch {} }
}
