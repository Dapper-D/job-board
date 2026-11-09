// Recruitee public offers API (no key needed): https://<company>.recruitee.com/api/offers/
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
// One request returns every open offer with its full text. Translations are ignored: each offer comes back once,
// in its default language. Offers Recruitee itself titles "(Sample)" are demo data on empty accounts and are skipped.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['*.recruitee.com'];
const HOST = /^[a-z0-9][a-z0-9-]*\.recruitee\.com$/;
// Recruitee's own sites, not employer boards.
const RESERVED = new Set(['www', 'app', 'api', 'blog', 'help', 'support', 'status', 'docs', 'careers', 'marketplace']);
const PERIOD = { hour: 'per hour', month: 'per month', year: 'per year' };

// "2026-11-02 14:00:00 UTC" is not ISO; turn it into one.
function postedIso(v) {
  const m = typeof v === 'string' && v.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/);
  return m ? `${m[1]}T${m[2]}Z` : (v || null);
}

// { min: "60000", max: "70000", period: "year", currency: "EUR" } -> "EUR 60,000 – 70,000 per year". Unknown period = no salary.
function salary(s) {
  if (!s || typeof s !== 'object' || !PERIOD[String(s.period || '').toLowerCase()]) return '';
  const n = v => { const x = Number(v); return v !== null && v !== '' && Number.isFinite(x) && x > 0 ? x.toLocaleString('en-US') : ''; };
  const lo = n(s.min), hi = n(s.max);
  if (!lo && !hi) return '';
  const range = lo && hi && lo !== hi ? `${lo} – ${hi}` : (lo || hi);
  return `${String(s.currency || '').trim().toUpperCase()} ${range} ${PERIOD[String(s.period).toLowerCase()]}`.trim();
}

// The flat "location" names only the main place; "locations" lists every place when there are several.
function place(j) {
  const names = [...new Set((Array.isArray(j.locations) ? j.locations : []).map(l => {
    const name = typeof l?.name === 'string' ? l.name.trim() : '';
    if (!name) return '';
    const extra = [l.city, l.country].filter(x => typeof x === 'string' && x.trim() && !name.toLowerCase().includes(x.trim().toLowerCase()));
    return [name, ...extra.map(x => x.trim())].join(', ');
  }).filter(Boolean))];
  if (names.length > 1) return names.join(' / ') + (j.remote && !names.some(n => /remote/i.test(n)) ? ' / Remote' : '');
  if (typeof j.location === 'string' && j.location.trim()) {
    const loc = j.location.trim(), c = typeof j.country === 'string' ? j.country.trim() : '';
    return c && !loc.toLowerCase().includes(c.toLowerCase()) ? `${loc}, ${c}` : loc;
  }
  return [j.city, j.country, j.remote ? 'Remote' : ''].filter(Boolean).join(', ');
}

export default {
  id: 'recruitee',
  label: 'Recruitee',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    return HOST.test(h) && !RESERVED.has(h.split('.')[0]) ? { host: h } : null;
  },
  parse(data, target) {
    return (Array.isArray(data?.offers) ? data.offers : []).map(j => {
      if (!j || typeof j !== 'object' || /\(sample\)/i.test(j.title || '')) return null;
      // The posting link may be on the employer's own domain; it is only shown, never fetched.
      const link = [j.careers_url, j.url].find(x => typeof x === 'string' && x.startsWith('https://'));
      return makeJob({
        source: 'recruitee', company: target.name || j.company_name || target.host.split('.')[0], nativeId: j.id ?? j.slug,
        title: j.title, url: link, applyUrl: /^https:\/\//.test(j.careers_apply_url || '') ? j.careers_apply_url : undefined,
        location: place(j), remote: j.remote === true,
        postedAt: postedIso(j.published_at || j.created_at),
        description: htmlToText([j.description, j.requirements].filter(x => typeof x === 'string' && x.trim()).join('\n')),
        salary: salary(j.salary),
        department: typeof j.department === 'string' ? j.department : '',
        employment: j.employment_type_code,
      });
    }).filter(Boolean);
  },
  async fetchJobs(target) {
    const r = await request(`https://${target.host}/api/offers/`, { allow: [target.host], parse: 'json' });
    if (!Array.isArray(r.json?.offers)) throw new Error(`Recruitee changed its offers API (${target.host})`);
    return this.parse(r.json, target);
  },
};
