// Workable public job widget API (no key needed): apply.workable.com/api/v1/widget/accounts/<account>?details=true
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['apply.workable.com'];

export default {
  id: 'workable',
  label: 'Workable',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname === 'apply.workable.com') {
      if (parts[0] === 'api') { const i = parts.indexOf('accounts'); return i > -1 && parts[i + 1] ? { account: parts[i + 1] } : null; }
      return parts[0] && parts[0] !== 'j' ? { account: parts[0] } : null;
    }
    const sub = u.hostname.match(/^([a-z0-9-]+)\.workable\.com$/);
    return sub && !['www', 'apply', 'jobs', 'help'].includes(sub[1]) ? { account: sub[1] } : null;
  },
  parse(data, target) {
    return (data?.jobs || []).map(j => {
      const locs = (j.locations && j.locations.length ? j.locations : [{ city: j.city, region: j.state, country: j.country }])
        .map(l => [l.city, l.region, l.country].filter(Boolean).join(', ')).filter(Boolean);
      return makeJob({
        source: 'workable', company: data.name || target.name || target.account, nativeId: j.shortcode,
        title: j.title, url: j.url || j.shortlink || `https://apply.workable.com/${target.account}/j/${j.shortcode}/`,
        applyUrl: j.application_url,
        location: locs.join(' / '), remote: j.telecommuting === true,
        postedAt: j.published_on || j.created_at,
        description: htmlToText(j.description),
        department: j.department, employment: j.employment_type,
      });
    }).filter(Boolean);
  },
  async fetchJobs(target) {
    const r = await request(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(target.account)}?details=true`, { allow: HOSTS, parse: 'json' });
    return this.parse(r.json, target);
  },
};
