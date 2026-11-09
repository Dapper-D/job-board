// UKG Pro (UltiPro) Recruiting public job boards (no key needed):
//   https://recruiting.ultipro.com/<TENANT>/JobBoard/<board-id>/   (also recruiting2/3… and .ultipro.ca)
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
// The list comes from the board's own search call (POST …/JobBoardView/LoadSearchResults, JSON), 50 at a time.
// It only has a short description, so we then read each posting's public page (after checking robots.txt) for the
// full text, which sits in the page as `new US.Opportunity.CandidateOpportunityDetail({...})`.
// The board stays on whichever UKG host the employer uses; we never swap it for another one.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, htmlToText } from '../job.mjs';

// Known board hosts; a numbered host from a careers link (recruiting4…) is fetched as that exact host only.
const HOSTS = ['recruiting.ultipro.com', 'recruiting2.ultipro.com', 'recruiting3.ultipro.com', 'recruiting.ultipro.ca'];
const HOST = /^recruiting\d*\.ultipro\.(com|ca)$/;
const TENANT = /^[A-Za-z0-9_]{2,40}$/;
const BOARD = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PAGE = 50, MAX_PAGES = 40, MAX_DETAILS = 60;
const COUNTRY = { CAN: 'Canada', USA: 'USA' };

const base = t => `https://${t.host}/${t.tenant}/JobBoard/${t.board}`;
const detailUrl = (t, id) => `${base(t)}/OpportunityDetail?opportunityId=${encodeURIComponent(id)}`;

// Locations: [{ LocalizedName, Address: { City, State: { Code }, Country: { Code } } }] -> "Toronto, ON, Canada / …"
export function ultiproPlaces(list) {
  const out = [];
  for (const l of Array.isArray(list) ? list : []) {
    let s = '';
    if (typeof l === 'string') s = l.trim();
    else if (l && typeof l === 'object') {
      const a = l.Address || {}, c = String(a.Country?.Code || '').trim().toUpperCase();
      s = [a.City, a.State?.Code, COUNTRY[c] || c].map(x => String(x || '').trim()).filter(Boolean).join(', ');
      if (!a.City && !a.State?.Code) s = [String(l.LocalizedName || '').trim(), s].filter(Boolean).join(', ');
    }
    if (s && !out.includes(s)) out.push(s);
  }
  return out.join(' / ');
}

// The JSON object a posting page passes to CandidateOpportunityDetail(...), or null (an expired posting has none).
export function ultiproDetail(html, id) {
  const s = String(html || ''), at = s.indexOf('CandidateOpportunityDetail(');
  if (at < 0) return null;
  const start = s.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, str = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { const d = JSON.parse(s.slice(start, i + 1)); return d && String(d.Id) === String(id) ? d : null; } catch { return null; }
    }
  }
  return null;
}

const searchBody = skip => ({
  opportunitySearch: { Top: PAGE, Skip: skip, QueryString: '', OrderBy: [{ Value: 'postedDateDesc', PropertyName: 'PostedDate', Ascending: false }], Filters: [] },
  matchCriteria: { PreferredJobs: [], Educations: [], LicenseAndCertifications: [], Skills: [], hasNoLicenses: false, SkippedSkills: [] },
});

export default {
  id: 'ultipro',
  label: 'UKG Pro (UltiPro)',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const host = u.hostname.toLowerCase();
    const m = u.pathname.match(/^\/([^/]+)\/JobBoard\/([^/]+)(?:\/|$)/i);
    return u.protocol === 'https:' && HOST.test(host) && m && TENANT.test(m[1]) && BOARD.test(m[2])
      ? { host, tenant: m[1], board: m[2].toLowerCase() } : null;
  },
  // data: one or more LoadSearchResults responses' `opportunities`; details: { [Id]: detail object }.
  parse(data, target, details = {}) {
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.opportunities) ? data.opportunities : []);
    return rows.map(o => {
      const id = typeof o?.Id === 'number' ? String(o.Id) : String(o?.Id ?? '').trim();
      if (!id) return null;
      const d = details[id];
      const type = String(o.JobLocationType ?? '');
      return makeJob({
        source: 'ultipro', company: target.name || target.tenant, nativeId: id,
        title: o.Title, url: detailUrl(target, id),
        location: ultiproPlaces(o.Locations), remote: /remote/i.test(type),
        postedAt: o.PostedDate,
        description: htmlToText(d?.Description || o.BriefDescription),
        department: o.JobCategoryName,
        employment: o.FullTime === true ? 'Full-time' : o.FullTime === false ? 'Part-time' : '',
      });
    }).filter(Boolean);
  },
  async fetchJobs(target, { details = true } = {}) {
    const allow = [target.host];
    const all = [], seen = new Set();
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await request(`${base(target)}/JobBoardView/LoadSearchResults`, { allow, method: 'POST', json: searchBody(p * PAGE), parse: 'json', gapMs: 800 });
      const list = r.json?.opportunities;
      if (!Array.isArray(list)) throw new Error(`UKG changed its job board search (${target.host}/${target.tenant})`);
      let fresh = 0;
      for (const o of list) { const id = String(o?.Id ?? ''); if (id && !seen.has(id)) { seen.add(id); all.push(o); fresh++; } }
      if (list.length < PAGE || !fresh) break; // last page, or the board keeps sending the same rows
    }
    const det = {};
    if (details) for (const o of all.slice(0, MAX_DETAILS)) {
      const url = detailUrl(target, o.Id);
      try {
        if (!(await robotsAllows(url, allow))) break;
        const d = ultiproDetail((await request(url, { allow, parse: 'text', accept: 'text/html', gapMs: 800 })).text, o.Id);
        if (d) det[String(o.Id)] = d;
      } catch { /* the short description is still usable */ }
    }
    return this.parse(all, target, det);
  },
};
