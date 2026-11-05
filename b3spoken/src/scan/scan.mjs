// The daily scan: read the employer list, ask each employer's hiring system for its jobs,
// keep the ones in Canada (or remote and open to Canada), drop duplicates, write the job pool.
//   node src/scan/scan.mjs --employers data/employers.json --out out [--only greenhouse] [--limit 5]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCES } from './sources/index.mjs';

export async function scanEmployers(employers, { concurrency = 6, log = () => {} } = {}) {
  const jobs = new Map();
  const report = [];
  const queue = [...employers];
  async function worker() {
    for (let e; (e = queue.shift());) {
      const src = SOURCES[e.source];
      const started = Date.now();
      if (!src) { report.push({ name: e.name, source: e.source, ok: false, error: 'unknown source' }); continue; }
      try {
        const got = await src.fetchJobs({ name: e.name, ...e.target });
        const kept = got.filter(j => j.canada);
        for (const j of kept) if (!jobs.has(j.id)) jobs.set(j.id, j);
        report.push({ name: e.name, source: e.source, ok: true, found: got.length, canada: kept.length, ms: Date.now() - started });
        log(`ok   ${e.source.padEnd(15)} ${e.name}: ${kept.length} in Canada of ${got.length}`);
      } catch (err) {
        report.push({ name: e.name, source: e.source, ok: false, error: String(err.message || err).slice(0, 300), ms: Date.now() - started });
        log(`FAIL ${e.source.padEnd(15)} ${e.name}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { jobs: [...jobs.values()], report };
}

// Same job posted twice (two boards, or once per city) -> keep one, remember the other links.
export function dedupe(jobs) {
  const key = j => `${j.company.toLowerCase().replace(/[^a-z0-9]/g, '')}|${j.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const out = new Map();
  for (const j of jobs) {
    const k = key(j);
    const have = out.get(k);
    if (!have) { out.set(k, { ...j, alsoAt: [] }); continue; }
    if (j.url !== have.url) have.alsoAt.push(j.url);
    if (j.location && !have.location.includes(j.location)) have.location += ' / ' + j.location;
  }
  return [...out.values()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const employers = JSON.parse(readFileSync(arg('--employers', 'data/employers.json'), 'utf8')).employers
    .filter(e => !arg('--only') || e.source === arg('--only'))
    .slice(0, Number(arg('--limit', 1e9)));
  const out = arg('--out', 'out');
  mkdirSync(out, { recursive: true });
  const { jobs, report } = await scanEmployers(employers, { log: console.log });
  const pool = dedupe(jobs);
  const stamp = new Date().toISOString();
  writeFileSync(join(out, 'pool.json'), JSON.stringify({ generatedAt: stamp, count: pool.length, jobs: pool }));
  writeFileSync(join(out, 'report.json'), JSON.stringify({ generatedAt: stamp, employers: report }, null, 2));
  const failed = report.filter(r => !r.ok).length;
  console.log(`\n${pool.length} jobs in Canada from ${report.length - failed} employers (${failed} failed). Written to ${out}/`);
}
