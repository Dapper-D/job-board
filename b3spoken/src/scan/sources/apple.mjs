// Apple jobs in Canada: jobs.apple.com search pages carry their results as JSON inside the page.
// A company's own site, so robots.txt is checked before every request.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob } from '../job.mjs';

const HOSTS = ['jobs.apple.com'];
const MAX_PAGES = 30;

export function parseApple(html) {
  const m = String(html).match(/window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("((?:\\.|[^"\\])*)"\)/);
  if (!m) return null;
  try { return JSON.parse(JSON.parse('"' + m[1] + '"'))?.loaderData?.search ?? null; } catch { return null; }
}

export default {
  id: 'apple',
  label: 'Apple Jobs',
  hosts: HOSTS,
  fromUrl() { return null; },
  toJobs(search) {
    return (search?.searchResults || []).filter(r => r?.postingTitle && r?.id).map(r => makeJob({
      source: 'apple', company: 'Apple', nativeId: r.id, title: r.postingTitle,
      url: `https://jobs.apple.com/en-ca/details/${encodeURIComponent(r.id)}/${encodeURIComponent(r.transformedPostingTitle || 'role')}${r.team?.teamCode ? '?team=' + encodeURIComponent(r.team.teamCode) : ''}`,
      location: [...new Set((r.locations || []).map(l => typeof l === 'string' ? l : [l?.name, l?.countryName].filter(Boolean).join(', ')).filter(Boolean))].join(' / ') || 'Canada',
      canada: true, postedAt: r.postDateInGMT, department: r.team?.teamName,
    })).filter(Boolean);
  },
  async fetchJobs() {
    const out = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = `https://jobs.apple.com/en-ca/search?location=canada-CANC&page=${p}`;
      if (!(await robotsAllows(url, HOSTS))) throw new Error('jobs.apple.com robots.txt does not allow this');
      const r = await request(url, { allow: HOSTS, parse: 'text', accept: 'text/html', gapMs: 1500 });
      const search = parseApple(r.text);
      if (!search) throw new Error('Apple changed its search page');
      const got = this.toJobs(search);
      out.push(...got);
      if (!got.length || out.length >= (Number(search.totalRecords) || 0)) break;
    }
    return out;
  },
};
