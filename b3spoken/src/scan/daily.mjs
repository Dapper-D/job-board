// The daily shared scan (step 2). Reads every employer and job site, keeps jobs in Canada,
// cross-checks job-site jobs against the employer's own board (unconfirmed ones are dropped), removes duplicates,
// and writes the job pool that everyone's helper downloads:
//   out/pool.json.gz   the jobs (gzip JSON)
//   out/pool-meta.json count, time, size and SHA-256 of pool.json.gz, so the helper can check what it downloaded
//   out/report.json    what worked, what failed, what was dropped and why
//   node src/scan/daily.mjs --employers catalog/employers.json --out out
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { scanEmployers, dedupe } from './scan.mjs';
import { verifyFeedJobs } from './verify.mjs';
import { SOURCES } from './sources/index.mjs';
import { discover, norm as nameKey } from './discover.mjs';
import { describeMissing, previousDescriptions } from './describe.mjs';

const DESCRIPTION_MAX = 8000;

export async function buildPool(employers, { log = () => {}, known = {} } = {}) {
  const { jobs, report } = await scanEmployers(employers, { log });
  const own = jobs.filter(j => j.employerVerified);
  const fromSites = jobs.filter(j => !j.employerVerified);
  log(`\nChecking ${fromSites.length} job-site jobs against employers' own boards...`);
  const { verified, dropped, newBoards, known: knownBoards } = await verifyFeedJobs(fromSites, own, { log, known });
  const pool = dedupe([...own, ...verified]).map(j => ({ ...j, description: j.description.length > DESCRIPTION_MAX ? j.description.slice(0, DESCRIPTION_MAX) + '…' : j.description }));
  pool.sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
  const listings = own.length + verified.length;
  const bySource = pool.reduce((m, j) => (m[j.source] = (m[j.source] || 0) + 1, m), {});
  return { pool, report, dropped, newBoards, knownBoards, counts: { uniqueJobs: pool.length, listingsSeen: listings, duplicatesMerged: listings - pool.length, siteJobs: fromSites.length, siteVerified: verified.length, siteDropped: dropped.length, bySource } };
}

// What earlier days learned lives in the last published report.json (job-pool release): boards found through job
// sites (knownBoards) and hiring systems found for listed employers (discovered). A local file can be given instead.
export async function previousReport(file, repo = process.env.GITHUB_REPOSITORY || 'Dapper-D/job-board') {
  try {
    if (file) return JSON.parse(readFileSync(file, 'utf8'));
    const r = await fetch(`https://github.com/${repo}/releases/download/job-pool/report.json`, { signal: AbortSignal.timeout(30000) });
    return r.ok ? await r.json() : {};
  } catch { return {}; }
}
export async function previousKnownBoards(file, repo) { return (await previousReport(file, repo)).knownBoards || {}; }

// Every listed employer (catalog/seeds.json) without a known hiring system gets looked up, a few each day, so new
// employers are scanned without anyone editing the catalog. Found ones are scanned from then on; ones not found are
// tried again after RETRY_DAYS. Returns { employers to add to today's scan, discovered (to keep for tomorrow) }.
// A discovered board that fails when read (e.g. a 404 from a wrong guess) goes back to "not found", so it's
// looked up again later instead of failing every day.
export function forgetFailed(discovered, report, today = new Date().toISOString().slice(0, 10)) {
  const failed = new Map(report.filter(r => !r.ok).map(r => [nameKey(r.name), r]));
  for (const [k, d] of Object.entries(discovered)) {
    const f = d.source && failed.get(k);
    if (f && f.source === d.source) discovered[k] = { name: d.name, none: today, failedSource: d.source, error: String(f.error || '').slice(0, 120) };
  }
  return discovered;
}

// Some hiring systems don't say when a job was posted (SuccessFactors, Avature, Rippling...). Those jobs carry firstSeen:
// the first day the daily scan saw them, remembered from one day to the next in report.json, so the board can still
// tell a new job from an old one. Returns the map to keep for tomorrow (only jobs still open).
export function stampFirstSeen(pool, previous = {}, today = new Date().toISOString().slice(0, 10)) {
  const keep = {};
  for (const j of pool) {
    if (j.postedAt) continue;
    j.firstSeen = keep[j.id] = previous[j.id] || today;
  }
  return keep;
}

export const DISCOVER_PER_DAY = 200, DISCOVER_RETRY_DAYS = 14;
export async function discoverDaily(seeds, catalog, previous = {}, { log = () => {}, today = new Date().toISOString().slice(0, 10), find = discover, perDay = DISCOVER_PER_DAY } = {}) {
  const inCatalog = new Set(catalog.map(e => nameKey(e.name)));
  const mem = { ...previous };
  const stale = d => !d || (Date.parse(today) - Date.parse(d)) / 864e5 >= DISCOVER_RETRY_DAYS;
  const todo = seeds.filter(s => s?.name && !inCatalog.has(nameKey(s.name)) && !mem[nameKey(s.name)]?.source && stale(mem[nameKey(s.name)]?.none))
    .sort((a, b) => String(mem[nameKey(a.name)]?.none || '').localeCompare(String(mem[nameKey(b.name)]?.none || ''))) // never-tried first
    .slice(0, perDay);
  if (todo.length) {
    log(`Looking up the hiring system for ${todo.length} listed employers...`);
    const { found, missing } = await find(todo, { log });
    for (const f of found) if (SOURCES[f.source] && !SOURCES[f.source].feed) mem[nameKey(f.name)] = { name: f.name, source: f.source, target: f.target, how: f.how, found: today, ...(f.sector ? { sector: f.sector } : {}) };
    for (const m of missing) mem[nameKey(m.name)] = { name: m.name, none: today, seen: m.seenHosts || [] };
  }
  const employers = Object.values(mem).filter(m => m.source && SOURCES[m.source] && !inCatalog.has(nameKey(m.name)))
    .map(m => ({ name: m.name, source: m.source, target: m.target, found: m.how || 'found by the daily scan' }));
  return { employers, discovered: mem };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const employers = JSON.parse(readFileSync(arg('--employers', 'catalog/employers.json'), 'utf8')).employers
    .filter(e => SOURCES[e.source] && SOURCES[e.source].runsOn !== 'helper');
  const out = arg('--out', 'out');
  mkdirSync(out, { recursive: true });
  const prev = await previousReport(arg('--known'));
  const known = prev.knownBoards || {};
  console.log(`Remembered employer boards from earlier days: ${Object.values(known).filter(k => k.source).length} found, ${Object.values(known).filter(k => k.none).length} not found`);
  let seeds = [];
  try { seeds = JSON.parse(readFileSync(arg('--seeds', 'catalog/seeds.json'), 'utf8')).seeds || []; } catch {}
  const { employers: extra, discovered } = await discoverDaily(seeds, employers, prev.discovered || {}, { log: console.log });
  console.log(`Employers found by discovery and scanned today: ${extra.length}`);
  const { pool, report, dropped, newBoards, knownBoards, counts } = await buildPool([...employers, ...extra], { log: console.log, known });
  forgetFailed(discovered, report);
  const firstSeen = stampFirstSeen(pool, prev.firstSeen || {});
  // Read the descriptions the job lists leave out (Workday, SuccessFactors...), keeping those read on earlier days.
  const described = await describeMissing(pool, await previousDescriptions(arg('--previous-pool')), prev.descriptionMisses || {}, { log: console.log });
  counts.descriptions = { read: described.read, carried: described.carried, missed: described.missed, left: described.left, empty: pool.filter(j => !j.description).length };
  const generatedAt = new Date().toISOString();
  const attribution = Object.values(SOURCES).filter(s => s.feed).map(s => ({ source: s.id, name: s.label }));
  const body = JSON.stringify({ version: 1, generatedAt, country: 'CA', count: pool.length, attribution,
    note: 'Job pool for B3spoken helpers. Job-site listings are shown under their sites\' terms (see SOURCES.md) and may not be passed on to other job boards or aggregators.',
    jobs: pool });
  const gz = gzipSync(body, { level: 9 });
  writeFileSync(join(out, 'pool.json.gz'), gz);
  const meta = { version: 1, generatedAt, country: 'CA', count: pool.length, bytes: gz.length, sha256: createHash('sha256').update(gz).digest('hex'), ...counts };
  writeFileSync(join(out, 'pool-meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(out, 'report.json'), JSON.stringify({ generatedAt, employers: report, dropped, newBoards, knownBoards, discovered, firstSeen, descriptionMisses: described.misses }, null, 2));
  const failed = report.filter(r => !r.ok);
  const md = [`## Daily job pool: ${pool.length} unique jobs in Canada`, '',
    `- Unique jobs: ${counts.uniqueJobs} (from ${counts.listingsSeen} listings; ${counts.duplicatesMerged} duplicates merged, so each job is shown and counted once)`,
    `- Job-site jobs: ${counts.siteJobs}; confirmed on the employer's own board: ${counts.siteVerified}; dropped: ${counts.siteDropped} (not checked because of the daily limit: ${dropped.filter(d => /daily lookup limit/.test(d.why)).length})`,
    `- Unique jobs by source: ${Object.entries(counts.bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ')}`,
    `- Employers that failed today: ${failed.length}${failed.length ? ' (' + failed.slice(0, 10).map(f => f.name).join(', ') + ')' : ''}`,
    `- New employer boards found through job sites: ${newBoards.length}`,
    `- Listed employers found by discovery (scanned today): ${extra.length}; still not found: ${Object.values(discovered).filter(d => d.none).length}`,
    `- Descriptions read from job pages today: ${described.read}; kept from earlier days: ${described.carried}; pages with none: ${described.missed}; left for tomorrow: ${described.left}; jobs still without one: ${counts.descriptions.empty}`,
    `- pool.json.gz: ${(gz.length / 1e6).toFixed(1)} MB, sha256 ${meta.sha256.slice(0, 16)}…`, ''].join('\n');
  console.log('\n' + md);
  console.log('NEWBOARDS ' + JSON.stringify(newBoards));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (pool.length < 100) { console.error('Pool is suspiciously small; not publishing.'); process.exit(1); }
}
