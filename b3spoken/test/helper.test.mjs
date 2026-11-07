import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dataDir } from '../src/helper/paths.mjs';
import { checkPool, updatePool, loadPool } from '../src/helper/pool.mjs';
import { mergeJobs, queryJobs, inProvince, refreshJobBank } from '../src/helper/jobs.mjs';
import { createServer } from '../src/helper/server.mjs';
import { createApp, cleanSettings } from '../src/helper/main.mjs';
import { findOnPath } from '../src/helper/ai.mjs';
import { makeJob } from '../src/scan/job.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'b3-test-'));
const job = (o) => makeJob({ source: 'greenhouse', company: 'Acme', nativeId: o.id, title: o.title, url: `https://boards.greenhouse.io/acme/jobs/${o.id}`, location: o.location, postedAt: o.postedAt || new Date(Date.now() - 864e5).toISOString(), description: 'Build things' });
const makePool = jobs => { const gz = gzipSync(JSON.stringify({ version: 1, jobs })); return { gz, meta: { version: 1, count: jobs.length, generatedAt: '2026-11-05T10:00:00Z', bytes: gz.length, sha256: createHash('sha256').update(gz).digest('hex') } }; };

test('data folder per operating system', () => {
  assert.equal(dataDir({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Local\\B3spoken');
  assert.equal(dataDir({}, 'darwin', '/Users/a'), '/Users/a/Library/Application Support/B3spoken');
  assert.equal(dataDir({}, 'linux', '/home/a'), '/home/a/.local/share/b3spoken');
  assert.equal(dataDir({ B3SPOKEN_HOME: '/x' }, 'linux', '/home/a'), '/x');
});

test('pool is checked by size and SHA-256 before it is saved', async () => {
  const { gz, meta } = makePool([job({ id: 1, title: 'Developer', location: 'Vancouver, BC' })]);
  assert.equal(checkPool(gz, meta).jobs.length, 1);
  assert.throws(() => checkPool(Buffer.concat([gz, Buffer.from('x')]), meta), /bytes/);
  const bad = Buffer.from(gz); bad[bad.length - 5] ^= 1;
  assert.throws(() => checkPool(bad, meta), /SHA-256/);
  const dir = tmp();
  const get = async (url, o) => url.endsWith('meta.json') ? { json: meta } : { buffer: o.parse === 'buffer' ? bad : gz };
  await assert.rejects(updatePool(dir, { get }), /SHA-256/);
  assert.equal(loadPool(dir), null); // nothing saved from a bad download
  const good = async (url) => url.endsWith('meta.json') ? { json: meta } : { buffer: gz };
  assert.equal((await updatePool(dir, { get: good })).updated, true);
  assert.equal((await updatePool(dir, { get: good })).updated, false); // same checksum: no second download
  assert.equal(loadPool(dir).pool.jobs.length, 1);
  writeFileSync(join(dir, 'pool.json.gz'), Buffer.from('tampered'));
  assert.equal(loadPool(dir), null);
});

test('pool and Job Bank are merged without duplicates; filters', async () => {
  const a = job({ id: 1, title: 'Software Developer', location: 'Vancouver, BC' });
  const b = makeJob({ source: 'jobbank', company: 'Acme', nativeId: 99, title: 'Software Developer', url: 'https://www.jobbank.gc.ca/jobsearch/jobposting/99', location: 'Vancouver, BC', postedAt: new Date(Date.now() - 864e5).toISOString() });
  const c = job({ id: 2, title: 'Analyst', location: 'Toronto, ON' });
  const all = mergeJobs([a, c], [b]);
  assert.equal(all.length, 2);
  assert.equal(queryJobs(all, { province: 'BC' }).total, 1);
  assert.equal(queryJobs(all, { q: 'analyst' }).jobs[0].title, 'Analyst');
  assert.equal(queryJobs(all, { maxAgeDays: 3, now: Date.now() + 5 * 864e5 }).total, 0);
  assert.ok(inProvince({ location: 'Burnaby, British Columbia' }, 'BC'));
  assert.ok(!inProvince({ location: 'Toronto, ON' }, 'BC'));
  assert.equal('description' in queryJobs(all).jobs[0], false);
  const many = queryJobs([{ ...a, location: 'A, BC / B, BC / C, BC / D, BC / E, BC' }]).jobs[0];
  assert.equal(many.location, 'A, BC / B, BC / C, BC'); assert.equal(many.moreLocations, 2);
  const dir = tmp(); let calls = 0;
  const fetchJobs = async () => { calls++; return [b]; };
  await refreshJobBank(dir, { keywords: ['dev'] }, { fetchJobs, now: 1e12 });
  await refreshJobBank(dir, { keywords: ['dev'] }, { fetchJobs, now: 1e12 + 3600e3 }); // within 6 h: cached
  await refreshJobBank(dir, { keywords: ['nurse'] }, { fetchJobs, now: 1e12 + 3600e3 }); // new keywords: fetch again
  assert.equal(calls, 2);
});

test('settings are cleaned', () => {
  assert.deepEqual(cleanSettings({ keywords: [' dev ', 'dev', '', 'x'.repeat(99)], province: 'XX', remote: 'maybe', ai: 'rm -rf' }), { keywords: ['dev', 'x'.repeat(60)], province: '', remote: 'yes', ai: 'auto' });
});

test('local server: host check, token, origin, and the board works end to end', async () => {
  const dir = tmp();
  const { gz, meta } = makePool([job({ id: 1, title: 'Developer', location: 'Vancouver, BC' }), job({ id: 2, title: 'Analyst', location: 'Toronto, ON' })]);
  writeFileSync(join(dir, 'pool.json.gz'), gz); writeFileSync(join(dir, 'pool-meta.json'), JSON.stringify(meta));
  const app = createApp(dir, { offline: true, log: () => {}, deps: { detect: async () => ({}) } });
  await app.refresh();
  const srv = createServer(app, { token: 'secret-token-123' });
  const port = await srv.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(await page.text(), /secret-token-123/);
    assert.equal((await fetch(`${base}/api/status`)).status, 403);
    const h = { 'x-b3spoken-token': 'secret-token-123' };
    assert.equal((await fetch(`${base}/api/status`, { headers: { ...h, origin: 'https://evil.example' } })).status, 403);
    const s = await (await fetch(`${base}/api/status`, { headers: h })).json();
    assert.equal(s.jobs, 2);
    const r = await (await fetch(`${base}/api/jobs?province=BC`, { headers: h })).json();
    assert.equal(r.total, 1);
    const one = await (await fetch(`${base}/api/jobs/${encodeURIComponent(r.jobs[0].id)}`, { headers: h })).json();
    assert.equal(one.description, 'Build things');
    const saved = await (await fetch(`${base}/api/settings`, { method: 'PUT', headers: h, body: JSON.stringify({ keywords: ['developer'], province: 'BC' }) })).json();
    assert.deepEqual(saved.keywords, ['developer']);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).keywords, ['developer']);
    // A request addressed to another host name (DNS rebinding) is refused.
    const http = await import('node:http');
    const status = await new Promise(res => http.get({ host: '127.0.0.1', port, path: '/', headers: { host: `evil.example:${port}` } }, r => { r.resume(); res(r.statusCode); }));
    assert.equal(status, 421);
  } finally { await srv.close(); }
});

test('finds AI tools on PATH without a shell', () => {
  const dir = tmp(); writeFileSync(join(dir, 'codex'), '');
  assert.equal(findOnPath('codex', { PATH: dir }, 'linux'), join(dir, 'codex'));
  assert.equal(findOnPath('claude', { PATH: dir }, 'linux'), null);
  // Found in the installer's usual folder even when PATH doesn't list it.
  const home = tmp(); mkdirSync(join(home, '.local', 'bin'), { recursive: true }); writeFileSync(join(home, '.local', 'bin', 'claude'), '');
  assert.equal(findOnPath('claude', { PATH: '', HOME: home }, 'linux'), join(home, '.local', 'bin', 'claude'));
});

test('one-click AI install and sign-in use each company\u2019s official installer; no user text in commands', async () => {
  const { installCommand, signInCommand, startInstall, testAi } = await import('../src/helper/ai.mjs');
  assert.deepEqual(installCommand('claude', 'win32').args.at(-1), 'irm https://claude.ai/install.ps1 | iex');
  assert.deepEqual(installCommand('codex', 'darwin'), { file: '/bin/sh', args: ['-c', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'] });
  assert.throws(() => installCommand('evil'), /unknown/);
  assert.match(signInCommand('codex', 'C:\\Users\\a\\.local\\bin\\codex.exe', 'win32').args.join(' '), /start "B3spoken sign-in" cmd \/k "C:\\Users\\a\\.local\\bin\\codex\.exe" login/);
  assert.match(signInCommand('claude', '/Users/a/.local/bin/claude', 'darwin').args[1], /do script "'\/Users\/a\/\.local\/bin\/claude'"/);
  const { EventEmitter } = await import('node:events');
  let ran;
  const fake = (file, args) => { ran = [file, args]; const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}; setImmediate(() => { c.stdout.emit('data', 'installing'); c.emit('close', 1); }); return c; };
  const job = startInstall('codex', { spawnFn: fake, platform: 'linux' });
  assert.equal(job.state, 'running');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(job.state, 'failed'); // exit code 1
  assert.equal(ran[0], '/bin/sh');
  assert.deepEqual(await testAi('claude', async () => 'OK'), { ok: true, answer: 'OK' });
  assert.match((await testAi('claude', async () => { throw new Error('Please run /login'); })).error, /Not signed in/);
});

test('documents are made ahead of time for Strong and Good matches from the last 3 days', async () => {
  const dir = tmp();
  const fresh = new Date(Date.now() - 864e5).toISOString(), old = new Date(Date.now() - 10 * 864e5).toISOString();
  const desc = 'Python, Flask, REST APIs, pytest, Docker, PostgreSQL and GitHub Actions.';
  const jobs = [
    makeJob({ source: 'greenhouse', company: 'Acme', nativeId: 1, title: 'Software Developer', url: 'https://boards.greenhouse.io/acme/jobs/1', location: 'Vancouver, BC', postedAt: fresh, description: desc }),
    makeJob({ source: 'greenhouse', company: 'Acme', nativeId: 2, title: 'Software Developer II', url: 'https://boards.greenhouse.io/acme/jobs/2', location: 'Vancouver, BC', postedAt: old, description: desc }),
    makeJob({ source: 'greenhouse', company: 'Acme', nativeId: 3, title: 'Store Associate', url: 'https://boards.greenhouse.io/acme/jobs/3', location: 'Vancouver, BC', postedAt: fresh, description: 'Stock shelves.' }),
  ];
  const { gz, meta } = makePool(jobs);
  writeFileSync(join(dir, 'pool.json.gz'), gz); writeFileSync(join(dir, 'pool-meta.json'), JSON.stringify(meta));
  const app = createApp(dir, { offline: true, log: () => {}, deps: { detect: async () => ({}), allowOfflinePrep: true } });
  app.uploadResume({ filename: 'r.docx', dataBase64: readFileSync(new URL('./fixtures/resume/sample-resume.docx', import.meta.url)).toString('base64') });
  app.saveProfile({ targetRoles: ['Software Developer'], province: 'BC', done: true });
  await app.refresh();
  for (let i = 0; i < 50 && !(await app.status()).preparing?.total; i++) await new Promise(r => setTimeout(r, 20));
  for (let i = 0; i < 200 && (await app.status()).preparing?.running; i++) await new Promise(r => setTimeout(r, 20));
  const made = JSON.parse(readFileSync(join(dir, 'documents', 'index.json'), 'utf8'));
  assert.deepEqual(Object.values(made).map(d => d.files.resume), ['Jordan Lee - Resume - Acme - Software Developer.pdf']); // old and unmatched jobs skipped
});
