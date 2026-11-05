// Oracle Recruiting Cloud public job search (no key needed), used by many large employers:
//   https://<tenant>.fa.<region>.oraclecloud.com/hcmUI/CandidateExperience/<lang>/sites/<site>/jobs
//   -> GET /hcmRestApi/resources/latest/recruitingCEJobRequisitions (newest first, 200 a page)
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOST = /^[a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)?(?:ocs\.)?oraclecloud(?:[1-9][0-9]?)?\.com$/i;
const PAGE = 200, MAX_PAGES = 25;
const FACETS = 'LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS';

export function oracleApiUrl(t, offset) {
  const finder = ['siteNumber=' + t.site, 'facetsList=' + FACETS, 'limit=' + PAGE, 'sortBy=POSTING_DATES_DESC', 'offset=' + offset].join(',');
  return `https://${t.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=${encodeURIComponent('requisitionList.workLocation,requisitionList.secondaryLocations')}&finder=findReqs;${finder}&limit=${PAGE}&offset=${offset}`;
}

export default {
  id: 'oraclecloud',
  label: 'Oracle Recruiting Cloud',
  hosts: ['*.oraclecloud.com'],
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (!HOST.test(u.hostname)) return null;
    const segs = u.pathname.split('/').filter(Boolean);
    const ce = segs.indexOf('CandidateExperience'), si = segs.indexOf('sites');
    if (ce === -1 && si === -1) return null;
    const lang = ce > -1 && /^[a-z]{2}(-[A-Z]{2})?$/.test(segs[ce + 1] || '') ? segs[ce + 1] : 'en';
    return { host: u.hostname.toLowerCase(), lang, site: (si > -1 && segs[si + 1]) || 'CX_1' };
  },
  parse(data, t) {
    const list = data?.items?.[0]?.requisitionList || [];
    return list.map(r => {
      const wl = (r.workLocation || [])[0] || {};
      const base = r.PrimaryLocation || [wl.TownOrCity, wl.Region, wl.Country].filter(Boolean).join(', ');
      const where = [base, ...(r.secondaryLocations || []).map(s => s.Name).filter(Boolean)].filter(Boolean).join(' / ');
      return makeJob({
        source: 'oraclecloud', company: t.name || t.host.split('.')[0], nativeId: r.Id,
        title: r.Title, url: r.ExternalURL || `https://${t.host}/hcmUI/CandidateExperience/${t.lang}/sites/${t.site}/job/${r.Id}`,
        location: where + (r.WorkplaceTypeCode === 'ORA_REMOTE' ? ' (Remote)' : r.WorkplaceTypeCode === 'ORA_HYBRID' ? ' (Hybrid)' : ''),
        remote: r.WorkplaceTypeCode === 'ORA_REMOTE', postedAt: r.PostedDate,
        description: htmlToText(r.ShortDescriptionStr || ''), department: r.Organization || r.JobFamily,
      });
    }).filter(Boolean);
  },
  async fetchJobs(t) {
    const out = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await request(oracleApiUrl(t, p * PAGE), { allow: [t.host], parse: 'json', gapMs: 500 });
      const got = this.parse(r.json, t);
      out.push(...got);
      if (!r.json?.items?.[0]?.requisitionList?.length || got.length < PAGE) break;
    }
    return out;
  },
};
