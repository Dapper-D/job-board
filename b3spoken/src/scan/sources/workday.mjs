// Workday public career sites (no key needed). Each employer has its own host and site name:
//   https://<tenant>.wd<N>.myworkdayjobs.com/<site>  ->  POST /wday/cxs/<tenant>/<site>/jobs
// When the site offers a "Canada" location filter we use it, so we only page through Canadian jobs.
import { request } from '../http.mjs';
import { makeJob } from '../job.mjs';

const HOSTS = ['*.myworkdayjobs.com'];
const PAGE = 20, MAX_PAGES = 100;
const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;

// "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" -> a date
export function workdayPosted(text, now = Date.now()) {
  const t = String(text || '').toLowerCase();
  if (t.includes('today')) return new Date(now).toISOString();
  if (t.includes('yesterday')) return new Date(now - 864e5).toISOString();
  const m = t.match(/(\d+)\+?\s*days?/);
  return m ? new Date(now - Number(m[1]) * 864e5).toISOString() : null;
}

// Find a facet value called "Canada" anywhere in Workday's nested facet list.
export function findCanadaFacet(facets, parent = null) {
  for (const f of facets || []) {
    const param = f.facetParameter || parent;
    for (const v of f.values || []) {
      if (/^canada$/i.test(String(v.descriptor || '').trim()) && v.id && param) return { param, id: v.id };
      if (v.values) { const hit = findCanadaFacet([v], v.facetParameter || param); if (hit) return hit; }
    }
  }
  return null;
}

export default {
  id: 'workday',
  label: 'Workday',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase().match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
    if (!h) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'wday' && parts[1] === 'cxs' && parts[3]) return { host: u.hostname.toLowerCase(), tenant: parts[2], site: parts[3] };
    const site = parts.find(p => !LANG.test(p));
    return site ? { host: u.hostname.toLowerCase(), tenant: h[1], site } : null;
  },
  parse(data, target, now = Date.now()) {
    return (data?.jobPostings || []).filter(j => j.externalPath).map(j => makeJob({
      source: 'workday', company: target.name || target.tenant, nativeId: (j.bulletFields || [])[0] || j.externalPath,
      title: j.title, url: `https://${target.host}/${target.site}${j.externalPath}`,
      location: j.locationsText, remote: /remote/i.test(j.remoteType || ''),
      postedAt: workdayPosted(j.postedOn, now),
    })).filter(Boolean);
  },
  async fetchJobs(target) {
    const api = `https://${target.host}/wday/cxs/${encodeURIComponent(target.tenant)}/${encodeURIComponent(target.site)}/jobs`;
    const page = (offset, appliedFacets) => request(api, { method: 'POST', allow: HOSTS, parse: 'json', gapMs: 1000, json: { appliedFacets, limit: PAGE, offset, searchText: '' } });
    let first = await page(0, {});
    let facets = {};
    const ca = findCanadaFacet(first.json?.facets);
    if (ca) { facets = { [ca.param]: [ca.id] }; first = await page(0, facets); }
    const total = Number(first.json?.total) || 0;
    const out = this.parse(first.json, target);
    for (let p = 1; p < MAX_PAGES && p * PAGE < total; p++) {
      const r = await page(p * PAGE, facets);
      const got = this.parse(r.json, target);
      if (!got.length) break;
      out.push(...got);
    }
    return out;
  },
};
