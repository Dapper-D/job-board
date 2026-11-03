#!/usr/bin/env node
// Daily refresh as run by the scheduler: logs to logs/refresh-YYYY-MM-DD.log and keeps 30 days of logs.
import { readdirSync, statSync, unlinkSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOGS, APP } from './lib/paths.mjs';

mkdirSync(LOGS, { recursive: true });
const day = new Date().toLocaleDateString('en-CA');
const log = join(LOGS, 'refresh-' + day + '.log');
const r = spawnSync(process.execPath, [join(APP, 'refresh.mjs'), '--log', log, ...process.argv.slice(2)], { cwd: APP, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', windowsHide: true });
appendFileSync(join(LOGS, 'refresh-summary.log'), `${new Date().toISOString()} ${r.status === 0 ? 'OK' : 'FAILED (exit ' + r.status + ')'} -> ${log}\n`);
if (r.stderr) appendFileSync(join(LOGS, 'refresh-errors.log'), `--- ${new Date().toISOString()}\n${r.stderr.slice(-8000)}\n`);
for (const f of readdirSync(LOGS)) if (/^refresh-\d{4}-\d\d-\d\d\.log$/.test(f) && Date.now() - statSync(join(LOGS, f)).mtimeMs > 30 * 864e5) try { unlinkSync(join(LOGS, f)); } catch {}
process.exit(r.status || 0);
