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

// Boards found through job sites on earlier days live in the last published report.json (job-pool release),
// so each day's lookup limit goes to companies not tried before. A local file can be given with --known instead.
export async function previousKnownBoards(file, repo = process.env.GITHUB_REPOSITORY || 'Dapper-D/job-board') {
  try {
    if (file) return JSON.parse(readFileSync(file, 'utf8')).knownBoards || {};
    const r = await fetch(`https://github.com/${repo}/releases/download/job-pool/report.json`, { signal: AbortSignal.timeout(30000) });
    return r.ok ? ((await r.json()).knownBoards || {}) : {};
  } catch { return {}; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const employers = JSON.parse(readFileSync(arg('--employers', 'catalog/employers.json'), 'utf8')).employers
    .filter(e => SOURCES[e.source] && SOURCES[e.source].runsOn !== 'helper');
  const out = arg('--out', 'out');
  mkdirSync(out, { recursive: true });
  const known = await previousKnownBoards(arg('--known'));
  console.log(`Remembered employer boards from earlier days: ${Object.values(known).filter(k => k.source).length} found, ${Object.values(known).filter(k => k.none).length} not found`);
  const { pool, report, dropped, newBoards, knownBoards, counts } = await buildPool(employers, { log: console.log, known });
  const generatedAt = new Date().toISOString();
  const attribution = Object.values(SOURCES).filter(s => s.feed).map(s => ({ source: s.id, name: s.label }));
  const body = JSON.stringify({ version: 1, generatedAt, country: 'CA', count: pool.length, attribution,
    note: 'Job pool for B3spoken helpers. Job-site listings are shown under their sites\' terms (see SOURCES.md) and may not be passed on to other job boards or aggregators.',
    jobs: pool });
  const gz = gzipSync(body, { level: 9 });
  writeFileSync(join(out, 'pool.json.gz'), gz);
  const meta = { version: 1, generatedAt, country: 'CA', count: pool.length, bytes: gz.length, sha256: createHash('sha256').update(gz).digest('hex'), ...counts };
  writeFileSync(join(out, 'pool-meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(out, 'report.json'), JSON.stringify({ generatedAt, employers: report, dropped, newBoards, knownBoards }, null, 2));
  const failed = report.filter(r => !r.ok);
  const md = [`## Daily job pool: ${pool.length} unique jobs in Canada`, '',
    `- Unique jobs: ${counts.uniqueJobs} (from ${counts.listingsSeen} listings; ${counts.duplicatesMerged} duplicates merged, so each job is shown and counted once)`,
    `- Job-site jobs: ${counts.siteJobs}; confirmed on the employer's own board: ${counts.siteVerified}; dropped: ${counts.siteDropped} (not checked because of the daily limit: ${dropped.filter(d => /daily lookup limit/.test(d.why)).length})`,
    `- Unique jobs by source: ${Object.entries(counts.bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ')}`,
    `- Employers that failed today: ${failed.length}${failed.length ? ' (' + failed.slice(0, 10).map(f => f.name).join(', ') + ')' : ''}`,
    `- New employer boards found through job sites: ${newBoards.length}`,
    `- pool.json.gz: ${(gz.length / 1e6).toFixed(1)} MB, sha256 ${meta.sha256.slice(0, 16)}…`, ''].join('\n');
  console.log('\n' + md);
  console.log('NEWBOARDS ' + JSON.stringify(newBoards));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (pool.length < 100) { console.error('Pool is suspiciously small; not publishing.'); process.exit(1); }
}
