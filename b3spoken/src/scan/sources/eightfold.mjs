// Eightfold career sites (no key needed), on <tenant>.eightfold.ai or the employer's own careers host.
// Their robots.txt allows /api/apply and /api/pcsx. Classic tenants: GET /api/apply/v2/jobs?start=N&num=100;
// newer tenants answer 403 or 422 there and serve GET /api/pcsx/search?start=N instead. Many need ?domain=<employer domain>.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const NUM = 100, MAX_PAGES = 40;

// Recognise an Eightfold site from its page (Eightfold's static host is vscdn.net).
export function eightfoldFromPage(html, pageUrl) {
  if (!/static\.vscdn\.net|eightfold\.ai/i.test(html)) return null;
  return { host: new URL(pageUrl).hostname.toLowerCase() };
}

export default {
  id: 'eightfold',
  label: 'Eightfold',
  hosts: ['*.eightfold.ai'],
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    return /^[a-z0-9-]+\.eightfold\.ai$/i.test(u.hostname) && !['www.eightfold.ai', 'vs-errors.eightfold.ai'].includes(u.hostname) ? { host: u.hostname.toLowerCase(), ...(u.searchParams.get('domain') ? { domain: u.searchParams.get('domain') } : {}) } : null;
  },
  parse(data, t) {
    const list = data?.positions || data?.data?.positions || [];
    return list.map(p => {
      const id = p.id ?? p.position_id;
      const where = [p.location, ...(p.locations || []).map(l => typeof l === 'string' ? l : l?.name || l?.location)].filter((v, i, a) => v && a.indexOf(v) === i);
      const ts = p.t_create ?? p.postedTs ?? p.creationTs ?? p.t_update;
      return makeJob({
        source: 'eightfold', company: t.name || t.host, nativeId: id,
        title: p.name || p.posting_name,
        url: p.canonicalPositionUrl || (p.positionUrl && new URL(p.positionUrl, 'https://' + t.host).href) || `https://${t.host}/careers/job/${id}`,
        location: where.join(' / '), remote: /remote/i.test(p.work_location_option || p.workLocationOption || ''),
        postedAt: typeof ts === 'number' ? ts : null, description: htmlToText(p.job_description || ''), department: p.department || p.business_unit,
      });
    }).filter(Boolean);
  },
  async fetchJobs(t) {
    const allow = [t.host];
    const q = s => `start=${s}&num=${NUM}${t.domain ? '&domain=' + encodeURIComponent(t.domain) : ''}`;
    let api = 'v2';
    const out = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      let r;
      try { r = await request(api === 'v2' ? `https://${t.host}/api/apply/v2/jobs?${q(p * NUM)}` : `https://${t.host}/api/pcsx/search?${q(p * NUM)}`, { allow, parse: 'json', gapMs: 400 }); }
      catch (e) {
        if (p === 0 && api === 'v2' && (e.status === 403 || e.status === 422)) { api = 'pcsx'; p--; continue; }
        throw e;
      }
      const got = this.parse(r.json, t);
      out.push(...got);
      const total = r.json?.count ?? r.json?.data?.count ?? 0;
      if (!got.length || out.length >= total) break;
    }
    return out;
  },
};
