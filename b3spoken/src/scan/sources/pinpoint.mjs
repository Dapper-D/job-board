// Pinpoint public postings (no key needed): https://<company>.pinpointhq.com/postings.json
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['*.pinpointhq.com'];
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pinpointhq\.com$/;
// Pinpoint's own demo posting, which some boards still show
const DEMO = 'youtube.com/embed/https://www.youtube.com/embed/pFxm6fszrpw';

export default {
  id: 'pinpoint',
  label: 'Pinpoint',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    return HOST.test(h) && h !== 'www.pinpointhq.com' ? { host: h } : null;
  },
  parse(data, target) {
    return (Array.isArray(data?.data) ? data.data : []).filter(j => j && !String(j.description || '').includes(DEMO)).map(j => {
      const l = j.location && typeof j.location === 'object' ? j.location : {};
      return makeJob({
        source: 'pinpoint', company: target.name || target.host.split('.')[0], nativeId: j.id,
        title: j.title, url: j.url, location: l.name || [l.city, l.province].filter(Boolean).join(', '),
        remote: /remote/i.test(j.workplace_type || ''), postedAt: j.published_at || j.created_at,
        description: htmlToText(j.description), department: j.department?.name, employment: j.employment_type_text || j.employment_type,
        salary: j.compensation_visible && (j.compensation_minimum || j.compensation_maximum) ? `${j.compensation_currency || ''} ${j.compensation_minimum || ''}${j.compensation_maximum ? ' – ' + j.compensation_maximum : ''} ${j.compensation_frequency || ''}`.trim() : '',
      });
    }).filter(Boolean);
  },
  async fetchJobs(target) {
    const r = await request(`https://${target.host}/postings.json`, { allow: [target.host], parse: 'json' });
    return this.parse(r.json, target);
  },
};
