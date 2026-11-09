// iCIMS career sites built on Jibe (on <company>.jibeapply.com or the employer's own careers host):
//   GET https://<careers host>/api/jobs?page=N  -> { jobs: [{ data: {...} }], totalCount }
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const MAX_PAGES = 60;

// Recognise a Jibe site from its page (Jibe's static host is jibecdn.com).
export function jibeFromPage(html, pageUrl) {
  if (!/jibecdn\.com/i.test(html)) return null;
  const u = new URL(pageUrl), base = u.hostname.split('.').slice(-2).join('.');
  // A www page that only links to the careers site: use the careers host it links to.
  const m = String(html).match(/https:\/\/((?:careers|jobs)\.[a-z0-9.-]+)\//i);
  const host = (m && m[1].toLowerCase().endsWith(base) ? m[1] : u.hostname).toLowerCase();
  return host.startsWith('www.') ? null : { host };
}

export default {
  id: 'jibe',
  label: 'iCIMS (Jibe)',
  hosts: ['*.jibeapply.com'],
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    return /^[a-z0-9-]+\.jibeapply\.com$/i.test(u.hostname) ? { host: u.hostname.toLowerCase() } : null;
  },
  parse(data, t) {
    return (data?.jobs || []).map(item => {
      const d = item?.data ?? item ?? {};
      const slug = d.slug || d.req_id;
      if (!slug) return null;
      return makeJob({
        source: 'jibe', company: d.hiring_organization || t.name || t.host, nativeId: d.req_id || slug,
        title: d.title, url: `https://${t.host}/jobs/${encodeURIComponent(slug)}`, applyUrl: d.apply_url,
        location: d.full_location || [d.city, d.state, d.country].filter(Boolean).join(', '),
        remote: /remote/i.test(d.location_type || ''), postedAt: d.posted_date || d.create_date,
        description: htmlToText([d.description, d.qualifications, d.responsibilities].filter(Boolean).join('\n')),
        department: (d.categories || []).map(c => c.name).join(', '), employment: d.employment_type,
      });
    }).filter(Boolean);
  },
  async fetchJobs(t) {
    const allow = [t.host];
    const first = await request(`https://${t.host}/api/jobs?page=1`, { allow, parse: 'json' });
    const out = this.parse(first.json, t);
    const size = (first.json?.jobs || []).length || 10;
    const pages = Math.min(Math.ceil((first.json?.totalCount || 0) / size), MAX_PAGES);
    for (let p = 2; p <= pages; p++) {
      const r = await request(`https://${t.host}/api/jobs?page=${p}`, { allow, parse: 'json', gapMs: 300 });
      const got = this.parse(r.json, t);
      if (!got.length) break;
      out.push(...got);
    }
    return out;
  },
};
