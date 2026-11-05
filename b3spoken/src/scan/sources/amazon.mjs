// Amazon (incl. AWS) jobs: the search JSON behind amazon.jobs, asked for jobs in Canada, newest first.
// This is a company's own site, not a hiring-system API, so robots.txt is checked before every run.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['www.amazon.jobs', 'amazon.jobs'];
const PAGE = 100, MAX_PAGES = 30;

export default {
  id: 'amazon',
  label: 'Amazon Jobs',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    return /(^|\.)amazon\.jobs$/i.test(u.hostname) ? { country: 'CAN' } : null;
  },
  parse(data) {
    return (data?.jobs || []).filter(j => j.job_path).map(j => {
      const locs = [j.normalized_location || j.location, ...(j.locations || []).map(l => { try { const o = typeof l === 'string' ? JSON.parse(l) : l; return o.normalizedLocation || o.location; } catch { return ''; } })].filter((v, i, a) => v && a.indexOf(v) === i);
      return makeJob({
        source: 'amazon', company: j.company_name || 'Amazon', nativeId: j.id_icims || j.id,
        title: j.title, url: 'https://www.amazon.jobs' + (j.job_path.startsWith('/') ? '' : '/') + j.job_path,
        location: locs.join(' / '), postedAt: j.posted_date,
        description: htmlToText([j.description, j.basic_qualifications && 'Basic qualifications\n' + j.basic_qualifications, j.preferred_qualifications && 'Preferred qualifications\n' + j.preferred_qualifications].filter(Boolean).join('\n\n')),
        department: j.job_category, employment: j.job_schedule_type,
      });
    }).filter(Boolean);
  },
  async fetchJobs(t = {}) {
    const first = `https://www.amazon.jobs/en/search.json?base_query=&loc_query=Canada&normalized_country_code%5B%5D=${t.country || 'CAN'}&sort=recent&result_limit=${PAGE}&offset=0`;
    if (!(await robotsAllows(first, HOSTS))) throw new Error('amazon.jobs robots.txt does not allow this');
    const out = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await request(first.replace('offset=0', 'offset=' + p * PAGE), { allow: HOSTS, parse: 'json', gapMs: 1000 });
      const got = this.parse(r.json);
      out.push(...got);
      if ((r.json?.jobs || []).length < PAGE) break;
    }
    return out;
  },
};
