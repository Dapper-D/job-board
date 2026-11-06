// Starts the real helper with a fresh data folder, downloads and verifies the real job pool,
// then uses the board's API the way the page does. Job Bank is skipped (it refuses cloud servers).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'b3-smoke-'));
const child = spawn(process.execPath, ['src/helper/main.mjs', '--no-open', '--port', '4799'], { env: { ...process.env, B3SPOKEN_HOME: dir, B3SPOKEN_SKIP_JOBBANK: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = ''; child.stdout.on('data', d => { out += d; process.stdout.write(d); });
const fail = m => { console.error('FAIL', m); child.kill(); process.exit(1); };
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  let url; for (let i = 0; i < 50 && !(url = (out.match(/running at (http:\S+)/) || [])[1]); i++) await wait(200);
  if (!url) fail('helper did not start');
  const html = await (await fetch(url)).text();
  const token = (html.match(/name="b3spoken-token" content="([^"]+)"/) || [])[1];
  if (!token || token === '__TOKEN__') fail('no token in page');
  const h = { 'x-b3spoken-token': token };
  let s; for (let i = 0; i < 120; i++) { s = await (await fetch(url + 'api/status', { headers: h })).json(); if (!s.refreshing && s.lastRefresh) break; await wait(1000); }
  console.log(JSON.stringify({ pool: s.pool, jobs: s.jobs, problems: s.problems, ai: s.ai }, null, 2));
  if (!s.pool || s.pool.count < 100 || s.jobs < 100) fail('pool did not load');
  const bc = await (await fetch(url + 'api/jobs?province=BC&limit=3', { headers: h })).json();
  console.log(`BC jobs: ${bc.total}; first: ${bc.jobs.map(j => `${j.title} @ ${j.company} (${j.location})`).join(' | ')}`);
  if (!(bc.total > 0)) fail('no BC jobs');
  console.log('OK helper smoke test');
} finally { child.kill(); }
