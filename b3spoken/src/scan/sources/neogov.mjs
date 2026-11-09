// NEOGOV public-sector careers sites (no key needed): https://www.governmentjobs.com/careers/<agency>[/<folder>]
// and https://www.schooljobs.com/careers/<agency>[/<folder>] (cities, counties, school districts, colleges).
// The public page loads its list from a plain HTML endpoint, 10 postings a page:
//   GET https://www.governmentjobs.com/careers/home/index?agency=<agency>[&departmentFolder=<folder>]&page=N
// An optional <folder> is a custom careers page of that agency (e.g. "facultypositions") and narrows the list.
// A wrong agency name redirects to the site's home page, which is not a job list, so it fails loudly.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, decodeEntities } from '../job.mjs';

// The bare names redirect to www., so targets always use the www. host.
const SITES = new Map([
  ['governmentjobs.com', 'www.governmentjobs.com'], ['www.governmentjobs.com', 'www.governmentjobs.com'],
  ['schooljobs.com', 'www.schooljobs.com'], ['www.schooljobs.com', 'www.schooljobs.com'],
]);
const HOSTS = ['www.governmentjobs.com', 'www.schooljobs.com'];
const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_PAGES = 30; // 300 postings
const clean = s => decodeEntities(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function pageUrl(t, page) {
  const q = new URLSearchParams({ agency: t.agency });
  if (t.folder) q.set('departmentFolder', t.folder);
  q.set('sort', 'PostingDate'); q.set('isDescendingSort', 'true'); q.set('page', String(page));
  return `https://${t.host}/careers/home/index?${q}`;
}

// Read one list page. Each posting is <li class="list-item"> with <a class="item-details-link"
// href="/careers/<agency>/[<folder>/]jobs/<id>/<slug>"> and a <ul class="list-meta"> whose first <li> is the place
// and second the job type and pay ("Part-time Hourly - $93.18 Hourly").
// ok: false means the page is not a NEOGOV job list (no list items and none of its "no jobs" containers).
export function readPage(html, t) {
  if (typeof html !== 'string' || !html.trim()) return { ok: true, rows: [] };
  const items = html.split(/<li class="list-item"/i).slice(1);
  if (!items.length) return { ok: /jobs-not-found-container|search-results-listing-container/.test(html), rows: [] };
  const origin = `https://${t.host}`;
  const rows = [];
  for (const item of items) {
    const a = item.match(/<a [^>]*class="item-details-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || item.match(/<a [^>]*href="([^"]+)"[^>]*class="item-details-link"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    let u; try { u = new URL(decodeEntities(a[1]), origin); } catch { continue; }
    const m = u.pathname.match(/^\/careers\/[^/]+\/(?:[^/]+\/)?jobs\/(\d+)/);
    if (u.origin !== origin || !m) continue; // never a link off the site or to a non-job page
    u.hash = '';
    const title = clean(a[2]);
    if (!title) continue;
    const meta = [...((item.match(/<ul class="list-meta">([\s\S]*?)<\/ul>/i) || [])[1] || '').matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(x => clean(x[1]));
    // "Full Time - $85,000.00 - $112,000.00 Annually": the job type, then the whole pay range.
    const line = meta[1] || '', cut = line.search(/\s+-\s+/);
    const type = cut < 0 ? line : line.slice(0, cut), pay = cut < 0 ? '' : line.slice(cut).replace(/^\s+-\s+/, '');
    rows.push({ id: m[1], title, url: u.href, location: meta[0] || '', employment: type, salary: /\d/.test(pay) ? pay : '' });
  }
  return { ok: true, rows };
}

const toJob = (r, t) => makeJob({
  source: 'neogov', company: t.name || t.agency, nativeId: r.id, title: r.title, url: r.url,
  location: r.location, employment: r.employment, salary: r.salary,
});

export default {
  id: 'neogov',
  label: 'NEOGOV',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const host = SITES.get(u.hostname.toLowerCase());
    if (u.protocol !== 'https:' || !host) return null;
    const [root, agency, folder = ''] = u.pathname.split('/').filter(Boolean);
    if (root !== 'careers' || !agency || !SEGMENT.test(agency) || agency.toLowerCase() === 'home') return null;
    // A posting link (/careers/<agency>/jobs/<id>) is the whole agency, not a folder named "jobs".
    const f = folder.toLowerCase() === 'jobs' ? '' : folder;
    if (f && !SEGMENT.test(f)) return null;
    return { host, agency: agency.toLowerCase(), folder: f.toLowerCase() };
  },
  parse(html, t) {
    return readPage(html, t).rows.map(r => toJob(r, t)).filter(Boolean);
  },
  async fetchJobs(t) {
    const allow = [t.host];
    const out = [], seen = new Set();
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = pageUrl(t, p);
      if (!(await robotsAllows(url, allow))) throw new Error(`${t.host} robots.txt does not allow reading this job list`);
      // The list endpoint answers page requests made the way the site's own page makes them (an XMLHttpRequest).
      const r = await request(url, { allow, parse: 'text', accept: 'text/html', gapMs: 750, headers: { 'x-requested-with': 'XMLHttpRequest' } });
      const page = readPage(r.text, t);
      if (!page.ok) throw new Error(`NEOGOV did not return a job list for "${t.agency}" (wrong agency name, or the page changed)`);
      // A page that adds nothing new is the end, or the site repeating itself: stop either way.
      const fresh = page.rows.filter(x => !seen.has(x.url));
      if (!fresh.length) break;
      fresh.forEach(x => seen.add(x.url));
      out.push(...fresh.map(x => toJob(x, t)).filter(Boolean));
    }
    return out;
  },
};
