// Lever public Postings API (no key needed): api.lever.co/v0/postings/<site>?mode=json  (EU accounts: api.eu.lever.co)
import { request } from '../http.mjs';
import { makeJob } from '../job.mjs';

const HOSTS = ['api.lever.co', 'api.eu.lever.co'];
const PAGE = 100, MAX_PAGES = 20;

const salaryText = s => s && (s.min || s.max) ? `${s.currency || ''} ${s.min ?? ''}${s.max ? ' – ' + s.max : ''} ${s.interval || ''}`.trim() : '';

export default {
  id: 'lever',
  label: 'Lever',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const m = u.hostname.match(/^(jobs|api)(\.eu)?\.lever\.co$/);
    if (!m) return null;
    const site = u.pathname.replace(/^\/v0\/postings/, '').split('/').filter(Boolean)[0];
    return site ? { site, eu: !!m[2] } : null;
  },
  parse(list, target) {
    return (Array.isArray(list) ? list : []).map(j => makeJob({
      source: 'lever', company: target.name || target.site, nativeId: j.id,
      title: j.text, url: j.hostedUrl, applyUrl: j.applyUrl,
      location: [j.categories?.location, ...(j.categories?.allLocations || [])].filter((v, i, a) => v && a.indexOf(v) === i).join(' / '),
      remote: j.workplaceType === 'remote',
      postedAt: j.createdAt,
      description: [j.descriptionPlain, ...(j.lists || []).map(l => `${l.text}\n${(l.content || '').replace(/<li>/g, '\n• ').replace(/<[^>]+>/g, '')}`), j.additionalPlain].filter(Boolean).join('\n\n'),
      department: j.categories?.team, employment: j.categories?.commitment,
      salary: salaryText(j.salaryRange),
    })).filter(Boolean);
  },
  async fetchJobs(target) {
    const host = target.eu ? 'api.eu.lever.co' : 'api.lever.co';
    const out = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await request(`https://${host}/v0/postings/${encodeURIComponent(target.site)}?mode=json&limit=${PAGE}&skip=${p * PAGE}`, { allow: HOSTS, parse: 'json' });
      const list = Array.isArray(r.json) ? r.json : [];
      out.push(...this.parse(list, target));
      if (list.length < PAGE) break;
    }
    return out;
  },
};
