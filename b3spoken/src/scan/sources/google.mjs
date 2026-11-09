// Google (and other Alphabet companies) careers in Canada. The results page is server-rendered HTML.
// google.com/robots.txt disallows the paginated results URLs, so we only ever read the FIRST page of each search,
// and we check robots.txt before every request. We run a set of broad searches to cover many fields.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, decodeEntities } from '../job.mjs';

const HOSTS = ['www.google.com'];
const BASE = 'https://www.google.com/about/careers/applications/jobs/results/';
const QUERIES = ['', 'engineer', 'software', 'data', 'product', 'sales', 'marketing', 'operations', 'design', 'research', 'program manager', 'customer', 'finance', 'people', 'legal', 'technical'];
const text = s => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseGoogle(html) {
  const cards = []; let prev = 0;
  for (const a of String(html).matchAll(/<a\b[^>]*?\bhref="(?:[^"]*\/)?jobs\/results\/(\d+)-([a-z0-9-]+)[^"]*"[^>]*>/g)) {
    const card = html.slice(prev, a.index); prev = a.index + a[0].length;
    const h3 = [...card.matchAll(/<h3\b[^>]*>([^<]+)<\/h3>/g)].pop();
    const line = [...card.matchAll(/<p class="l103df">([\s\S]*?)<\/p>/g)].pop();
    let employer = '', places = [];
    if (line && line[1].includes('|')) { const [e, ...l] = line[1].split('|'); employer = text(e); places = text(l.join('|')).split(';').map(x => x.trim()).filter(x => x && !/^\+\d+ more$/.test(x)); }
    const aria = a[0].match(/aria-label="Learn more about ([^"]+)"/);
    cards.push({ id: a[1], slug: a[2], title: (h3 && text(h3[1])) || (aria && text(aria[1])) || a[2].replace(/-/g, ' '), employer, places });
  }
  return cards;
}

export default {
  id: 'google',
  label: 'Google Careers',
  hosts: HOSTS,
  fromUrl() { return null; },
  async fetchJobs(t = {}) {
    const byId = new Map();
    for (const q of t.queries || QUERIES) {
      const url = `${BASE}?${new URLSearchParams({ ...(q ? { q } : {}), location: 'Canada', sort_by: 'date' })}`;
      if (!(await robotsAllows(url, HOSTS))) continue;
      const r = await request(url, { allow: HOSTS, parse: 'text', accept: 'text/html', gapMs: 2000 });
      for (const c of parseGoogle(r.text)) {
        if (byId.has(c.id)) continue;
        const j = makeJob({ source: 'google', company: c.employer || 'Google', nativeId: c.id, title: c.title, url: `${BASE}${c.id}-${c.slug}`, location: c.places.join(' / ') || 'Canada' });
        if (j) byId.set(c.id, j);
      }
    }
    return [...byId.values()];
  },
};
