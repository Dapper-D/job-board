// BambooHR public careers list (no key needed): https://<tenant>.bamboohr.com/careers/list
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob } from '../job.mjs';

const HOSTS = ['*.bamboohr.com'];
const HOST = /^[a-z0-9][a-z0-9-]*\.bamboohr\.com$/;

export default {
  id: 'bamboohr',
  label: 'BambooHR',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    return HOST.test(h) && !h.startsWith('www.') ? { host: h } : null;
  },
  parse(data, target) {
    return (Array.isArray(data?.result) ? data.result : []).filter(j => j && j.jobOpeningName && j.id != null).map(j => {
      const l = j.location || {};
      const ats = j.atsLocation || {};
      return makeJob({
        source: 'bamboohr', company: target.name || target.host.split('.')[0], nativeId: j.id,
        title: j.jobOpeningName, url: `https://${target.host}/careers/${encodeURIComponent(String(j.id))}`,
        location: [l.city || ats.city, l.state || ats.state || ats.province, ats.country].filter(Boolean).join(', ') + (j.isRemote ? (l.city ? ', Remote' : 'Remote') : ''),
        remote: !!j.isRemote, department: j.departmentLabel, employment: j.employmentStatusLabel,
      });
    }).filter(Boolean);
  },
  async fetchJobs(target) {
    const r = await request(`https://${target.host}/careers/list`, { allow: [target.host], parse: 'json' });
    return this.parse(r.json, target);
  },
};
