// Jobicy public remote jobs API: GET https://jobicy.com/api/v2/remote-jobs?count=200&geo=canada
// Terms (github.com/Jobicy/remote-jobs-api, checked 2026-11-05): use in apps and job boards is allowed without asking;
// keep Jobicy as the named source and keep the Jobicy job URL; never present listings as our own;
// poll no more than once an hour. We ask for jobs open to Canada, and for "anywhere".
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['jobicy.com'];
const VIA = { name: 'Jobicy', url: 'https://jobicy.com' };

export default {
  id: 'jobicy',
  label: 'Jobicy',
  hosts: HOSTS,
  feed: true,
  fromUrl() { return null; },
  parse(data) {
    return (data?.jobs || []).map(j => makeJob({
      source: 'jobicy', company: j.companyName, nativeId: j.id,
      title: htmlToText(j.jobTitle), url: j.url, location: `Remote (${j.jobGeo || 'location not stated'})`, remote: true,
      canada: /\b(canada|anywhere|north america|americas)\b/i.test(j.jobGeo || ''),
      postedAt: j.pubDate, description: htmlToText(j.jobDescription),
      department: Array.isArray(j.jobIndustry) ? j.jobIndustry.join(', ') : j.jobIndustry,
      employment: Array.isArray(j.jobType) ? j.jobType.join(', ') : j.jobType,
      salary: j.salaryMin || j.salaryMax ? `${j.salaryCurrency || ''} ${j.salaryMin || ''}${j.salaryMax ? ' – ' + j.salaryMax : ''} ${j.salaryPeriod || ''}`.trim() : '',
      via: VIA,
    })).filter(Boolean);
  },
  async fetchJobs() {
    const out = new Map();
    for (const geo of ['canada', 'anywhere']) {
      const r = await request(`https://jobicy.com/api/v2/remote-jobs?count=200&geo=${geo}`, { allow: HOSTS, parse: 'json', gapMs: 2000 });
      for (const j of this.parse(r.json)) out.set(j.id, j);
    }
    return [...out.values()];
  },
};
