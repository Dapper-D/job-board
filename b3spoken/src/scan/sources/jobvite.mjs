// Jobvite public job feed (no key needed): https://app.jobvite.com/CompanyJobs/Xml.aspx?c=<companyEId>
// The company id is read from the employer's public board page (jobs.jobvite.com/<slug>), where it appears as companyEId.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, decodeEntities, htmlToText } from '../job.mjs';

const HOSTS = ['app.jobvite.com', 'jobs.jobvite.com'];
const tag = (b, n) => { const m = b.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, 'i')); if (!m) return ''; const c = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/); return (c ? c[1] : decodeEntities(m[1])).trim(); };

export default {
  id: 'jobvite',
  label: 'Jobvite',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.hostname === 'app.jobvite.com' && u.searchParams.get('c')) return { eid: u.searchParams.get('c') };
    const slug = u.hostname === 'jobs.jobvite.com' && u.pathname.split('/').filter(Boolean)[0];
    return slug && /^[a-z0-9_-]+$/i.test(slug) && !['careers', 'api'].includes(slug) ? { slug } : null;
  },
  parse(xml, t) {
    return (String(xml).match(/<job>[\s\S]*?<\/job>/gi) || []).map(b => {
      const d = tag(b, 'date').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return makeJob({
        source: 'jobvite', company: t.name || t.slug || '', nativeId: tag(b, 'id'), title: tag(b, 'title'),
        url: tag(b, 'detail-url'), applyUrl: tag(b, 'apply-url') || undefined, location: tag(b, 'location'),
        postedAt: d ? `${d[3]}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}` : null,
        description: htmlToText(tag(b, 'description')), department: tag(b, 'category'), employment: tag(b, 'jobtype'),
      });
    }).filter(Boolean);
  },
  async fetchJobs(t) {
    let eid = t.eid;
    if (!eid) {
      const page = await request(`https://jobs.jobvite.com/${encodeURIComponent(t.slug)}/jobs`, { allow: HOSTS, parse: 'text', accept: 'text/html' });
      eid = (page.text.match(/companyEId\s*[:=]\s*['"]([A-Za-z0-9_-]{4,40})['"]/) || [])[1];
      if (!eid) throw new Error('could not find the Jobvite company id on its board page');
    }
    const r = await request(`https://app.jobvite.com/CompanyJobs/Xml.aspx?c=${encodeURIComponent(eid)}`, { allow: HOSTS, parse: 'text', accept: 'application/xml' });
    return this.parse(r.text, t);
  },
};
