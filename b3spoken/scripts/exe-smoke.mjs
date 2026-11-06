// Tests the installed B3spoken.exe on Windows: it starts, serves the board pages from inside the .exe,
// downloads and verifies the real job pool, uses the catalog inside the .exe for pasted links, and a second
// start finds the first one instead of starting twice.
//   node scripts/exe-smoke.mjs "<path to B3spoken.exe>"
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2];
const home = mkdtempSync(join(tmpdir(), 'b3-exe-'));
const env = { ...process.env, B3SPOKEN_HOME: home, B3SPOKEN_SKIP_JOBBANK: '1' };
const child = spawn(exe, ['--no-open', '--port', '4791'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let out = ''; child.stdout.on('data', d => { out += d; process.stdout.write(d); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error('FAIL', m); child.kill(); process.exit(1); };
try {
  let url; for (let i = 0; i < 100 && !(url = (out.match(/running at (http:\S+)/) || [])[1]); i++) await wait(200);
  if (!url) fail('the .exe did not start');
  if ((await (await fetch(url + 'health')).json()).app !== 'b3spoken') fail('no health answer');
  const html = await (await fetch(url)).text();
  const token = (html.match(/name="b3spoken-token" content="([^"]+)"/) || [])[1];
  if (!token) fail('board page missing');
  if ((await fetch(url + 'setup')).status !== 200 || (await fetch(url + 'app.js')).status !== 200) fail('pages inside the .exe are missing');
  const h = { 'x-b3spoken-token': token, 'content-type': 'application/json' };
  let s; for (let i = 0; i < 120; i++) { s = await (await fetch(url + 'api/status', { headers: h })).json(); if (s.lastRefresh) break; await wait(1000); }
  console.log(JSON.stringify({ pool: s.pool, jobs: s.jobs, problems: s.problems }));
  if (!(s.pool?.count > 100)) fail('job pool did not load');
  const list = await (await fetch(url + 'api/jobs?sort=date&limit=200', { headers: h })).json();
  const gh = list.jobs.find(j => j.source === 'greenhouse');
  if (gh) { const r = await (await fetch(url + 'api/paste', { method: 'POST', headers: h, body: JSON.stringify({ url: gh.url }) })).json(); console.log('paste known job:', r.how); if (r.how !== 'already in your list') fail('pasted job not matched'); }
  const li = await fetch(url + 'api/paste', { method: 'POST', headers: h, body: JSON.stringify({ url: 'https://www.linkedin.com/jobs/view/1' }) });
  if (li.status !== 422) fail('LinkedIn link was not refused');
  const cat = await (await fetch(url + 'api/paste', { method: 'POST', headers: h, body: JSON.stringify({ url: 'https://jobs.hydroone.com/job/not-a-real-job/1/' }) })).json();
  console.log('paste via catalog:', cat.error);
  if (!/live job list|72 hours/.test(cat.error || '')) fail('catalog inside the .exe was not used');
  const second = execFileSync(exe, ['--no-open'], { env, encoding: 'utf8', timeout: 20000 });
  if (!/already running/.test(second)) fail('a second start did not find the first');
  console.log('OK B3spoken.exe smoke test');
} finally { child.kill(); }
