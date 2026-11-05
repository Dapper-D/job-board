// The daily scan: read the employer list, ask each employer's hiring system for its jobs,
// keep the ones in Canada (or remote and open to Canada), drop duplicates, write the job pool.
//   node src/scan/scan.mjs --employers catalog/employers.json --out out [--only greenhouse] [--limit 5]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCES } from './sources/index.mjs';
import { companyKey, titleKey, urlKey, NOT_CANADA } from './job.mjs';

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
        // canadaOnly: the employer only hires in Canada (a city, a Crown corporation, a provincial utility),
        // so a job with just a building or a city name is still in Canada unless it names another country.
        const kept = got.map(j => !j.canada && e.canadaOnly && !NOT_CANADA.test(j.location || '') ? { ...j, canada: true } : j).filter(j => j.canada);
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

// The same job listed more than once (two boards, a job site and the employer, once per city, two links to one
// posting) -> one job. Two listings are the same job when they share a link, or the same company and job title.
// We keep the best copy (on the employer's own system, with a description, newest), add the other cities to its
// location and keep the other links in alsoAt, so nothing is shown or counted twice.
const rank = j => (j.employerVerified ? 4 : 0) + (j.description ? 2 : 0) + (j.via ? 0 : 1);
export function dedupe(jobs) {
  const groups = [];
  const byKey = new Map();
  for (const j of jobs) {
    const keys = [`u:${urlKey(j.url)}`, `t:${companyKey(j.company)}|${titleKey(j.title)}`];
    const hits = [...new Set(keys.map(k => byKey.get(k)).filter(Boolean))];
    let g = hits[0];
    if (!g) { g = { items: [] }; groups.push(g); }
    for (const other of hits.slice(1)) { g.items.push(...other.items); other.items = []; other.merged = g; }
    g.items.push(j);
    for (const k of keys) byKey.set(k, g);
    if (hits.length > 1) for (const [k, v] of byKey) if (v.merged) byKey.set(k, v.merged);
  }
  return groups.filter(g => g.items.length).map(({ items }) => {
    const best = [...items].sort((a, b) => rank(b) - rank(a) || String(b.postedAt || '').localeCompare(String(a.postedAt || '')))[0];
    const places = [...new Set(items.flatMap(i => String(i.location || '').split(' / ')).map(s => s.trim()).filter(Boolean))];
    const links = [...new Set(items.map(i => i.url).filter(u => urlKey(u) !== urlKey(best.url)).map(urlKey))];
    const alsoAt = links.map(k => items.find(i => urlKey(i.url) === k).url);
    const via = items.find(i => i.via)?.via;
    return { ...best, location: places.join(' / '), alsoAt, duplicates: items.length - 1, ...(via && !best.via ? { alsoOn: via } : {}), canada: items.some(i => i.canada) };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const employers = JSON.parse(readFileSync(arg('--employers', 'catalog/employers.json'), 'utf8')).employers
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
  console.log(`\n${pool.length} unique jobs in Canada (${jobs.length - pool.length} duplicates merged) from ${report.length - failed} employers (${failed} failed). Written to ${out}/`);
}
