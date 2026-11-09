// Cornerstone OnDemand (CSOD) career sites (no key needed): https://<tenant>.csod.com/ux/ats/careersite/<siteId>/home?c=<corp>
// The public home page is a small page that carries an anonymous token ("token":"eyJ..."), the same one the page's
// own script uses. With it we ask the same search the page asks:
//   POST https://<tenant>.csod.com/services/x/career-site/v1/search  {careerSiteId, pageNumber, pageSize, ...}
//   -> {data: {totalCount, requisitions: [{requisitionId, displayJobTitle, postingEffectiveDate: "M/D/YYYY", locations}]}}
// Some tenants also want the home page's session cookies sent back with the search. We don't replay cookies,
// so those tenants fail with a clear message instead.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, decodeEntities } from '../job.mjs';

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+csod\.com$/;
const PAGE_SIZE = 25;
const MAX_PAGES = 40; // 1000 postings
const clean = s => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export const homeUrl = t => `https://${t.host}/ux/ats/careersite/${t.siteId}/home?c=${encodeURIComponent(t.corp)}`;
export const jobUrl = (t, id) => `https://${t.host}/ux/ats/careersite/${t.siteId}/home/requisition/${encodeURIComponent(id)}?c=${encodeURIComponent(t.corp)}`;

// The anonymous token from the home page, or ''.
export function extractToken(html) {
  return (typeof html === 'string' && html.match(/"token"\s*:\s*"([A-Za-z0-9._-]+)"/) || [])[1] || '';
}

// "7/3/2026" (US order) -> ISO date, or null for anything else (including 2/30).
export function csodDate(raw) {
  const m = typeof raw === 'string' ? raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) : null;
  if (!m) return null;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return mo >= 1 && mo <= 12 && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date.toISOString() : null;
}

// [{city, state, country}] -> "Bremen, DE / Vancouver, BC, CA" (no repeats).
export function csodLocation(list) {
  const out = [];
  for (const l of Array.isArray(list) ? list : []) {
    if (!l || typeof l !== 'object') continue;
    const s = [l.city, l.state, l.country].map(clean).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    if (s && !out.includes(s)) out.push(s);
  }
  return out.join(' / ');
}

const searchBody = (t, page) => ({
  careerSiteId: t.siteId, careerSitePageId: t.siteId, pageNumber: page, pageSize: PAGE_SIZE, cultureId: 1, cultureName: 'en-US',
  searchText: '', states: [], countryCodes: [], cities: [], placeID: '', radius: null, postingsWithinDays: null,
  customFieldCheckboxKeys: [], customFieldDropdowns: [], customFieldRadios: [],
});

export default {
  id: 'csod',
  label: 'Cornerstone OnDemand',
  hosts: ['*.csod.com'],
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !HOST.test(host)) return null;
    const m = u.pathname.match(/^\/ux\/ats\/careersite\/(\d+)(?:\/|$)/i);
    if (!m) return null;
    const corp = u.searchParams.get('c') || host.split('.')[0];
    return /^[A-Za-z0-9._-]{1,80}$/.test(corp) ? { host, siteId: Number(m[1]), corp } : null;
  },
  parse(data, t) {
    const list = Array.isArray(data?.data?.requisitions) ? data.data.requisitions : [];
    return list.map(r => {
      if (!r || typeof r !== 'object' || r.requisitionId == null || r.requisitionId === '') return null;
      const id = String(r.requisitionId);
      return makeJob({
        source: 'csod', company: t.name || t.corp, nativeId: id, title: clean(r.displayJobTitle), url: jobUrl(t, id),
        location: csodLocation(r.locations), postedAt: csodDate(r.postingEffectiveDate),
      });
    }).filter(Boolean);
  },
  async fetchJobs(t) {
    const allow = [t.host];
    const home = homeUrl(t);
    if (!(await robotsAllows(home, allow))) throw new Error(`${t.host} robots.txt does not allow reading this careers site`);
    const shell = await request(home, { allow, parse: 'text', accept: 'text/html', gapMs: 750 });
    const token = extractToken(shell.text);
    if (!token) throw new Error(`no public job search found on ${home}`);
    const out = [], seen = new Set();
    for (let p = 1; p <= MAX_PAGES; p++) {
      let r;
      try {
        r = await request(`https://${t.host}/services/x/career-site/v1/search`, {
          allow, parse: 'json', method: 'POST', gapMs: 500, json: searchBody(t, p), headers: { authorization: `Bearer ${token}` },
        });
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw new Error(`${t.host} wants a browser session for its job search, which B3spoken does not imitate`);
        throw e;
      }
      const raw = Array.isArray(r.json?.data?.requisitions) ? r.json.data.requisitions.length : 0;
      const fresh = this.parse(r.json, t).filter(j => !seen.has(j.id));
      if (!fresh.length) break; // empty, or the site ignored the page number
      fresh.forEach(j => seen.add(j.id));
      out.push(...fresh);
      const total = Number(r.json?.data?.totalCount);
      if (raw < PAGE_SIZE || (Number.isFinite(total) && p * PAGE_SIZE >= total)) break;
    }
    return out;
  },
};
