// Rippling public job board (no key needed): https://ats.rippling.com/<slug>/jobs
//   -> GET https://ats.rippling.com/api/v2/board/<slug>/jobs?page=N&pageSize=1000
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob } from '../job.mjs';

const HOSTS = ['ats.rippling.com'];
const SIZE = 1000, MAX_PAGES = 10;

export default {
  id: 'rippling',
  label: 'Rippling',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.hostname !== 'ats.rippling.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const slug = parts[0] === 'api' ? parts[3] : parts[0];
    return slug && /^[A-Za-z0-9_-]+$/.test(slug) ? { slug } : null;
  },
  parse(data, t) {
    return (data?.items || []).filter(j => j && j.name && j.url).map(j => makeJob({
      source: 'rippling', company: t.name || t.slug, nativeId: j.id, title: j.name, url: j.url,
      location: (j.locations || []).map(l => l.name).filter(Boolean).join(' / '),
      remote: (j.locations || []).some(l => /remote/i.test(l.name || '') || l.workplaceType === 'REMOTE'),
      department: j.department?.name,
    })).filter(Boolean);
  },
  async fetchJobs(t) {
    const out = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await request(`https://ats.rippling.com/api/v2/board/${encodeURIComponent(t.slug)}/jobs?page=${p}&pageSize=${SIZE}`, { allow: HOSTS, parse: 'json' });
      out.push(...this.parse(r.json, t));
      if (p + 1 >= (r.json?.totalPages ?? 1)) break;
    }
    return out;
  },
};
