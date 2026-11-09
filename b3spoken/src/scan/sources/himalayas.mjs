// Himalayas public remote jobs API: GET https://himalayas.app/jobs/api/search?country=CA&page=N
// Terms (himalayas.app/terms clauses 30A and 113, and github.com/Himalayas-App/remote-jobs-api, checked 2026-11-05):
// personal and commercial use allowed without asking; credit Himalayas with a visible link; every Apply must use the
// API's applicationLink; show jobs only in our own apps, never pass them on to other job boards or aggregators;
// cache, drop expired jobs, stay within rate limits (data refreshes every 24 hours, so once a day is enough).
// Clause 93: don't sell or monetize their data without consent; revisit before any subscription.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['himalayas.app'];
const VIA = { name: 'Himalayas', url: 'https://himalayas.app' };
const MAX_PAGES = 30;

export default {
  id: 'himalayas',
  label: 'Himalayas',
  hosts: HOSTS,
  feed: true,
  fromUrl() { return null; },
  parse(data, now = Date.now()) {
    return (data?.jobs || []).filter(j => !j.expiryDate || j.expiryDate * 1000 > now).map(j => {
      const where = (j.locationRestrictions || []).join(', ');
      return makeJob({
        source: 'himalayas', company: j.companyName, nativeId: j.guid,
        title: j.title, url: j.applicationLink || j.guid, applyUrl: j.applicationLink,
        location: `Remote (${where || 'worldwide'})`, remote: true,
        canada: !where || /\bcanada\b/i.test(where),
        postedAt: j.pubDate, description: htmlToText(j.description || j.excerpt),
        department: (j.categories || []).slice(0, 3).join(', '), employment: j.employmentType,
        salary: j.minSalary || j.maxSalary ? `${j.currency || ''} ${j.minSalary || ''}${j.maxSalary ? ' – ' + j.maxSalary : ''} ${j.salaryPeriod || ''}`.trim() : '',
        via: VIA,
      });
    }).filter(Boolean);
  },
  async fetchJobs() {
    const out = new Map();
    for (let p = 1; p <= MAX_PAGES; p++) {
      const r = await request(`https://himalayas.app/jobs/api/search?country=CA&sort=recent&page=${p}`, { allow: HOSTS, parse: 'json', gapMs: 3000 });
      const got = this.parse(r.json);
      for (const j of got) out.set(j.id, j);
      if (!(r.json?.jobs || []).length) break;
    }
    return [...out.values()];
  },
};
