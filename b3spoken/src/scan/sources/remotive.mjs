// Remotive public remote jobs API: GET https://remotive.com/api/remote-jobs
// Terms (github.com/remotive-com/remote-jobs-api, checked 2026-11-05): link back to the Remotive URL AND name Remotive
// as the source; at most 4 requests a day (more than 2 a minute is blocked); jobs are delayed 24 hours;
// don't submit Remotive jobs to other job sites; don't use them to collect sign-ups. Paid API for commercial use.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['remotive.com'];
const VIA = { name: 'Remotive', url: 'https://remotive.com' };
// candidate_required_location values that include people in Canada
const OPEN_TO_CANADA = /\b(canada|north america|americas|worldwide|anywhere|global)\b/i;

export default {
  id: 'remotive',
  label: 'Remotive',
  hosts: HOSTS,
  feed: true,
  fromUrl() { return null; },
  parse(data) {
    return (data?.jobs || []).map(j => makeJob({
      source: 'remotive', company: j.company_name, nativeId: j.id,
      title: j.title, url: j.url, location: j.candidate_required_location || 'Remote', remote: true,
      canada: OPEN_TO_CANADA.test(j.candidate_required_location || ''),
      postedAt: j.publication_date, description: htmlToText(j.description),
      department: j.category, employment: j.job_type, salary: j.salary, via: VIA,
    })).filter(Boolean);
  },
  async fetchJobs() {
    const r = await request('https://remotive.com/api/remote-jobs', { allow: HOSTS, parse: 'json', retries: 1, gapMs: 31000 });
    return this.parse(r.json);
  },
};
