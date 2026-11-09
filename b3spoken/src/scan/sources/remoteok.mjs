// Remote OK public API: GET https://remoteok.com/api (newest ~100 jobs; the first array item is a legal notice).
// Terms (the API's own "legal" field): link back to the job's Remote OK URL as a normal followed link and
// name Remote OK as the source. The logo is trademarked; we only use the name.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['remoteok.com'];
const VIA = { name: 'Remote OK', url: 'https://remoteok.com' };
const OPEN_TO_CANADA = /\b(canada|north america|americas|worldwide|anywhere|global)\b/i;

export default {
  id: 'remoteok',
  label: 'Remote OK',
  hosts: HOSTS,
  feed: true,
  fromUrl() { return null; },
  parse(list) {
    const items = Array.isArray(list) ? list.filter(x => x && x.id && x.position) : [];
    return items.map(j => {
      const loc = String(j.location || '').trim();
      return makeJob({
        source: 'remoteok', company: j.company, nativeId: j.id,
        title: j.position, url: j.url || `https://remoteok.com/remote-jobs/${j.slug || j.id}`, location: loc || 'Remote (location not stated)',
        remote: true, canada: !loc || OPEN_TO_CANADA.test(loc),
        postedAt: j.date || j.epoch, description: htmlToText(j.description),
        department: (j.tags || []).slice(0, 4).join(', '),
        salary: j.salary_min || j.salary_max ? `USD ${j.salary_min || ''}${j.salary_max ? ' – ' + j.salary_max : ''} per year` : '',
        via: VIA,
      });
    }).filter(Boolean);
  },
  async fetchJobs() {
    const r = await request('https://remoteok.com/api', { allow: HOSTS, parse: 'json', retries: 1 });
    return this.parse(r.json);
  },
};
