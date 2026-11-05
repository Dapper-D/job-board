// Finds which hiring system an employer uses, so the daily scan can read its jobs.
//   1. Its careers page: we read the page (if robots.txt allows) and look for links to a known hiring system.
//      A redirect to one counts too. This is the strong signal.
//   2. Name guesses: we try the employer's name as a board name on systems that confirm the company
//      (Greenhouse and Workable return the company name; it must match).
// Lever, Ashby and SmartRecruiters name guesses are only kept when the board has jobs in Canada.
//   node src/scan/discover.mjs --in catalog/seeds.json --out out/discovered.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request } from './http.mjs';
import { robotsAllows } from './robots.mjs';
import { detect, SOURCES } from './sources/index.mjs';
import { phenomFromPage } from './sources/phenom.mjs';
import { eightfoldFromPage } from './sources/eightfold.mjs';
import { jibeFromPage } from './sources/jibe.mjs';
import { sfFromPage } from './sources/successfactors.mjs';

const PATHS = ['/careers', '/en/careers', '/careers/', '/jobs', '/en/jobs', '/about/careers', '/company/careers', '/join-us', '/work-with-us', '/'];
const SUBDOMAINS = ['careers', 'jobs'];

export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(inc|ltd|ltee|limited|corp|corporation|co|company|canada|technologies|technology|group|holdings|the)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

// Names match when they're equal with or without words like "Inc" and "Canada", as long as what's left is
// distinctive (5+ letters): "Air Canada" must not match a company called "Air".
const loose = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
export const sameCompany = (a, b) => loose(a) === loose(b) || (norm(a) === norm(b) && norm(a).length >= 5);

export function slugGuesses(name) {
  const base = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and');
  const words = base.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const core = words.filter(w => !['inc', 'ltd', 'corp', 'corporation', 'limited', 'the', 'co'].includes(w));
  return [...new Set([core.join(''), core.join('-'), norm(name)].filter(s => s.length >= 3))];
}

// Links to hiring systems inside a page: href/src attributes and bare URLs in scripts.
export function findBoardLinks(html, base) {
  const found = new Map();
  const urls = [...String(html).matchAll(/(?:href|src|data-url|action)\s*=\s*["']([^"'#]+)["']|https?:\/\/[^\s"'<>()\\]+/gi)].map(m => m[1] || m[0]);
  for (const raw of urls) {
    let abs; try { abs = new URL(raw.replace(/&amp;/g, '&'), base).href; } catch { continue; }
    const hit = detect(abs);
    if (hit && !SOURCES[hit.source].feed && hit.source !== 'jobbank') found.set(JSON.stringify(hit), hit);
  }
  return [...found.values()];
}

async function fromCareersPages(seed, log, seen = new Set()) {
  if (!seed.domain && !seed.careers) return null;
  const domain = seed.domain ? seed.domain.replace(/^www\./, '') : new URL(seed.careers).hostname.replace(/^www\./, '');
  const allow = [domain, `*.${domain}`];
  const urls = [...(seed.careers ? [seed.careers] : []), ...PATHS.map(p => `https://www.${domain}${p}`), ...SUBDOMAINS.map(s => `https://${s}.${domain}/`)];
  for (const url of urls) {
    const direct = detect(url);
    if (direct && !SOURCES[direct.source].feed) return { ...direct, how: 'careers link' };
    try {
      if (!(await robotsAllows(url, allow))) { log(`  robots.txt says no: ${url}`); continue; }
      const r = await request(url, { allow, parse: 'text', retries: 0, accept: 'text/html', gapMs: 1500 });
      const hits = findBoardLinks(r.text, url);
      if (hits.length) return { ...hits[0], how: `link on ${url}`, others: hits.slice(1) };
      const ph = phenomFromPage(r.text, url);
      if (ph) return { source: 'phenom', target: ph, how: `Phenom site at ${url}` };
      const ef = eightfoldFromPage(r.text, url);
      if (ef) return { source: 'eightfold', target: ef, how: `Eightfold site at ${url}` };
      const jb = jibeFromPage(r.text, url);
      if (jb) return { source: 'jibe', target: jb, how: `iCIMS (Jibe) site at ${url}` };
      const sf = sfFromPage(r.text, url);
      if (sf) return { source: 'successfactors', target: sf, how: `SuccessFactors site at ${url}` };
      for (const h of jobHosts(r.text, url, domain)) seen.add(h);
    } catch (e) {
      if (e.code === 'EHOST' && e.url) { const hit = detect(e.url); if (hit && !SOURCES[hit.source].feed) return { ...hit, how: `redirect from ${url}` }; seen.add('redirect:' + new URL(e.url).hostname + new URL(e.url).pathname.slice(0, 40)); }
    }
  }
  return null;
}

async function fromNameGuesses(seed) {
  for (const slug of slugGuesses(seed.name)) {
    try {
      const r = await request(`https://boards-api.greenhouse.io/v1/boards/${slug}`, { allow: SOURCES.greenhouse.hosts, parse: 'json', retries: 0 });
      if (r.json?.name && sameCompany(r.json.name, seed.name)) return { source: 'greenhouse', target: { board: slug }, how: 'name match' };
    } catch {}
    try {
      // Workable answers for almost any name, so its name must match AND it must list jobs in Canada.
      const r = await request(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=false`, { allow: SOURCES.workable.hosts, parse: 'json', retries: 0 });
      if (r.json?.name && sameCompany(r.json.name, seed.name) && SOURCES.workable.parse(r.json, { account: slug }).some(j => j.canada)) return { source: 'workable', target: { account: slug }, how: 'name match with Canadian jobs' };
    } catch {}
  }
  // No company name to compare: keep only if the board actually has Canadian jobs.
  const exact = slugGuesses(seed.name)[0];
  for (const [source, target] of [['ashby', { board: exact }], ['lever', { site: exact }], ['smartrecruiters', { company: exact }]]) {
    try {
      const jobs = await SOURCES[source].fetchJobs({ name: seed.name, ...target }, { details: false });
      if (jobs.some(j => j.canada)) return { source, target, how: 'name guess with Canadian jobs' };
    } catch {}
  }
  return null;
}

// For employers we couldn't place: hosts their careers pages link to for jobs, so we know which systems to add next.
export function jobHosts(html, base, domain) {
  const out = new Set();
  for (const m of String(html).matchAll(/(?:href|src)\s*=\s*["']([^"'#]+)["']/gi)) {
    let u; try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const jobby = /job|career|opening|position|requisition|vacanc|search|apply|emploi|recrut/i.test(u.hostname + u.pathname);
    const offsite = !u.hostname.endsWith(domain) || /^(careers?|jobs?|emplois?)\./.test(u.hostname);
    if (jobby && offsite && !/linkedin|facebook|twitter|x\.com|instagram|youtube|glassdoor|indeed|google\.com\/maps/i.test(u.hostname)) out.add(u.hostname + u.pathname.split('/').slice(0, 3).join('/'));
  }
  return out;
}

export async function discover(seeds, { concurrency = 6, log = () => {} } = {}) {
  const queue = [...seeds], found = [], missing = [];
  async function worker() {
    for (let s; (s = queue.shift());) {
      const seen = new Set();
      const hit = (await fromCareersPages(s, log, seen)) || (await fromNameGuesses(s));
      if (!hit) s.seenHosts = [...seen].slice(0, 12);
      if (hit) { found.push({ name: s.name, source: hit.source, target: hit.target, how: hit.how, ...(s.sector ? { sector: s.sector } : {}) }); log(`found ${s.name}: ${hit.source} ${JSON.stringify(hit.target)} (${hit.how})`); }
      else { missing.push(s); log(`none  ${s.name}: ${(s.seenHosts || []).join(' ')}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  found.sort((a, b) => a.name.localeCompare(b.name));
  return { found, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const have = arg('--skip') ? new Set(JSON.parse(readFileSync(arg('--skip'), 'utf8')).employers.map(e => e.name)) : new Set();
  const seeds = JSON.parse(readFileSync(arg('--in', 'catalog/seeds.json'), 'utf8')).seeds.filter(s => !have.has(s.name)).slice(0, Number(arg('--limit', 1e9)));
  const { found, missing } = await discover(seeds, { log: console.log });
  const out = arg('--out', 'out/discovered.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), found, missing: missing.map(m => ({ name: m.name, domain: m.domain, seen: m.seenHosts || [] })) }, null, 2));
  console.log('MISSING ' + JSON.stringify(missing.map(m => ({ name: m.name, domain: m.domain, seen: m.seenHosts || [] }))));
  console.log('\nRESULT ' + JSON.stringify(found));
  console.log(`\nFound a hiring system for ${found.length} of ${seeds.length} employers. Written to ${out}`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## Discovery\n\n${found.length} of ${seeds.length} employers found.\n\n| Source | Employers |\n| --- | --- |\n${Object.entries(found.reduce((m, f) => (m[f.source] = (m[f.source] || 0) + 1, m), {})).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n`, { flag: 'a' });
}
