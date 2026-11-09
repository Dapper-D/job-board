// Breezy HR public job list (no key needed): https://<tenant>.breezy.hr/json
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob } from '../job.mjs';

const HOSTS = ['*.breezy.hr'];
const HOST = /^[a-z0-9][a-z0-9-]*\.breezy\.hr$/;

export default {
  id: 'breezy',
  label: 'Breezy HR',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    return HOST.test(h) && h !== 'app.breezy.hr' && h !== 'www.breezy.hr' ? { host: h } : null;
  },
  parse(list, target) {
    return (Array.isArray(list) ? list : []).filter(j => j && j.name).map(j => {
      const l = j.location || {};
      const country = l.country?.name || '';
      let where = (l.name || [l.city, l.state?.name || l.state, country].filter(Boolean).join(', ')).trim();
      if (country && !where.includes(country)) where = where ? `${where}, ${country}` : country;
      return makeJob({
        source: 'breezy', company: j.company?.name || target.name || target.host.split('.')[0], nativeId: j.id || j.friendly_id,
        title: j.name, url: j.url, location: where + (l.is_remote && !/remote/i.test(where) ? (where ? ', Remote' : 'Remote') : ''),
        remote: !!l.is_remote, postedAt: j.published_date, department: j.department, employment: j.type?.name,
        salary: typeof j.salary === 'string' ? j.salary : '',
      });
    }).filter(Boolean);
  },
  async fetchJobs(target) {
    const r = await request(`https://${target.host}/json`, { allow: [target.host], parse: 'json' });
    return this.parse(r.json, target);
  },
};
