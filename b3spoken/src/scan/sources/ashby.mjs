// Ashby public Job Posting API (no key needed): api.ashbyhq.com/posting-api/job-board/<board>?includeCompensation=true
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['api.ashbyhq.com'];

export default {
  id: 'ashby',
  label: 'Ashby',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.hostname === 'jobs.ashbyhq.com') { const b = u.pathname.split('/').filter(Boolean)[0]; return b ? { board: decodeURIComponent(b) } : null; }
    if (u.hostname === 'api.ashbyhq.com') { const m = u.pathname.match(/job-board\/([^/]+)/); return m ? { board: decodeURIComponent(m[1]) } : null; }
    return null;
  },
  parse(data, target) {
    return (data?.jobs || []).filter(j => j.isListed !== false).map(j => {
      const addr = j.address?.postalAddress || {};
      const where = [j.location, ...(j.secondaryLocations || []).map(s => s.location)].filter(Boolean);
      if (addr.addressCountry && !where.some(w => w.includes(addr.addressCountry))) where.push(addr.addressCountry);
      return makeJob({
        source: 'ashby', company: target.name || target.board, nativeId: j.id,
        title: j.title, url: j.jobUrl, applyUrl: j.applyUrl,
        location: where.join(' / '), remote: j.isRemote === true || j.workplaceType === 'Remote',
        postedAt: j.publishedAt,
        description: j.descriptionPlain || htmlToText(j.descriptionHtml),
        department: j.department || j.team, employment: j.employmentType,
        salary: j.compensation?.compensationTierSummary || j.compensation?.scrapeableCompensationSalarySummary,
      });
    }).filter(Boolean);
  },
  async fetchJobs(target) {
    const r = await request(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(target.board)}?includeCompensation=true`, { allow: HOSTS, parse: 'json' });
    return this.parse(r.json, target);
  },
};
