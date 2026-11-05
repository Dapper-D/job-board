// SmartRecruiters public Posting API (no key needed): api.smartrecruiters.com/v1/companies/<company>/postings
// We ask only for Canadian postings (country=ca), then fetch each one's details for the description.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['api.smartrecruiters.com'];
const PAGE = 100, MAX_PAGES = 20, MAX_DETAILS = 300;

export default {
  id: 'smartrecruiters',
  label: 'SmartRecruiters',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const parts = u.pathname.split('/').filter(Boolean);
    if (/^(jobs|careers)\.smartrecruiters\.com$/.test(u.hostname) && parts[0]) return { company: parts[0] };
    if (u.hostname === 'api.smartrecruiters.com' && parts[0] === 'v1' && parts[1] === 'companies' && parts[2]) return { company: parts[2] };
    return null;
  },
  parse(data, target, details = {}) {
    return (data?.content || []).map(j => {
      const d = details[j.id];
      const loc = j.location || {};
      const where = loc.fullLocation || [loc.city, loc.region, loc.country === 'ca' ? 'Canada' : (loc.country || '').toUpperCase()].filter(Boolean).join(', ');
      const sections = d?.jobAd?.sections || {};
      return makeJob({
        source: 'smartrecruiters', company: j.company?.name || target.name || target.company, nativeId: j.id,
        title: j.name, url: `https://jobs.smartrecruiters.com/${encodeURIComponent(j.company?.identifier || target.company)}/${encodeURIComponent(j.id)}`,
        applyUrl: d?.applyUrl,
        location: where, remote: loc.remote === true,
        postedAt: j.releasedDate,
        description: ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation'].map(k => sections[k] && `${sections[k].title || ''}\n${htmlToText(sections[k].text)}`).filter(Boolean).join('\n\n'),
        department: j.department?.label, employment: j.typeOfEmployment?.label,
      });
    }).filter(Boolean);
  },
  async fetchJobs(target, { details = true } = {}) {
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(target.company)}/postings`;
    const all = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await request(`${base}?country=ca&limit=${PAGE}&offset=${p * PAGE}`, { allow: HOSTS, parse: 'json' });
      const list = r.json?.content || [];
      all.push(...list);
      if (list.length < PAGE || all.length >= (r.json?.totalFound ?? Infinity)) break;
    }
    const det = {};
    if (details) for (const j of all.slice(0, MAX_DETAILS)) {
      try { det[j.id] = (await request(`${base}/${encodeURIComponent(j.id)}`, { allow: HOSTS, parse: 'json', gapMs: 300 })).json; } catch { /* list data is still usable */ }
    }
    return this.parse({ content: all }, target, det);
  },
};
