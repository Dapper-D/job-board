import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
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
const job = (o) => makeJob({ source: 'greenhouse', company: 'Acme', nativeId: o.id, title: o.title, url: `https://boards.greenhouse.io/acme/jobs/${o.id}`, location: o.location, postedAt: o.postedAt || '2026-11-04T00:00:00Z', description: 'Build things' });
const makePool = jobs => { const gz = gzipSync(JSON.stringify({ version: 1, jobs })); return { gz, meta: { version: 1, count: jobs.length, generatedAt: '2026-11-05T10:00:00Z', bytes: gz.length, sha256: createHash('sha256').update(gz).digest('hex') } }; };

test('data folder per operating system', () => {
  assert.equal(dataDir({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a'), join('C:\\Users\\a\\AppData\\Local', 'B3spoken'));
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
  const b = makeJob({ source: 'jobbank', company: 'Acme', nativeId: 99, title: 'Software Developer', url: 'https://www.jobbank.gc.ca/jobsearch/jobposting/99', location: 'Vancouver, BC', postedAt: '2026-11-05T00:00:00Z' });
  const c = job({ id: 2, title: 'Analyst', location: 'Toronto, ON' });
  const all = mergeJobs([a, c], [b]);
  assert.equal(all.length, 2);
  assert.equal(queryJobs(all, { province: 'BC' }).total, 1);
  assert.equal(queryJobs(all, { q: 'analyst' }).jobs[0].title, 'Analyst');
  assert.equal(queryJobs(all, { maxAgeDays: 3, now: Date.parse('2026-11-08T12:00:00Z') }).total, 0);
  assert.ok(inProvince({ location: 'Burnaby, British Columbia' }, 'BC'));
  assert.ok(!inProvince({ location: 'Toronto, ON' }, 'BC'));
  assert.equal('description' in queryJobs(all).jobs[0], false);
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
});
